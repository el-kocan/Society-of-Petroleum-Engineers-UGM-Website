import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis, type Requester } from "@upstash/redis";

export class SubmissionError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  if (["localhost", "127.0.0.1"].includes(url.hostname)) {
    const rawHost =
      request.headers.get("host") ?? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (rawHost) {
      const [hostname] = rawHost.split(":");
      if (["localhost", "127.0.0.1"].includes(hostname)) {
        const proto =
          request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
          url.protocol.replace(":", "");
        if (proto === "http" || proto === "https") {
          return `${proto}://${rawHost}`;
        }
      }
    }
  }
  return url.origin;
}

export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin || getRequestOrigin(request) !== origin) {
    throw new SubmissionError(403, "Permintaan tidak diizinkan.");
  }
}

export function resolveClientIp(request: Request): string {
  const isVercel = process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;

  if (isVercel) {
    // Vercel edge proxy sets x-real-ip
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp && isIP(realIp)) {
      return realIp;
    }
    // Vercel-specific forwarded header
    const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (vercelForwarded && isIP(vercelForwarded)) {
      return vercelForwarded;
    }
    // Standard forwarded header fallback on Vercel: rightmost IP is the connecting client to Vercel edge
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
      const candidate = parts[parts.length - 1];
      if (candidate && isIP(candidate)) {
        return candidate;
      }
    }
    return "vercel-unknown-ip";
  }

  // Outside Vercel (local staging, dev, or self-hosted):
  const host = request.headers.get("host") || "";
  const [hostname] = host.split(":");
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return "127.0.0.1";
  }

  // Outside Vercel: do NOT blindly trust client-supplied headers unless TRUST_PROXY is explicitly configured
  if (process.env.TRUST_PROXY === "true") {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp && isIP(realIp)) return realIp;
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
      const candidate = parts[parts.length - 1];
      if (candidate && isIP(candidate)) return candidate;
    }
  }

  return "untrusted-client-boundary";
}

export function issueSession(secret: string, now = Date.now()) {
  const data = `${randomUUID()}.${now + 86400000}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("hex")}`;
}

export function verifySession(token: string, secret: string, now = Date.now()) {
  const [key, expires, signature, extra] = token.split(".");
  if (
    extra ||
    !/^[0-9a-f-]{36}$/.test(key ?? "") ||
    !/^\d{13}$/.test(expires ?? "") ||
    !/^[0-9a-f]{64}$/.test(signature ?? "")
  ) {
    throw new SubmissionError(403, "Sesi tidak valid. Muat ulang halaman.");
  }
  const expected = createHmac("sha256", secret).update(`${key}.${expires}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")) || Number(expires) <= now) {
    throw new SubmissionError(
      403,
      "Sesi berakhir. Hubungi panitia jika pengiriman sebelumnya belum terkonfirmasi.",
    );
  }
  return key;
}

// Rate Limiter Abstraction
export interface RateLimiter {
  limit(key: string, maximum: number, windowMs?: number, now?: number): Promise<void> | void;
  singleSubmission<T>(key: string, operation: () => Promise<T>): Promise<T>;
  reset?(): Promise<void> | void;
}

export class MemoryRateLimiter implements RateLimiter {
  private counters = new Map<string, { count: number; until: number }>();
  private inFlight = new Set<string>();

  limit(key: string, maximum: number, windowMs = 60000, now = Date.now()): void {
    for (const [id, value] of this.counters) {
      if (value.until <= now) this.counters.delete(id);
    }
    const value = this.counters.get(key) ?? { count: 0, until: now + windowMs };
    if (value.count >= maximum || (!this.counters.has(key) && this.counters.size >= 2000)) {
      throw new SubmissionError(
        429,
        "Terlalu banyak permintaan. Tunggu satu menit sebelum mencoba kembali.",
        undefined,
        Math.max(1, Math.ceil((value.until - now) / 1000)),
      );
    }
    value.count++;
    this.counters.set(key, value);
  }

  async singleSubmission<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(key)) {
      throw new SubmissionError(
        429,
        "Pengiriman sedang diproses. Tunggu sebelum mencoba kembali.",
        undefined,
        5,
      );
    }
    this.inFlight.add(key);
    try {
      return await operation();
    } finally {
      this.inFlight.delete(key);
    }
  }

  reset(): void {
    this.counters.clear();
    this.inFlight.clear();
  }
}

export class UpstashRateLimiter implements RateLimiter {
  private redis: Redis;
  private limiters = new Map<string, Ratelimit>();

  constructor(
    public readonly url: string,
    public readonly token: string,
    redisOrRequester?: Redis | Requester,
  ) {
    if (redisOrRequester) {
      if (redisOrRequester instanceof Redis) {
        this.redis = redisOrRequester;
      } else {
        this.redis = new Redis(redisOrRequester);
      }
    } else {
      this.redis = new Redis({
        url,
        token,
        signal: () => AbortSignal.timeout(4000),
      });
    }
  }

  private getLimiter(maximum: number, windowMs: number): Ratelimit {
    const key = `${maximum}:${windowMs}`;
    let rl = this.limiters.get(key);
    if (!rl) {
      rl = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(maximum, `${windowMs} ms`),
        prefix: "spe:recruitment:rl",
      });
      this.limiters.set(key, rl);
    }
    return rl;
  }

  async limit(key: string, maximum: number, windowMs = 60000): Promise<void> {
    try {
      const limiter = this.getLimiter(maximum, windowMs);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const res = await Promise.race([
        limiter.limit(key),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Rate limiter timeout")), 4000);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      if (!res.success) {
        const retryAfter = Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
        throw new SubmissionError(
          429,
          "Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba kembali.",
          undefined,
          retryAfter,
        );
      }
    } catch (err) {
      if (err instanceof SubmissionError) throw err;
      throw new SubmissionError(
        503,
        "Layanan pendaftaran sedang sibuk atau tidak dapat memproses saat ini. Coba beberapa saat lagi.",
      );
    }
  }

  async singleSubmission<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = `spe:recruitment:lock:${key}`;
    const ownerId = randomUUID();
    const ttlMs = 45000;

    let acquired: unknown = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      acquired = await Promise.race([
        this.redis.set(lockKey, ownerId, { nx: true, px: ttlMs }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Lock acquisition timeout")), 4000);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    } catch (err) {
      if (err instanceof SubmissionError) throw err;
      throw new SubmissionError(
        503,
        "Layanan pendaftaran sedang sibuk atau tidak dapat memproses saat ini. Coba beberapa saat lagi.",
      );
    }

    if (acquired !== "OK") {
      throw new SubmissionError(
        429,
        "Pengiriman sedang diproses. Tunggu sebelum mencoba kembali.",
        undefined,
        5,
      );
    }

    try {
      return await operation();
    } finally {
      const RELEASE_SCRIPT = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      let releaseTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.redis.eval(RELEASE_SCRIPT, [lockKey], [ownerId]),
          new Promise<never>((_, reject) => {
            releaseTimer = setTimeout(() => reject(new Error("Lock release timeout")), 4000);
          }),
        ]).finally(() => {
          if (releaseTimer) clearTimeout(releaseTimer);
        });
      } catch {
        // Silently catch release error; PX TTL ensures safe automatic unlock
      }
    }
  }

  reset(): void {
    this.limiters.clear();
  }
}

export const defaultLimiter = new MemoryRateLimiter();
let activeLimiter: RateLimiter | null = null;

export function setRateLimiter(limiter: RateLimiter | null): void {
  activeLimiter = limiter;
}

export function getRateLimiter(): RateLimiter {
  if (activeLimiter) return activeLimiter;

  const isVercel = process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
  const distributedLimiter = process.env.RECRUITMENT_DISTRIBUTED_LIMITER;

  if (isVercel) {
    if (distributedLimiter !== "upstash" && distributedLimiter !== "redis") {
      throw new SubmissionError(
        503,
        "Vercel multi-instance hosting requires a configured distributed rate limiter provider. RECRUITMENT_SINGLE_INSTANCE is prohibited on Vercel.",
      );
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token || !isValidRedisUrl(url)) {
      throw new SubmissionError(
        503,
        "Konfigurasi distributed rate limiter belum lengkap atau tidak valid.",
      );
    }
    activeLimiter = new UpstashRateLimiter(url, token);
    return activeLimiter;
  }

  // Non-Vercel environment
  if (distributedLimiter === "upstash" || distributedLimiter === "redis") {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token || !isValidRedisUrl(url)) {
      throw new SubmissionError(
        503,
        "Konfigurasi distributed rate limiter belum lengkap atau tidak valid.",
      );
    }
    activeLimiter = new UpstashRateLimiter(url, token);
    return activeLimiter;
  }

  if (process.env.RECRUITMENT_SINGLE_INSTANCE === "true") {
    activeLimiter = defaultLimiter;
    return activeLimiter;
  }

  // Standalone / offline test environment outside Vercel
  return defaultLimiter;
}

function isValidRedisUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function limit(
  key: string,
  maximum: number,
  windowMsOrNow?: number,
  now?: number,
): Promise<void> | void {
  const currentLimiter = getRateLimiter();
  if (currentLimiter instanceof MemoryRateLimiter) {
    if (now !== undefined) {
      return currentLimiter.limit(key, maximum, windowMsOrNow, now);
    }
    if (windowMsOrNow !== undefined && windowMsOrNow < 100000) {
      return currentLimiter.limit(key, maximum, 60000, windowMsOrNow);
    }
    return currentLimiter.limit(key, maximum, windowMsOrNow ?? 60000);
  }
  return currentLimiter.limit(key, maximum, windowMsOrNow ?? 60000);
}

export async function singleSubmission<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return getRateLimiter().singleSubmission(key, operation);
}

export async function boundedForm(request: Request, max = 22 * 1024 * 1024) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;") || !request.body)
    throw new SubmissionError(400, "Format pengiriman tidak valid.");
  if (Number(request.headers.get("content-length")) > max)
    throw new SubmissionError(413, "Ukuran pengiriman terlalu besar.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + 30000;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SubmissionError(408, "Waktu unggah habis. Coba kembali.");
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SubmissionError(408, "Waktu unggah habis. Coba kembali.")),
            remaining,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      const { done, value } = chunk;
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new SubmissionError(413, "Ukuran pengiriman terlalu besar.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new SubmissionError(400, "Format pengiriman tidak valid.");
  }
}

import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";

/**
 * TEMPORARY CONNECTIVITY DIAGNOSTIC ENDPOINT (B6G.15 — HARDENED)
 *
 * Purpose:
 * Safely verify that the dedicated Vercel staging deployment can reach
 * its configured Supabase staging database and Upstash Redis instance.
 *
 * Security Guarantees:
 * - Read-only GET only.
 * - Does not activate recruitment; completely independent from settings() gate.
 * - Requires Vercel runtime (VERCEL === "1") AND production scope (VERCEL_ENV === "production").
 * - Requires exact matching VERCEL_PROJECT_ID === VERCEL_STAGING_PROJECT_ID.
 * - Requires 64-character hex STAGING_CONNECTIVITY_TOKEN (32 random bytes) via header.
 * - Applies bounded validation to incoming token before constant-time comparison.
 * - Requires NEXT_PUBLIC_SUPABASE_URL to equal exactly "https://lavxddhrrwsjcshmnwvu.supabase.co".
 * - Uses only SUPABASE_SECRET_KEY (no fallback to recruitment staging secret).
 * - Executes strictly read-only checks:
 *     - Supabase: single SELECT query for RECRUITMENT_PERIOD_ID in recruitment_periods table.
 *     - Upstash Redis: PING command (creates zero keys).
 * - Applies strict short timeouts (4000-5000ms).
 * - Returns ONLY bounded status information: { supabase: "ok" | "error", upstash: "ok" | "error" }.
 * - Never logs or returns credentials, URLs, tokens, or internal error traces.
 * - Fails closed with generic HTTP 404 on any unauthorized or unverified access attempt.
 *
 * Removal steps:
 * 1. Delete file: app/api/internal/staging-connectivity/route.ts
 * 2. Delete test file: scripts/recruitment-backend/staging-connectivity.test.cjs
 * 3. Delete documentation: docs/staging/B6G15-connectivity-guide.md
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXACT_STAGING_SUPABASE_URL = "https://lavxddhrrwsjcshmnwvu.supabase.co";
const HEX_TOKEN_REGEX = /^[0-9a-f]{64}$/i;

const responseHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json",
};

function isValidHexToken(token: string | null | undefined): token is string {
  return Boolean(token && HEX_TOKEN_REGEX.test(token));
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function probeSupabase(): Promise<"ok" | "error"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url !== EXACT_STAGING_SUPABASE_URL) {
    return "error";
  }

  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    return "error";
  }

  const periodId = process.env.RECRUITMENT_PERIOD_ID;
  if (!periodId || !/^[0-9a-f-]{36}$/i.test(periodId)) {
    return "error";
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => {
          return fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
        },
      },
    });

    const { data, error } = await supabase
      .from("recruitment_periods")
      .select("id")
      .eq("id", periodId)
      .maybeSingle();

    if (!error && data && data.id === periodId) {
      return "ok";
    }
    return "error";
  } catch {
    return "error";
  }
}

async function probeUpstash(): Promise<"ok" | "error"> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken || !redisUrl.startsWith("https://")) {
    return "error";
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
      signal: () => AbortSignal.timeout(4000),
    });

    const pong = await redis.ping();
    if (pong === "PONG") {
      return "ok";
    }
    return "error";
  } catch {
    return "error";
  }
}

export async function GET(request: Request): Promise<Response> {
  // 1. Diagnostic token authentication with bounded 64-hex character validation
  const serverToken = process.env.STAGING_CONNECTIVITY_TOKEN;
  const clientToken =
    request.headers.get("x-staging-connectivity-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (
    !isValidHexToken(serverToken) ||
    !isValidHexToken(clientToken) ||
    !safeCompare(clientToken.toLowerCase(), serverToken.toLowerCase())
  ) {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: responseHeaders,
    });
  }

  // 2. Vercel runtime and production environment verification
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: responseHeaders,
    });
  }

  // 3. Vercel Project ID identity verification
  const actualProjectId = process.env.VERCEL_PROJECT_ID;
  const expectedProjectId = process.env.VERCEL_STAGING_PROJECT_ID;

  const vercelProjectIdMatches =
    Boolean(actualProjectId && actualProjectId.trim().length > 0) &&
    Boolean(expectedProjectId && expectedProjectId.trim().length > 0) &&
    actualProjectId === expectedProjectId;

  if (!vercelProjectIdMatches) {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: responseHeaders,
    });
  }

  // 4. Concurrently probe Supabase and Upstash Redis
  const [supabaseStatus, upstashStatus] = await Promise.all([
    probeSupabase(),
    probeUpstash(),
  ]);

  // 5. Return bounded status information only
  return new Response(
    JSON.stringify({
      supabase: supabaseStatus,
      upstash: upstashStatus,
    }),
    {
      status: 200,
      headers: responseHeaders,
    },
  );
}

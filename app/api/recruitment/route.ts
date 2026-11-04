import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { settings, client, loadCatalog, submit } from "@/modules/recruitment/server/backend";
import {
  isGoogleProvider,
  googleSettings,
  loadGoogleCatalog,
  submitToGoogle,
  googleInitSubmission,
  googleUploadSingleFile,
  googleFinalizeSubmission,
  resolveFilename,
} from "@/modules/recruitment/server/google-sheets-adapter";
import { publicPeriod, assertOpen } from "@/modules/recruitment/server/configuration";
import { inspectDocument, validatePayload } from "@/modules/recruitment/server/payload";
import { emptyValues, type ApplicationValues, validateStep } from "@/modules/recruitment/validation";
import {
  SubmissionError,
  getRequestOrigin,
  requireOrigin,
  resolveClientIp,
  issueSession,
  verifySession,
  limit,
  boundedForm,
  singleSubmission,
} from "@/modules/recruitment/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "spe-recruitment-session";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function failure(error: unknown) {
  const known = error instanceof SubmissionError;
  const status = known ? error.status : 503;
  const resHeaders: Record<string, string> = { ...headers };
  if (known && error.retryAfter !== undefined) {
    resHeaders["Retry-After"] = String(error.retryAfter);
  }
  return Response.json(
    {
      error: known
        ? error.message
        : "Submission has not been confirmed. Please try again with the same information and files.",
      fields: known ? error.fields : undefined,
    },
    { status, headers: resHeaders },
  );
}

function getLimitThreshold(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const num = parseInt(raw, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export async function GET(request: Request) {
  try {
    if (isGoogleProvider()) {
      const gs = googleSettings();
      if (
        getRequestOrigin(request) !== gs.origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      ) {
        throw new SubmissionError(403, "Request not permitted.");
      }
      const clientIp = resolveClientIp(request);
      const sessionIpLimit = getLimitThreshold("RECRUITMENT_LIMIT_SESSION_IP", 60);
      const sessionGlobalLimit = getLimitThreshold("RECRUITMENT_LIMIT_SESSION_GLOBAL", 300);
      await limit(`session:ip:${clientIp}`, sessionIpLimit, 60000);
      await limit("global-config", sessionGlobalLimit, 60000);

      const catalog = loadGoogleCatalog();
      assertOpen(catalog);
      const jar = await cookies();
      let token = jar.get(cookieName)?.value;
      try {
        if (!token) throw new Error();
        verifySession(token, gs.sessionSecret);
      } catch {
        token = issueSession(gs.sessionSecret);
      }
      jar.set(cookieName, token!, {
        httpOnly: true,
        secure: new URL(gs.origin).protocol === "https:",
        sameSite: "strict",
        path: "/api/recruitment",
        maxAge: 86400,
      });
      return Response.json({ period: publicPeriod(catalog), token }, { headers });
    }

    const s = settings();
    if (
      getRequestOrigin(request) !== s.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      throw new SubmissionError(403, "Request not permitted.");
    }
    const clientIp = resolveClientIp(request);
    const sessionIpLimit = getLimitThreshold("RECRUITMENT_LIMIT_SESSION_IP", 60);
    const sessionGlobalLimit = getLimitThreshold("RECRUITMENT_LIMIT_SESSION_GLOBAL", 300);
    await limit(`session:ip:${clientIp}`, sessionIpLimit, 60000);
    await limit("global-config", sessionGlobalLimit, 60000);

    const db = client(s.key);
    const catalog = await loadCatalog(db, s.period);
    assertOpen(catalog);
    const jar = await cookies();
    let token = jar.get(cookieName)?.value;
    try {
      if (!token) throw new Error();
      verifySession(token, s.secret);
    } catch {
      token = issueSession(s.secret);
    }
    jar.set(cookieName, token!, {
      httpOnly: true,
      secure: new URL(s.origin).protocol === "https:",
      sameSite: "strict",
      path: "/api/recruitment",
      maxAge: 86400,
    });
    return Response.json({ period: publicPeriod(catalog), token }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || request.headers.get("x-recruitment-action");

    if (isGoogleProvider()) {
      const gs = googleSettings();
      requireOrigin(request, gs.origin);

      const clientIp = resolveClientIp(request);
      const submitIpLimit = getLimitThreshold("RECRUITMENT_LIMIT_SUBMIT_IP", 30);
      const submitGlobalLimit = getLimitThreshold("RECRUITMENT_LIMIT_SUBMIT_GLOBAL", 120);
      const submitSessionLimit = getLimitThreshold("RECRUITMENT_LIMIT_SUBMIT_SESSION", 20);
      await limit(`submit:ip:${clientIp}`, submitIpLimit, 60000);
      await limit("global-submission", submitGlobalLimit, 60000);

      const token = (await cookies()).get(cookieName)?.value;
      if (!token || request.headers.get("x-recruitment-session") !== token) {
        throw new SubmissionError(403, "Invalid session. Please reload the page.");
      }
      const key = verifySession(token, gs.sessionSecret);
      await limit(`submission:${key}`, submitSessionLimit, 60000);

      if (action === "init") {
        return await singleSubmission(key, async () => {
          const body = (await request.json()) as { values?: ApplicationValues };
          const rawValues = body.values || ({} as ApplicationValues);
          const values: ApplicationValues = { ...emptyValues };
          for (const k of Object.keys(values) as Array<keyof ApplicationValues>) {
            const val = rawValues[k];
            if (typeof val === "string") values[k] = val.trim();
          }
          values.nim = values.nim.toLowerCase();
          values.ugmEmail = values.ugmEmail.toLowerCase();

          const catalog = loadGoogleCatalog();
          assertOpen(catalog);
          const period = publicPeriod(catalog);

          const errors = Object.assign(
            {},
            ...[0, 1, 2].map((step) => validateStep(step, values, {}, period, false)),
          );
          delete errors.assignment1;
          const o1 = catalog.options.find(
            (o) => o.main_code === values.division1 && o.sub_code === values.subDivision1,
          );
          if (!o1 || o1.assignment_state === "unconfirmed") {
            errors.subDivision1 = "Assignment requirements are unconfirmed.";
          }
          const o2 = catalog.options.find(
            (o) => o.main_code === values.division2 && o.sub_code === values.subDivision2,
          );
          if (!o2) {
            errors.subDivision2 = "Invalid second sub-division selection.";
          }

          if (Object.keys(errors).length > 0) {
            throw new SubmissionError(422, "Please review your entries.", errors);
          }

          const initResult = await googleInitSubmission(catalog, key, values);
          return Response.json(initResult, { headers });
        });
      }

      if (action === "upload") {
        return await singleSubmission(key, async () => {
          // Strict 4.5 MB Vercel Serverless Function limit
          const form = await boundedForm(request, 4.5 * 1024 * 1024);
          const slot = form.get("slot");
          const file = form.get("file");
          const nim =
            typeof form.get("nim") === "string" ? String(form.get("nim")).trim().toLowerCase() : "";
          const fullName =
            typeof form.get("fullName") === "string" ? String(form.get("fullName")).trim() : "";

          if (typeof slot !== "string" || !(file instanceof File)) {
            throw new SubmissionError(400, "Invalid document or upload slot.");
          }

          const catalog = loadGoogleCatalog();
          assertOpen(catalog);

          let maxBytes = 3145728;
          let allowedFormats: string[] = ["pdf"];
          if (slot === "assignment1") {
            allowedFormats = ["pdf"];
          } else {
            const req = catalog.requirements.find((r) => r.slot === slot);
            if (!req) {
              throw new SubmissionError(400, "Unrecognized document slot.");
            }
            maxBytes = req.max_bytes;
            allowedFormats = req.formats;
          }

          if (file.size < 1 || file.size > Math.min(maxBytes, 3145728)) {
            throw new SubmissionError(422, "Document exceeds the 3 MiB limit.", {
              [slot]: "Check the document and size limit.",
            });
          }

          const bytes = Buffer.from(await file.arrayBuffer());
          const format = inspectDocument(bytes, file.name, file.type);
          if (!allowedFormats.includes(format)) {
            throw new SubmissionError(422, "Document format does not match requirements.", {
              [slot]: `Format must be ${allowedFormats.join(" / ").toUpperCase()}.`,
            });
          }

          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const filename = resolveFilename(nim || file.name, slot, format);

          const uploadResult = await googleUploadSingleFile(
            catalog,
            key,
            nim,
            fullName,
            slot,
            filename,
            file.type,
            bytes,
            sha256,
          );

          return Response.json(uploadResult, { headers });
        });
      }

      if (action === "finalize") {
        return await singleSubmission(key, async () => {
          const body = (await request.json()) as {
            values?: ApplicationValues;
            documents?: Array<{ slot: string; fileId: string; fileUrl: string }>;
          };
          const rawValues = body.values || ({} as ApplicationValues);
          const catalog = loadGoogleCatalog();
          assertOpen(catalog);

          const finalizeResult = await googleFinalizeSubmission(
            catalog,
            key,
            rawValues,
            body.documents,
          );
          return Response.json(finalizeResult, { headers });
        });
      }

      // Monolithic fallback for Google provider
      return await singleSubmission(key, async () => {
        const form = await boundedForm(request);
        const catalog = loadGoogleCatalog();
        const payload = await validatePayload(form, catalog);
        return Response.json(await submitToGoogle(catalog, key, payload), { headers });
      });
    }

    const s = settings();
    requireOrigin(request, s.origin);

    const clientIp = resolveClientIp(request);
    const submitIpLimit = getLimitThreshold("RECRUITMENT_LIMIT_SUBMIT_IP", 15);
    const submitGlobalLimit = getLimitThreshold("RECRUITMENT_LIMIT_SUBMIT_GLOBAL", 120);
    const submitSessionLimit = getLimitThreshold("RECRUITMENT_LIMIT_SUBMIT_SESSION", 10);
    await limit(`submit:ip:${clientIp}`, submitIpLimit, 60000);
    await limit("global-submission", submitGlobalLimit, 60000);

    const token = (await cookies()).get(cookieName)?.value;
    if (!token || request.headers.get("x-recruitment-session") !== token) {
      throw new SubmissionError(403, "Invalid session. Please reload the page.");
    }
    const key = verifySession(token, s.secret);
    await limit(`submission:${key}`, submitSessionLimit, 60000);

    return await singleSubmission(key, async () => {
      const form = await boundedForm(request);
      const db = client(s.key);
      const catalog = await loadCatalog(db, s.period);
      const payload = await validatePayload(form, catalog);
      return Response.json(await submit(db, catalog, key, payload), { headers });
    });
  } catch (error) {
    return failure(error);
  }
}

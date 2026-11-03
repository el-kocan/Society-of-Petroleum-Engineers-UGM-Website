import "server-only";
import type { Catalog, OptionRow, PeriodRow, RequirementRow } from "./configuration";
import { assertOpen } from "./configuration";
import type { Payload } from "./payload";
import { SubmissionError } from "./security";
import { draftPeriod } from "../draft-config";
import { documentSlots } from "../config";
import type { UploadFormat } from "../recruitment-types";

export type GoogleBackendSettings = {
  origin: string;
  sessionSecret: string;
  scriptUrl: string;
  scriptSecret: string;
};

export function isGoogleProvider(): boolean {
  return process.env.RECRUITMENT_PROVIDER === "google_sheets";
}

export function googleSettings(): GoogleBackendSettings {
  const enabled =
    process.env.RECRUITMENT_ENABLED === "true" ||
    process.env.RECRUITMENT_STAGING_ENABLED === "true";
  if (!enabled) {
    throw new SubmissionError(503, "Pendaftaran belum tersedia. Silakan hubungi panitia.");
  }

  const vercelEnv = process.env.VERCEL_ENV;
  const isVercel = process.env.VERCEL === "1" || vercelEnv !== undefined;
  if (vercelEnv === "preview") {
    if (process.env.RECRUITMENT_PREVIEW_SUBMISSIONS_ENABLED !== "true") {
      throw new SubmissionError(
        503,
        "Pendaftaran tidak menerima pengiriman di lingkungan preview deployment.",
      );
    }
  }

  const autoPreviewOrigin =
    vercelEnv === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;
  const origin =
    process.env.RECRUITMENT_ORIGIN === "auto" || (!process.env.RECRUITMENT_ORIGIN && autoPreviewOrigin)
      ? autoPreviewOrigin
      : process.env.RECRUITMENT_ORIGIN;
  const sessionSecret = process.env.RECRUITMENT_SESSION_SECRET;

  if (!origin || !sessionSecret || sessionSecret.length < 32) {
    throw new SubmissionError(503, "Konfigurasi sesi pendaftaran belum lengkap.");
  }

  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    (parsedOrigin.protocol !== "https:" &&
      !(
        parsedOrigin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname)
      ))
  ) {
    throw new SubmissionError(503, "Konfigurasi origin pendaftaran belum sesuai.");
  }

  const scriptUrl = process.env.RECRUITMENT_APPS_SCRIPT_URL;
  if (!scriptUrl) {
    throw new SubmissionError(503, "Konfigurasi Google Apps Script URL belum tersedia.");
  }

  try {
    const parsedScriptUrl = new URL(scriptUrl);
    if (
      parsedScriptUrl.protocol !== "https:" &&
      !(
        parsedScriptUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsedScriptUrl.hostname)
      )
    ) {
      throw new Error();
    }
  } catch {
    throw new SubmissionError(503, "RECRUITMENT_APPS_SCRIPT_URL harus berupa URL yang valid.");
  }

  const scriptSecret = process.env.RECRUITMENT_APPS_SCRIPT_SECRET;
  if (!scriptSecret || scriptSecret.length < 16) {
    throw new SubmissionError(503, "Konfigurasi Google Apps Script Secret belum tersedia atau terlalu pendek.");
  }

  return {
    origin,
    sessionSecret,
    scriptUrl,
    scriptSecret,
  };
}

export function loadGoogleCatalog(): Catalog {
  const opensAt = process.env.RECRUITMENT_OPENS_AT || "2026-11-04T00:00:00+07:00";
  const closesAt = process.env.RECRUITMENT_CLOSES_AT || "2026-11-14T00:00:00+07:00";

  const period: PeriodRow = {
    id: "oprec-2026-2027",
    label: "2026/2027",
    config_version: 1,
    approved_at: "2026-11-03T00:00:00.000Z",
    is_open: true,
    opens_at: opensAt,
    closes_at: closesAt,
    batches: [...draftPeriod.batches],
  };

  const options: OptionRow[] = [];
  for (const div of draftPeriod.divisions) {
    for (const sub of div.subDivisions) {
      const assignment = sub.assignment;
      const isNone = assignment.status === "none";
      const hasUpload = "upload" in assignment && assignment.upload !== undefined;

      options.push({
        main_code: div.id,
        main_label: div.label,
        sub_code: sub.id,
        sub_label: sub.label,
        assignment_state: assignment.status,
        instructions: isNone ? assignment.message : assignment.instructions,
        formats: hasUpload ? (assignment.upload!.formats as UploadFormat[]) : null,
        max_bytes: hasUpload ? assignment.upload!.maxBytes : null,
      });
    }
  }

  const requirements: RequirementRow[] = documentSlots.map((slot) => ({
    slot: slot.key,
    required: true,
    formats: [slot.format === "PDF" ? "pdf" : "png"],
    max_bytes: 3145728, // 3 MiB
  }));

  return { period, options, requirements };
}

export function resolveFilename(nim: string, slot: string, format: string): string {
  const safeNim = nim.toUpperCase().trim();
  switch (slot) {
    case "cv":
      return `[${safeNim}]_CV.${format}`;
    case "idCard":
      return `[${safeNim}]_IDCard.${format}`;
    case "commitment":
      return `[${safeNim}]_LetterCommitment.${format}`;
    case "followProof":
      return `[${safeNim}]_ProofFollowSPE.${format}`;
    case "storyProof":
      return `[${safeNim}]_ProofSG.${format}`;
    case "assignment1":
      return `[${safeNim}]_Assignment_FirstDivision.${format}`;
    default:
      return `[${safeNim}]_${slot}.${format}`;
  }
}

export async function googleInitSubmission(
  catalog: Catalog,
  key: string,
  values: { nim: string; fullName: string; [key: string]: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: string; applicationId: string }> {
  assertOpen(catalog);
  const s = googleSettings();
  const initRes = (await callAppsScript(
    s.scriptUrl,
    s.scriptSecret,
    {
      action: "init",
      idempotencyKey: key,
      nim: values.nim,
      fullName: values.fullName,
    },
    fetchImpl,
  )) as { ok: boolean; status: string; applicationId: string };

  return initRes;
}

export async function googleUploadSingleFile(
  catalog: Catalog,
  key: string,
  nim: string,
  fullName: string,
  slot: string,
  filename: string,
  mime: string,
  bytes: Buffer,
  sha256: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; slot: string; fileId: string; fileUrl: string }> {
  assertOpen(catalog);
  const s = googleSettings();
  const base64Content = bytes.toString("base64");

  const uploadRes = (await callAppsScript(
    s.scriptUrl,
    s.scriptSecret,
    {
      action: "upload_file",
      idempotencyKey: key,
      nim,
      fullName,
      slot,
      filename,
      mimeType: mime,
      sha256,
      base64Content,
    },
    fetchImpl,
  )) as { ok: boolean; slot: string; fileId: string; fileUrl: string };

  return uploadRes;
}

export async function googleFinalizeSubmission(
  catalog: Catalog,
  key: string,
  values: Record<string, string>,
  documents?: Array<{ slot: string; fileId: string; fileUrl: string }>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; applicationId: string }> {
  assertOpen(catalog);
  const s = googleSettings();

  const finalizeRes = (await callAppsScript(
    s.scriptUrl,
    s.scriptSecret,
    {
      action: "finalize",
      idempotencyKey: key,
      values,
      documents: documents || [],
    },
    fetchImpl,
  )) as { ok: boolean; applicationId: string };

  return finalizeRes;
}

export async function googleCleanupSubmission(
  key: string,
  nim: string,
  fullName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const s = googleSettings();
  try {
    await callAppsScript(
      s.scriptUrl,
      s.scriptSecret,
      {
        action: "cleanup",
        idempotencyKey: key,
        nim,
        fullName,
      },
      fetchImpl,
      8000,
    );
  } catch {
    // Ignore cleanup errors
  }
}

async function callAppsScript(
  scriptUrl: string,
  secret: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 25000,
) {
  const payloadWithAuth = {
    ...body,
    authSecret: secret,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payloadWithAuth),
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new SubmissionError(
        res.status === 409 ? 409 : 503,
        "Layanan pendaftaran Google tidak merespons dengan benar.",
      );
    }

    const data = (await res.json()) as { ok?: boolean; error?: string; [key: string]: unknown };
    if (!data.ok) {
      const isConflict =
        Boolean(data.error?.includes("NIM")) ||
        Boolean(data.error?.includes("pernah mendaftar")) ||
        Boolean(data.error?.includes("sudah ditutup"));
      throw new SubmissionError(isConflict ? 409 : 503, data.error || "Gagal memproses pendaftaran.");
    }

    return data;
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof SubmissionError) throw error;
    throw new SubmissionError(
      503,
      "Pengiriman belum terkonfirmasi. Coba kembali dengan data dan file yang sama.",
    );
  }
}

export async function submitToGoogle(
  catalog: Catalog,
  key: string,
  payload: Payload,
  fetchImpl: typeof fetch = fetch,
): Promise<{ applicationId: string }> {
  assertOpen(catalog);
  const s = googleSettings();
  const v = payload.values;

  // Staged Strategy:
  // Step 1: Init Application
  const initRes = (await callAppsScript(
    s.scriptUrl,
    s.scriptSecret,
    {
      action: "init",
      idempotencyKey: key,
      hash: payload.hash,
      nim: v.nim,
      fullName: v.fullName,
      documents: payload.documents.map((d) => ({
        slot: d.slot,
        format: d.format,
        sha256: d.sha256,
        size: d.bytes.length,
      })),
    },
    fetchImpl,
  )) as { status?: string; applicationId: string };

  if (initRes.status === "already_submitted") {
    return { applicationId: initRes.applicationId };
  }

  const applicationId = initRes.applicationId;
  const uploadedDocs: Array<{ slot: string; fileId: string; fileUrl: string }> = [];

  try {
    // Step 2: Upload documents individually (staged upload avoids memory exhaustion)
    for (const d of payload.documents) {
      const base64Content = d.bytes.toString("base64");
      const filename = resolveFilename(v.nim, d.slot, d.format);

      const uploadRes = (await callAppsScript(
        s.scriptUrl,
        s.scriptSecret,
        {
          action: "upload_file",
          idempotencyKey: key,
          applicationId,
          nim: v.nim,
          fullName: v.fullName,
          slot: d.slot,
          filename,
          mimeType: d.mime,
          sha256: d.sha256,
          base64Content,
        },
        fetchImpl,
      )) as { fileId: string; fileUrl: string };

      uploadedDocs.push({
        slot: d.slot,
        fileId: uploadRes.fileId,
        fileUrl: uploadRes.fileUrl,
      });
    }

    // Step 3: Finalize application atomically
    const finalizeRes = (await callAppsScript(
      s.scriptUrl,
      s.scriptSecret,
      {
        action: "finalize",
        idempotencyKey: key,
        applicationId,
        hash: payload.hash,
        values: v,
        documents: uploadedDocs,
      },
      fetchImpl,
    )) as { applicationId?: string };

    return { applicationId: finalizeRes.applicationId || applicationId };
  } catch (err) {
    // Attempt best-effort cleanup on failure
    try {
      await callAppsScript(
        s.scriptUrl,
        s.scriptSecret,
        {
          action: "cleanup",
          idempotencyKey: key,
          applicationId,
          nim: v.nim,
          fullName: v.fullName,
        },
        fetchImpl,
        8000,
      );
    } catch {
      // Ignore cleanup error; original failure is preserved
    }

    if (err instanceof SubmissionError) throw err;
    throw new SubmissionError(
      503,
      "Pengiriman belum terkonfirmasi. Coba kembali dengan data dan file yang sama.",
    );
  }
}

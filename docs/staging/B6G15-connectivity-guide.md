# B6G.15 — Temporary Vercel Staging Connectivity Diagnostic Guide

**Target Branch**: `feat/oprec-backend-staging`  
**Endpoint Path**: `/api/internal/staging-connectivity`  
**Runtime**: Node.js (`force-dynamic`, `no-store`)  
**Recruitment Status**: Disabled (`RECRUITMENT_ENABLED` remains false/unset)  

---

## 1. Overview & Hardened Security Guarantees

This temporary endpoint allows operators to verify that the dedicated Vercel staging deployment can reach its backend cloud dependencies (Supabase staging database and Upstash Redis) without activating the recruitment system.

### Hardened Safeguards:
- **Strict Vercel Environment Scope**:
  - Requires `VERCEL === "1"` AND `VERCEL_ENV === "production"`.
  - Requires matching `VERCEL_PROJECT_ID === VERCEL_STAGING_PROJECT_ID` (`prj_Hj8Qjg7x5yWZvUnO8PxYG9wYJKgs`).
- **Cryptographic 64-Hex Token Authentication**:
  - Requires `STAGING_CONNECTIVITY_TOKEN` to be a 64-character hexadecimal string (representing 32 cryptographically random bytes).
  - Bounded pre-validation rejects malformed, short, long, or non-hex client tokens before constant-time comparison (`timingSafeEqual`).
  - Any authentication failure returns a generic **HTTP 404 Not Found**.
- **Exact Supabase Target Enforcement**:
  - Requires `NEXT_PUBLIC_SUPABASE_URL` to equal exactly `https://lavxddhrrwsjcshmnwvu.supabase.co`.
  - Rejects any alternate domains, ports, paths, query strings, protocols (e.g. `http://`), or trailing slashes.
- **Strict Service Role Credential**:
  - Uses only `SUPABASE_SECRET_KEY` (no fallback to legacy or local aliases).
- **Read-Only Operations**:
  - Supabase: Single `SELECT id FROM recruitment_periods WHERE id = :RECRUITMENT_PERIOD_ID` query. Zero mutations or table writes.
  - Upstash Redis: Single `PING` command. Zero keys created or deleted.
  - Short timeouts: Supabase (5000ms), Upstash Redis (4000ms).
- **Zero Information Leakage**:
  - Returns only bounded status indicators: `{ "supabase": "ok" | "error", "upstash": "ok" | "error" }`.
  - Never logs or exposes credentials, URLs, tokens, IDs, or internal error traces.
- **Recruitment Disconnected**:
  - Completely independent from the recruitment `settings()` activation gate.

---

## 2. Generating the 64-Hex Token & Environment Setup

Generate a 64-character hexadecimal token (32 random bytes):
```bash
openssl rand -hex 32
# Example output: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90
```

Configure the following variables in the dedicated Vercel staging project (*Project Settings* -> *Environment Variables*):

| Variable | Scope | Required Value / Format |
| :--- | :--- | :--- |
| `VERCEL_STAGING_PROJECT_ID` | Production | `prj_Hj8Qjg7x5yWZvUnO8PxYG9wYJKgs` |
| `STAGING_CONNECTIVITY_TOKEN` | Production | 64-character hexadecimal token from `openssl rand -hex 32` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Exactly `https://lavxddhrrwsjcshmnwvu.supabase.co` |
| `SUPABASE_SECRET_KEY` | Production | Staging Supabase service-role secret key (server-only) |
| `RECRUITMENT_PERIOD_ID` | Production | `87e7c760-1fb2-4e61-a803-b82a41b7847c` |
| `UPSTASH_REDIS_REST_URL` | Production | Staging Upstash Redis HTTPS REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Production | Staging Upstash Redis REST token (server-only) |

*(Ensure "Automatically expose System Environment Variables" is checked so Vercel injects `VERCEL_PROJECT_ID`).*

---

## 3. Manual Verification Procedure

Execute a GET request from your terminal:

```bash
curl -s -H "x-staging-connectivity-token: <64_HEX_TOKEN>" \
  https://spe-ugm-oprec-staging.vercel.app/api/internal/staging-connectivity
```

### Expected 200 Output (Both Services Reachable):
```json
{
  "supabase": "ok",
  "upstash": "ok"
}
```

### Failure Diagnosis:
- `{"supabase": "error", "upstash": "ok"}`:
  - `NEXT_PUBLIC_SUPABASE_URL` is not exactly `https://lavxddhrrwsjcshmnwvu.supabase.co`.
  - `SUPABASE_SECRET_KEY` is missing or invalid.
  - `RECRUITMENT_PERIOD_ID` is missing, invalid, or does not exist in `recruitment_periods`.
  - Supabase network connection timed out (>5000ms).
- `{"supabase": "ok", "upstash": "error"}`:
  - `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` missing or invalid.
  - Upstash Redis network connection timed out (>4000ms).
- `HTTP 404 Not Found`:
  - Token missing, not 64 hex characters, or mismatched.
  - Not running in Vercel with `VERCEL_ENV=production`.
  - `VERCEL_PROJECT_ID` missing or does not match `VERCEL_STAGING_PROJECT_ID`.

---

## 4. Decommissioning & Removal Steps

Once live cloud connectivity is confirmed on the dedicated staging project:

1. **Delete Route**:
   ```bash
   rm app/api/internal/staging-connectivity/route.ts
   ```
2. **Delete Tests**:
   ```bash
   rm scripts/recruitment-backend/staging-connectivity.test.cjs
   ```
3. **Delete Documentation**:
   ```bash
   rm docs/staging/B6G15-connectivity-guide.md
   ```
4. **Remove Environment Variable**:
   In Vercel staging dashboard (*Project Settings* -> *Environment Variables*), delete `STAGING_CONNECTIVITY_TOKEN`.

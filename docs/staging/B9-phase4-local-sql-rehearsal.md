# B9 Phase 4 final local SQL rehearsal - 2026-11-03

**PASS - focused local SQL rehearsal complete.** Recovery supersedes the earlier partial result. No remote database, frontend/browser/TypeScript/lint/build/Vercel tests, environment-variable changes, commit, push or deployment.

## Actual results

| Completion gate | Result |
| --- | --- |
| GUIDEBOOK_v3 migration | PASS - executed successfully after eight relevant original prerequisite migrations. |
| Unrelated trigger constraints | PASS - actual stored function bodies match outside the intended assignment block; runtime identity/content/status, batch/DOB, supporting documents, size, preference and deadline guards remain enforced. |
| Official configuration | PASS - six divisions, 13 exact canonical sub-divisions, 12 required PDF assignments; Relations & Partnership none; five requirements (three PDF/two PNG). Period remains unapproved/closed. |
| Draft rerun | PASS - complete official snapshot unchanged. |
| Already-approved rerun | PASS in rolled-back local fixture - no insert attempted, strict verification succeeds, stays closed. A deliberate ON CONFLICT child insert separately raises approved_configuration_immutable. |
| Mismatched draft/approved configuration | PASS - both safely reject exact-label mismatch; transactions roll back. |
| Assignment 1 | PASS - first Human Capital with valid assignment1 succeeds. |
| Assignment 2 | PASS - Human Capital without assignment1 rejected. |
| Assignment 3 | PASS - first Relations & Partnership without assignment succeeds. |
| Assignment 4 | PASS - Relations & Partnership with assignment1 rejected. |
| Assignment 5 | PASS - second-choice required sub-division succeeds without assignment2. |
| Assignment 6 | PASS - any assignment2 rejected. |
| Assignment 7 | PASS - invalid assignment1 format and option-specific oversize rejected; 3 MiB metadata hard cap also enforced. |
| Missing Storage object | PASS - real finalization raises storage_object_missing for metadata referencing an absent object. Corrected fixture omits object creation; no protected Storage deletion or disabled trigger. |
| Submitted/accepted preservation | PASS - complete synthetic historical snapshots match before/after migration and after all tests (period/configuration, applications, preferences/documents, audit and Storage metadata). |
| Final rollback/state | PASS - assignment-only period and temporary applications disappear; exactly two original historical fixture applications remain, one submitted and one accepted; official snapshot remains unchanged/draft/closed. |

The behavior checkpoint captured **26 named assertions** (21 behavior/preservation assertions plus five preceding configuration/history invariants). Additional approved-rerun/ON CONFLICT checks, expected mismatch failures, and four final preservation/rollback assertions also passed. Expected errors were caught by message and assertions fail if an error is missing or different. No weakened assertion, ownership repair, trigger disablement or grant override was used to pass tests.

## Lifecycle correction and isolation

New container `spe-b9-sql-recovery-82c44db7c3`; ID `a262378b9186739172ae9e9aaa7858d3ab9f1d4cec7b119ecc12263c8ccd1959`. Cached image `supabase/postgres:17.6.1.136`, exact ID `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`. PostgreSQL 17.6; fresh UTF-8 cluster. Database `spe_b9_rehearsal`, unique PGDATA `/tmp/spe-b9-sql-recovery-82c44db7c3-pgdata`.

Entrypoint initializes only when PG_VERSION is absent and the directory is absent/empty. A nonempty uninitialized directory is rejected. An initialized cluster must have major version 17 and readable global/pg_control. A stop/start of ONLY the new container retained its system identifier, proving the lifecycle fix before SQL tests. No reset, directory removal, image pull or volume reuse.

Network mode none; no host ports/bindings or mounts. Every query uses explicit container-local Unix socket /tmp, database and postgres executor via psql -X, --no-password and ON_ERROR_STOP=1. The only reused SQL artifact is the prior disposable LOCAL Auth/Storage platform-only baseline. It has no public application schema; synthetic history is generated locally, not imported from B7 or any cloud project. Bootstrap roles exist only inside this fresh isolated cluster; security policies/triggers were left enabled. These are owner-run SQL tests, not RLS/API certification.

All **15 pre-existing containers** (including UTS and the failed earlier B9 container) retained identical IDs, names, image IDs, states/start times, port bindings and network metadata. No existing container/volume/network was modified. The new recovery container is stopped, with evidence/data retained. No broad cleanup was performed.

## Configuration adapter and dates

Unmodified Cloud SQL was executed as a negative test and correctly rejected the local target. An ignored test copy replaces ONLY its remote target/TLS identity IF with exact local database/cluster/Unix-socket checks; no spoofed staging verification inputs are supplied. Part A and its configuration verification are otherwise unchanged.

Synthetic LOCAL test hours 09:17/16:43 on November 5/12 exercise date inputs only; they are not committee-confirmed official hours. No host/application environment variables were changed; inputs were transaction-local SQL GUCs. Approval/open-state writes were isolated synthetic fixtures with ROLLBACK, never activation of a real/remote official period. Official dates remain November 5-12, 2026; actual hours remain unconfirmed.

## Files, evidence and risks

Added reviewable lifecycle harness `scripts/recruitment-backend/b9-local-harness.py` and focused SQL runner `scripts/recruitment-backend/b9-local-checks.py`; updated this report. Previously corrected SQL fixtures `supabase/tests/guidebook_v3_local.sql` and `guidebook_v3_assignment_cases.sql` were retained unchanged during recovery. GUIDEBOOK_v3 migration and official configuration SQL were not changed. Existing uncommitted application edits remain untouched. Ignored `.next/b9-local-recovery/` contains inventory, source/body comparisons, adapter, per-step stdout/stderr, restart identifiers and result.json.

To reproduce in a fresh artifact directory: run the lifecycle harness, then focused SQL runner. Existing result/state files fail closed rather than automatically rerunning against a populated database. No standalone command is authorized for cloud use.

Previous failure history: the original missing-object fixture attempted a forbidden Storage deletion; it was corrected before recovery. The prior entrypoint then reran initdb against existing PGDATA; this recovery used a fresh guarded lifecycle and completed without failed retries.

Remaining risks: local PostgreSQL/platform behavior does not prove managed Cloud privileges or HTTP/Storage/API behavior. Confirm official hours and independently verify the staging target before any separately authorized remote work. Staging migration, configuration writes, approval, opening, environment activation and deployment remain separate authorization gates. No production/cloud project was accessed.

Git status: nine pre-existing modified application/test files preserved; prior untracked SQL/configuration/test artifacts preserved. This recovery adds two harness/runner files and updates the untracked report. No commit, push or deployment.

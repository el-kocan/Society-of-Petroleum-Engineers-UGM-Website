-- B9 REVIEWED DRAFT ONLY: NOT AUTHORIZED FOR EXECUTION.
-- Canonical non-secret configuration source; no credentials belong in this file.
-- Target ONLY spe-ugm-staging / lavxddhrrwsjcshmnwvu / personal organization
-- abnfnzzearslinsxnjcb. Official dates: November 5-12, 2026 (Asia/Jakarta).
-- Opening/closing hours are UNKNOWN: no midnight/end-of-day defaults are used.
--
-- Future executor MUST independently verify protected client profile, Dashboard
-- ref/API URL/organization, selected session-pooler host/user, verify-full TLS,
-- database identity and backend TLS BEFORE authorizing this file's execution.
-- current_database()='postgres' and the sentinel alone do NOT prove project identity.
-- The verified_* transaction-local inputs below record that external check;
-- they are operator attestations, NOT independently obtained identity evidence.
--
-- Required non-secret driver inputs (no defaults; absent/mismatched => abort):
-- spe_staging.verified_project_ref = lavxddhrrwsjcshmnwvu
-- spe_staging.verified_api_origin = https://lavxddhrrwsjcshmnwvu.supabase.co
-- spe_staging.verified_organization_id = abnfnzzearslinsxnjcb
-- spe_staging.verified_pooler_host = aws-0-ap-south-1.pooler.supabase.com
-- spe_staging.verified_pooler_user = postgres.lavxddhrrwsjcshmnwvu
-- spe_staging.confirmed_opens_at / confirmed_closes_at = owner-confirmed ISO
-- timestamps with explicit offset, on Nov 5 and Nov 12 respectively in Jakarta.
-- A separately approved driver must parameterize SET LOCAL/set_config inputs;
-- never interpolate credentials or accept a guessed target/connection fallback.
--
-- Part A: create/complete DRAFT and CLOSED configuration only. An existing
-- approved period takes a SELECT-only verification path: NO INSERT attempted,
-- no row lock, UPDATE, DELETE, repair or demotion. Mismatches abort transaction.
-- ON CONFLICT does not suppress BEFORE INSERT guards (PostgreSQL 17):
-- https://www.postgresql.org/docs/17/sql-insert.html
-- Canonical catalogue: src/modules/recruitment/draft-config.ts.
-- Approval, opening, trigger migration, environment changes and deployment are
-- separate actions requiring explicit authorization. No Part B/C executable SQL
-- is bundled here. Historical B7 rows are never mutation targets.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

-- Fail closed unless an independently verified target has been recorded.
DO $$
DECLARE
  v_open_text text := current_setting('spe_staging.confirmed_opens_at', true);
  v_close_text text := current_setting('spe_staging.confirmed_closes_at', true);
BEGIN
  IF current_setting('spe_staging.verified_project_ref', true) IS DISTINCT FROM 'lavxddhrrwsjcshmnwvu'
    OR current_setting('spe_staging.verified_api_origin', true) IS DISTINCT FROM 'https://lavxddhrrwsjcshmnwvu.supabase.co'
    OR current_setting('spe_staging.verified_organization_id', true) IS DISTINCT FROM 'abnfnzzearslinsxnjcb'
    OR current_setting('spe_staging.verified_pooler_host', true) IS DISTINCT FROM 'aws-0-ap-south-1.pooler.supabase.com'
    OR current_setting('spe_staging.verified_pooler_user', true) IS DISTINCT FROM 'postgres.lavxddhrrwsjcshmnwvu'
    OR current_database() <> 'postgres' OR current_user <> 'postgres'
    OR (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'STOP: explicit staging identity/TLS verification required before execution'; END IF;
  IF v_open_text IS NULL OR v_close_text IS NULL
    OR v_open_text !~ '[+-][0-9]{2}:[0-9]{2}$' OR v_close_text !~ '[+-][0-9]{2}:[0-9]{2}$'
  THEN RAISE EXCEPTION 'STOP: confirmed opening/closing timestamps with offset required; hours have no default'; END IF;
  IF (v_open_text::timestamptz AT TIME ZONE 'Asia/Jakarta')::date <> DATE '2026-11-05'
    OR (v_close_text::timestamptz AT TIME ZONE 'Asia/Jakarta')::date <> DATE '2026-11-12'
    OR v_close_text::timestamptz <= v_open_text::timestamptz
  THEN RAISE EXCEPTION 'STOP: confirmed dates must remain November 5-12, 2026'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_production_guard_sentinel')
  THEN RAISE EXCEPTION 'STOP: production sentinel detected'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- GUARD 2: Read existing synthetic identity without touching historical data.
-- Identity reference check only; not proof of complete historical integrity.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_syn_id uuid;
  v_syn_ref text;
BEGIN
  SELECT id, approval_reference INTO v_syn_id, v_syn_ref
  FROM public.recruitment_periods
  WHERE code = 'b3c1-synthetic-test';

  IF v_syn_id IS NOT NULL THEN
    IF v_syn_ref IS DISTINCT FROM 'B3-C1-SYNTHETIC-INTEGRATION-TEST-NOT-OFFICIAL' THEN
      RAISE EXCEPTION 'GUARD: Synthetic period exists but approval_reference does not match expected sentinel. Database state is unexpected.';
    END IF;
    RAISE NOTICE 'Synthetic B7 identity (%) matched; no B7 data will be modified. This is not a full integrity audit.', v_syn_id;
  ELSE
    RAISE NOTICE 'Synthetic B7 period not found. Proceeding with new period creation.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- PART A: prepare only a new/existing draft, never an approved period.
-- Draft-only row lock serializes changes with concurrent approval. The approved
-- path returns before any INSERT; a race is rechecked after acquiring the lock.
DO $prepare$
DECLARE
  v_period public.recruitment_periods;
BEGIN
  SELECT * INTO v_period FROM public.recruitment_periods WHERE code = 'oprec-2026-2027';
  IF FOUND THEN
    IF v_period.approved_at IS NOT NULL THEN
      RAISE NOTICE 'Already approved: skipping ALL INSERT operations; verification only';
      RETURN;
    END IF;
    SELECT * INTO v_period FROM public.recruitment_periods
      WHERE code = 'oprec-2026-2027' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'STOP: period changed concurrently'; END IF;
    IF v_period.approved_at IS NOT NULL THEN
      RAISE NOTICE 'Approved concurrently: skipping ALL INSERT operations; verification only';
      RETURN;
    END IF;
    IF v_period.is_open OR v_period.approval_reference IS NOT NULL THEN
      RAISE EXCEPTION 'STOP: existing draft must be closed and unapproved';
    END IF;
  ELSE
INSERT INTO public.recruitment_periods (
  code,
  label,
  config_version,
  approved_at,
  approval_reference,
  is_open,
  opens_at,
  closes_at,
  batches
)
VALUES (
  'oprec-2026-2027',
  'SPE UGM SC Staff Recruitment 2026/2027',
  1,
  NULL,   -- MUST be NULL on insert (trigger: create_draft_then_approve)
  NULL,   -- MUST be NULL when approved_at is NULL (check constraint)
  false,  -- Not open; opened only by explicit future authorization
  current_setting('spe_staging.confirmed_opens_at')::timestamptz,
  current_setting('spe_staging.confirmed_closes_at')::timestamptz,
  ARRAY['2025', '2026']
)
RETURNING * INTO v_period;
  END IF;

-- ---------------------------------------------------------------------------
-- PART A - STEP 2: Insert 13 Official Sub-Division Options
--
-- Canonical codes from src/modules/recruitment/draft-config.ts (B9-corrected).
-- Labels from draft-config.ts and landing.tsx.
--
-- Assignment policy:
--   12 sub-divisions: assignment_state = 'required', formats = ['pdf'],
--                     max_bytes = 3145728 (3 MiB)
--   relations-partnership: assignment_state = 'none', formats = NULL,
--                          max_bytes = NULL
--
-- recruitment_config_guard fires BEFORE INSERT and verifies the parent
-- period's approved_at IS NULL - satisfied because this is a draft.
-- ---------------------------------------------------------------------------
INSERT INTO public.recruitment_options (
  period_id, main_code, sub_code, main_label, sub_label,
  assignment_state, instructions, formats, max_bytes
)
SELECT
  p.id,
  v.main_code, v.sub_code, v.main_label, v.sub_label,
  v.assignment_state, v.instructions, v.formats::text[], v.max_bytes
FROM public.recruitment_periods p
CROSS JOIN (VALUES
  -- 1. Internal Affairs (2 sub-divisions)
  ('internal-affairs',   'human-capital',
   'Internal Affairs',   'Human Capital',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  ('internal-affairs',   'internal-engagement',
   'Internal Affairs',   'Internal Engagement',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  -- 2. External Affairs (2 sub-divisions; Relations & Partnership has no assignment)
  ('external-affairs',   'relations-partnership',
   'External Affairs',   'Relations & Partnership',
   'none',
   'No assignment is required for Relations & Partnership.',
   NULL, NULL),

  ('external-affairs',   'external-engagement',
   'External Affairs',   'External Engagement',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  -- 3. Research & Education (2 sub-divisions)
  ('research-education', 'research-exploration',
   'Research & Education', 'Research & Exploration',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  ('research-education', 'education-professional-growth',
   'Research & Education', 'Education & Professional Growth',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  -- 4. Compdev & IEM (2 sub-divisions)
  ('compdev-iem',        'competency-development',
   'Compdev & IEM',      'Competency Development',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  ('compdev-iem',        'international-event-manager',
   'Compdev & IEM',      'International Event Manager',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  -- 5. Finance (2 sub-divisions)
  ('finance',            'sponsorship',
   'Finance',            'Sponsorship',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  ('finance',            'fundraising',
   'Finance',            'Fundraising',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  -- 6. Media Creative (3 sub-divisions)
  ('media-creative',     'visual-design',
   'Media Creative',     'Visual design',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  ('media-creative',     'documentation',
   'Media Creative',     'Documentation',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728),

  ('media-creative',     'website-development',
   'Media Creative',     'Website Development',
   'required',
   'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).',
   ARRAY['pdf'], 3145728)

) AS v(main_code, sub_code, main_label, sub_label, assignment_state, instructions, formats, max_bytes)
WHERE p.id = v_period.id AND p.approved_at IS NULL AND NOT p.is_open
ON CONFLICT (period_id, main_code, sub_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- PART A - STEP 3: Insert 5 Document Requirements
--
-- Formats match src/modules/recruitment/config.ts documentSlots and
-- src/modules/recruitment/landing.tsx SUPPORTING_DOCUMENTS:
--   cv:          PDF only
--   idCard:      PDF only
--   commitment:  PDF only
--   followProof: PNG only
--   storyProof:  PNG only
--
-- max_bytes: 3145728 (3 MiB) for all slots.
-- ---------------------------------------------------------------------------
INSERT INTO public.recruitment_document_requirements (
  period_id, slot, required, formats, max_bytes
)
SELECT
  p.id, v.slot, true, v.formats::text[], 3145728
FROM public.recruitment_periods p
CROSS JOIN (VALUES
  ('cv',          ARRAY['pdf']),
  ('idCard',      ARRAY['pdf']),
  ('commitment',  ARRAY['pdf']),
  ('followProof', ARRAY['png']),
  ('storyProof',  ARRAY['png'])
) AS v(slot, formats)
WHERE p.id = v_period.id AND p.approved_at IS NULL AND NOT p.is_open
ON CONFLICT (period_id, slot) DO NOTHING;
END;
$prepare$;


-- ---------------------------------------------------------------------------
-- PART A - STEP 4: Validate Configuration Completeness and Consistency
--
-- These assertions verify the exact expected state. If any assertion fails,
-- the entire transaction is rolled back. This protects against:
--   - Partial inserts from a previous interrupted run
--   - Tampered configuration from a prior run with different values
--   - ON CONFLICT DO NOTHING silently skipping inserts that differ
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id          uuid;
  v_approved_at timestamptz;
  v_opt_count   integer;
  v_req_count   integer;
  v_bad_state   integer;
  v_bad_label   integer;
  v_required_12 integer;
  v_none_count  integer;
BEGIN
  -- Locate the period
  SELECT id, approved_at INTO v_id, v_approved_at
  FROM public.recruitment_periods WHERE code = 'oprec-2026-2027';

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Period oprec-2026-2027 not found after insert step.';
  END IF;

  -- If already approved, verify but do not modify
  IF v_approved_at IS NOT NULL THEN
    RAISE NOTICE 'Period oprec-2026-2027 (%) is already approved. Verifying configuration only.', v_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.recruitment_periods p WHERE p.id = v_id
    AND p.label = 'SPE UGM SC Staff Recruitment 2026/2027' AND p.config_version = 1
    AND p.batches = ARRAY['2025','2026']
    AND p.opens_at = current_setting('spe_staging.confirmed_opens_at')::timestamptz
    AND p.closes_at = current_setting('spe_staging.confirmed_closes_at')::timestamptz
    AND (p.approved_at IS NOT NULL OR (NOT p.is_open AND p.approval_reference IS NULL)))
  THEN RAISE EXCEPTION 'ASSERTION FAILED: period fields/schedule/draft-closed state mismatch'; END IF;

  IF EXISTS (
    WITH expected(main_code, sub_code, main_label, sub_label) AS (VALUES
      ('internal-affairs', 'human-capital', 'Internal Affairs', 'Human Capital'),
      ('internal-affairs', 'internal-engagement', 'Internal Affairs', 'Internal Engagement'),
      ('external-affairs', 'relations-partnership', 'External Affairs', 'Relations & Partnership'),
      ('external-affairs', 'external-engagement', 'External Affairs', 'External Engagement'),
      ('research-education', 'research-exploration', 'Research & Education', 'Research & Exploration'),
      ('research-education', 'education-professional-growth', 'Research & Education', 'Education & Professional Growth'),
      ('compdev-iem', 'competency-development', 'Compdev & IEM', 'Competency Development'),
      ('compdev-iem', 'international-event-manager', 'Compdev & IEM', 'International Event Manager'),
      ('finance', 'sponsorship', 'Finance', 'Sponsorship'),
      ('finance', 'fundraising', 'Finance', 'Fundraising'),
      ('media-creative', 'visual-design', 'Media Creative', 'Visual design'),
      ('media-creative', 'documentation', 'Media Creative', 'Documentation'),
      ('media-creative', 'website-development', 'Media Creative', 'Website Development')
    )
    SELECT 1 FROM expected e JOIN public.recruitment_options o
      ON o.period_id = v_id AND o.main_code = e.main_code AND o.sub_code = e.sub_code
    WHERE o.main_label IS DISTINCT FROM e.main_label OR o.sub_label IS DISTINCT FROM e.sub_label
      OR o.instructions IS DISTINCT FROM CASE WHEN e.sub_code = 'relations-partnership'
        THEN 'No assignment is required for Relations & Partnership.'
        ELSE 'Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).' END
  ) THEN RAISE EXCEPTION 'ASSERTION FAILED: exact catalogue labels/instructions mismatch'; END IF;

  -- Total option count
  SELECT count(*) INTO v_opt_count
  FROM public.recruitment_options WHERE period_id = v_id;
  IF v_opt_count <> 13 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Expected exactly 13 options, found %. Period: %', v_opt_count, v_id;
  END IF;

  -- Verify exact set of 13 canonical (main_code, sub_code) pairs
  IF (
    SELECT count(*) FROM public.recruitment_options
    WHERE period_id = v_id
      AND (main_code, sub_code) IN (
        ('internal-affairs',   'human-capital'),
        ('internal-affairs',   'internal-engagement'),
        ('external-affairs',   'relations-partnership'),
        ('external-affairs',   'external-engagement'),
        ('research-education', 'research-exploration'),
        ('research-education', 'education-professional-growth'),
        ('compdev-iem',        'competency-development'),
        ('compdev-iem',        'international-event-manager'),
        ('finance',            'sponsorship'),
        ('finance',            'fundraising'),
        ('media-creative',     'visual-design'),
        ('media-creative',     'documentation'),
        ('media-creative',     'website-development')
      )
  ) <> 13 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Not all 13 canonical (main_code, sub_code) pairs are present.';
  END IF;

  -- Verify 12 required assignments with correct formats and max_bytes
  SELECT count(*) INTO v_required_12
  FROM public.recruitment_options
  WHERE period_id = v_id
    AND assignment_state = 'required'
    AND formats = ARRAY['pdf']
    AND max_bytes = 3145728;
  IF v_required_12 <> 12 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Expected 12 required-PDF options, found %. Period: %', v_required_12, v_id;
  END IF;

  -- Verify Relations & Partnership is the single 'none' option
  SELECT count(*) INTO v_none_count
  FROM public.recruitment_options
  WHERE period_id = v_id AND assignment_state = 'none';
  IF v_none_count <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Expected exactly 1 none-assignment option, found %.', v_none_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recruitment_options
    WHERE period_id = v_id
      AND main_code = 'external-affairs'
      AND sub_code = 'relations-partnership'
      AND assignment_state = 'none'
      AND formats IS NULL
      AND max_bytes IS NULL
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Relations & Partnership option missing or misconfigured.';
  END IF;

  -- No unconfirmed options
  SELECT count(*) INTO v_bad_state
  FROM public.recruitment_options
  WHERE period_id = v_id AND assignment_state = 'unconfirmed';
  IF v_bad_state > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % option(s) have unconfirmed assignment_state.', v_bad_state;
  END IF;

  -- Consistent main_label per main_code
  SELECT count(*) INTO v_bad_label
  FROM (
    SELECT main_code FROM public.recruitment_options
    WHERE period_id = v_id
    GROUP BY main_code HAVING count(DISTINCT main_label) <> 1
  ) sub;
  IF v_bad_label > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Inconsistent main_label for % main_code group(s).', v_bad_label;
  END IF;

  -- Document requirements: exactly 5
  SELECT count(*) INTO v_req_count
  FROM public.recruitment_document_requirements WHERE period_id = v_id;
  IF v_req_count <> 5 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Expected 5 document requirements, found %. Period: %', v_req_count, v_id;
  END IF;

  -- Verify exact document requirement formats
  IF NOT EXISTS (SELECT 1 FROM public.recruitment_document_requirements WHERE period_id = v_id AND slot = 'cv'          AND required AND formats = ARRAY['pdf'] AND max_bytes = 3145728) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: cv requirement missing or misconfigured.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruitment_document_requirements WHERE period_id = v_id AND slot = 'idCard'      AND required AND formats = ARRAY['pdf'] AND max_bytes = 3145728) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: idCard requirement missing or misconfigured.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruitment_document_requirements WHERE period_id = v_id AND slot = 'commitment'  AND required AND formats = ARRAY['pdf'] AND max_bytes = 3145728) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: commitment requirement missing or misconfigured.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruitment_document_requirements WHERE period_id = v_id AND slot = 'followProof' AND required AND formats = ARRAY['png'] AND max_bytes = 3145728) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: followProof requirement missing or misconfigured. Expected PNG only.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruitment_document_requirements WHERE period_id = v_id AND slot = 'storyProof'  AND required AND formats = ARRAY['png'] AND max_bytes = 3145728) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: storyProof requirement missing or misconfigured. Expected PNG only.';
  END IF;

  RAISE NOTICE 'Part A verification passed for period oprec-2026-2027 (%). Existing approval/open state was not changed.', v_id;
  IF v_approved_at IS NULL THEN
    RAISE NOTICE 'Period is a DRAFT (approved_at IS NULL, is_open = false). Approval requires separate Part B authorization.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 5: Emit period summary for operator review
-- ---------------------------------------------------------------------------
SELECT
  id            AS period_uuid,
  code,
  label,
  config_version,
  approved_at,
  approval_reference,
  is_open,
  opens_at,
  closes_at,
  batches,
  (SELECT count(*) FROM public.recruitment_options o WHERE o.period_id = p.id)                AS option_count,
  (SELECT count(*) FROM public.recruitment_document_requirements r WHERE r.period_id = p.id)  AS requirement_count
FROM public.recruitment_periods p
WHERE p.code = 'oprec-2026-2027';

COMMIT;

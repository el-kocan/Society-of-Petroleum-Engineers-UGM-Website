-- 20261103000000_guidebook_v3_assignment_policy.sql
-- Aligns recruitment_application_guard with approved GUIDEBOOK_v3:
-- 1. First preference (rank 1): assignment enforced by option assignment_state (required requires assignment1, none forbids assignment1).
-- 2. Second preference (rank 2): assignment is never required or accepted (assignment2 is forbidden; rank 2 does not inherit rank 1 required checks).
-- 3. Staging and production safety: does not alter historic records or unsubmitted status flow.

create or replace function public.recruitment_application_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.recruitment_periods;
begin
  if tg_op = 'INSERT' and new.status <> 'uploading' then raise exception 'initial_status_invalid'; end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.period_id <> old.period_id or new.nim <> old.nim
      or new.idempotency_key <> old.idempotency_key or new.request_hash <> old.request_hash then
      raise exception 'application_identity_immutable';
    end if;
    if old.status <> 'uploading' and
      (to_jsonb(new) - array['status','reviewed_by','reviewed_at','review_note','updated_at'])
        is distinct from
      (to_jsonb(old) - array['status','reviewed_by','reviewed_at','review_note','updated_at']) then
      raise exception 'application_content_locked';
    end if;
    if new.status <> old.status and not (
      (old.status = 'uploading' and new.status = 'submitted') or
      (old.status = 'submitted' and new.status in ('under_review','withdrawn')) or
      (old.status = 'under_review' and new.status in ('accepted','rejected','withdrawn'))
    ) then raise exception 'status_transition_invalid'; end if;
  end if;
  if tg_op = 'INSERT' or old.status = 'uploading' then
    select * into p from public.recruitment_periods where id = new.period_id for share;
    if p.approved_at is null or not p.is_open or clock_timestamp() < p.opens_at or clock_timestamp() >= p.closes_at then
      raise exception 'recruitment_not_open';
    end if;
    if not (new.batch = any(p.batches)) or new.birth_date > (clock_timestamp() at time zone 'Asia/Jakarta')::date then
      raise exception 'personal_information_invalid';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'uploading' and new.status = 'submitted' then
    if (select count(*) from public.recruitment_preferences where application_id = new.id) <> 2 then
      raise exception 'two_preferences_required';
    end if;
    if exists (
      select 1 from public.recruitment_preferences r
      join public.recruitment_options o using (period_id, main_code, sub_code)
      left join public.recruitment_documents d on d.application_id = r.application_id
        and d.slot = 'assignment' || r.rank::text
      where r.application_id = new.id and (
        (r.rank = 1 and (
          o.assignment_state = 'unconfirmed' or
          (o.assignment_state = 'required' and d.id is null) or
          (o.assignment_state = 'none' and d.id is not null) or
          (d.id is not null and (not (d.format = any(o.formats)) or d.byte_size > o.max_bytes))
        ))
        or
        (r.rank = 2 and d.id is not null)
      )
    ) or exists (
      select 1 from public.recruitment_documents d
      where d.application_id = new.id and d.slot = 'assignment2'
    ) then raise exception 'assignment_requirements_not_met'; end if;
    if exists (
      select 1 from public.recruitment_document_requirements r
      left join public.recruitment_documents d on d.application_id = new.id and d.slot = r.slot
      where r.period_id = new.period_id and (
        (r.required and d.id is null) or
        (d.id is not null and (not (d.format = any(r.formats)) or d.byte_size > r.max_bytes))
      )
    ) then raise exception 'supporting_documents_not_met'; end if;
    if exists (select 1 from public.recruitment_documents d where d.application_id = new.id
      and not exists (select 1 from storage.objects s where s.bucket_id = d.bucket_id and s.name = d.object_name)) then
      raise exception 'storage_object_missing';
    end if;
    new.submitted_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- B9 focused behavior cases. New network-disabled LOCAL container only.
-- All applications, metadata, approval/opening and audit writes roll back.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'spe_b9_rehearsal' OR current_setting('cluster_name') NOT LIKE 'spe-b9-sql-%' OR inet_server_addr() IS NOT NULL
 THEN RAISE EXCEPTION 'Not isolated B9 local database'; END IF;
END $$;
INSERT INTO public.recruitment_periods(code,label,opens_at,closes_at,batches)
VALUES('b9-assignment-only','LOCAL synthetic assignment cases','2000-01-01','2099-01-01',ARRAY['2026']);
INSERT INTO public.recruitment_options(period_id,main_code,sub_code,main_label,sub_label,assignment_state,instructions,formats,max_bytes)
SELECT p.id,o.main_code,o.sub_code,o.main_label,o.sub_label,o.assignment_state,o.instructions,o.formats,
 CASE WHEN o.sub_code='human-capital' THEN 1048576 ELSE o.max_bytes END
FROM public.recruitment_periods p CROSS JOIN public.recruitment_options o
WHERE p.code='b9-assignment-only' AND o.period_id=(SELECT id FROM public.recruitment_periods WHERE code='oprec-2026-2027');
INSERT INTO public.recruitment_document_requirements(period_id,slot,required,formats,max_bytes)
SELECT p.id,r.slot,r.required,r.formats,r.max_bytes FROM public.recruitment_periods p CROSS JOIN public.recruitment_document_requirements r
WHERE p.code='b9-assignment-only' AND r.period_id=(SELECT id FROM public.recruitment_periods WHERE code='oprec-2026-2027');
UPDATE public.recruitment_periods SET approved_at=now(),approval_reference='LOCAL-ROLLBACK-ONLY',is_open=true WHERE code='b9-assignment-only';
DO $$
DECLARE period uuid; app uuid; r record;
BEGIN
 SELECT id INTO STRICT period FROM public.recruitment_periods WHERE code='b9-assignment-only';
 app := b9_test.application(period,'b9-valid-hc','human-capital','relations-partnership','pdf');
 PERFORM b9_test.finalize(app);
 PERFORM b9_test.ok('1 Human Capital with assignment1 succeeds',(SELECT status='submitted' FROM public.recruitment_applications WHERE id=app));
 PERFORM b9_test.expect_error('submitted content remains immutable',format('UPDATE public.recruitment_applications SET email=''changed@example.invalid'' WHERE id=%L',app),'application_content_locked');
 PERFORM b9_test.expect_error('invalid status transition remains denied',format('UPDATE public.recruitment_applications SET status=''accepted'' WHERE id=%L',app),'status_transition_invalid');
 app := b9_test.application(period,'b9-missing-hc','human-capital','relations-partnership');
 PERFORM b9_test.expect_error('2 missing assignment1 rejected',format('SELECT b9_test.finalize(%L)',app),'assignment_requirements_not_met');
 PERFORM b9_test.expect_error('identity remains immutable',format('UPDATE public.recruitment_applications SET request_hash=repeat(''b'',64) WHERE id=%L',app),'application_identity_immutable');
 PERFORM b9_test.expect_error('future birth date remains denied',format('UPDATE public.recruitment_applications SET birth_date=current_date+1 WHERE id=%L',app),'personal_information_invalid');
 PERFORM b9_test.expect_error('invalid batch remains denied',format('UPDATE public.recruitment_applications SET batch=''1900'' WHERE id=%L',app),'personal_information_invalid');
 app := b9_test.application(period,'b9-relations','relations-partnership','human-capital');
 PERFORM b9_test.finalize(app);
 PERFORM b9_test.ok('3 Relations without assignment succeeds',(SELECT status='submitted' FROM public.recruitment_applications WHERE id=app));
 PERFORM b9_test.ok('5 second required choice needs no assignment2',NOT EXISTS(SELECT 1 FROM public.recruitment_documents WHERE application_id=app AND slot='assignment2'));
 app := b9_test.application(period,'b9-relations-extra','relations-partnership','human-capital','pdf');
 PERFORM b9_test.expect_error('4 Relations with assignment rejected',format('SELECT b9_test.finalize(%L)',app),'assignment_requirements_not_met');
 app := b9_test.application(period,'b9-rank2-extra','human-capital','internal-engagement','pdf');
 PERFORM b9_test.document(app,'assignment2','pdf');
 PERFORM b9_test.expect_error('6 any assignment2 rejected',format('SELECT b9_test.finalize(%L)',app),'assignment_requirements_not_met');
 app := b9_test.application(period,'b9-format','human-capital','relations-partnership','png');
 PERFORM b9_test.expect_error('7 invalid assignment1 format rejected',format('SELECT b9_test.finalize(%L)',app),'assignment_requirements_not_met');
 app := b9_test.application(period,'b9-size','human-capital','relations-partnership','pdf',1048577);
 PERFORM b9_test.expect_error('7 assignment exceeds option max rejected',format('SELECT b9_test.finalize(%L)',app),'assignment_requirements_not_met');
 app := b9_test.application(period,'b9-max-size','human-capital','relations-partnership');
 PERFORM b9_test.expect_error('3MiB metadata hard cap preserved',format('SELECT b9_test.document(%L,''assignment1'',''pdf'',3145729)',app),'check constraint');
 app := b9_test.application(period,'b9-two-ranks','human-capital','relations-partnership','pdf');
 DELETE FROM public.recruitment_preferences WHERE application_id=app AND rank=2;
 PERFORM b9_test.expect_error('two ranked preferences still required',format('SELECT b9_test.finalize(%L)',app),'two_preferences_required');
 app := b9_test.application(period,'b9-missing-cv','human-capital','relations-partnership','pdf');
 DELETE FROM public.recruitment_documents WHERE application_id=app AND slot='cv';
 PERFORM b9_test.expect_error('supporting documents still required',format('SELECT b9_test.finalize(%L)',app),'supporting_documents_not_met');
 -- Build an absent-object fixture directly; never bypass Storage protect_delete.
 app := gen_random_uuid();
 INSERT INTO public.recruitment_applications(id,period_id,idempotency_key,request_hash,full_name,nim,birth_place,birth_date,email,phone,major,batch)
 VALUES(app,period,gen_random_uuid(),repeat('a',64),'Synthetic B9 Applicant','b9-missing-object','Synthetic','2006-01-01','b9@example.invalid','0000000000','Synthetic','2026');
 INSERT INTO public.recruitment_preferences(application_id,period_id,rank,main_code,sub_code,motivation)
 SELECT app,period,rank,main_code,sub_code,'Synthetic' FROM public.recruitment_preferences
 WHERE application_id=(SELECT id FROM public.recruitment_applications WHERE nim='b9-missing-cv' AND period_id=period);
 FOR r IN SELECT * FROM public.recruitment_document_requirements WHERE period_id=period LOOP
   PERFORM b9_test.document(app,r.slot,r.formats[1],10,r.slot<>'cv');
 END LOOP;
 PERFORM b9_test.document(app,'assignment1','pdf');
 PERFORM b9_test.expect_error('actual Storage metadata still required',format('SELECT b9_test.finalize(%L)',app),'storage_object_missing');
 app := b9_test.application(period,'b9-same-parent','human-capital','internal-engagement','pdf');
 PERFORM b9_test.finalize(app);
 PERFORM b9_test.ok('distinct same-parent ranked choices succeed',(SELECT status='submitted' FROM public.recruitment_applications WHERE id=app));
 PERFORM b9_test.expect_error('duplicate NIM uniqueness preserved',format('SELECT b9_test.application(%L,''b9-same-parent'',''human-capital'',''internal-engagement'',''pdf'')',period),'duplicate key');
 UPDATE public.recruitment_periods SET is_open=false WHERE id=period;
 PERFORM b9_test.expect_error('closed period still denied',format('SELECT b9_test.application(%L,''b9-closed'',''human-capital'',''internal-engagement'',''pdf'')',period),'recruitment_not_open');
 PERFORM b9_test.ok('8 historic submitted/accepted rows unchanged',b9_test.snapshot('b3c1-synthetic-test')=(SELECT value FROM b9_test.snapshots WHERE name='b7'));
END $$;
SELECT json_build_object('assertions',count(*),'passed_scenarios',json_agg(name ORDER BY name)) FROM b9_test.results;
ROLLBACK;

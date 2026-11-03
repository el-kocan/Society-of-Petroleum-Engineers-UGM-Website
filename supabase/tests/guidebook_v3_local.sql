-- LOCAL ONLY. Synthetic SQL fixtures; no passwords, real users, or uploads.
-- Runner must use the new network-disabled B9 container and explicit Unix socket.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'spe_b9_rehearsal'
 OR current_setting('cluster_name') NOT LIKE 'spe-b9-sql-%'
 OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'Not isolated B9 local database'; END IF;
END $$;
CREATE SCHEMA b9_test;
CREATE TABLE b9_test.results(name text primary key);
CREATE TABLE b9_test.snapshots(name text primary key, value jsonb);
CREATE FUNCTION b9_test.ok(name text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed assertion: %',name; END IF;
 INSERT INTO b9_test.results VALUES(name); END $$;
CREATE FUNCTION b9_test.expect_error(name text, statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught boolean := false;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
   IF position(expected IN SQLERRM)=0 THEN RAISE; END IF;
   caught := true;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'Expected error missing: %',name; END IF;
 INSERT INTO b9_test.results VALUES(name);
END $$;
CREATE FUNCTION b9_test.document(app uuid, slot_name text, file_format text DEFAULT 'pdf', bytes integer DEFAULT 10, with_object boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE doc uuid := gen_random_uuid(); period uuid; object_path text;
BEGIN
 SELECT period_id INTO STRICT period FROM public.recruitment_applications WHERE id=app;
 object_path := period::text || '/' || app::text || '/' || doc::text || '.' || file_format;
 INSERT INTO public.recruitment_documents(id,application_id,period_id,slot,object_name,format,byte_size,sha256,verified_at)
 VALUES(doc,app,period,slot_name,object_path,file_format,bytes,repeat('a',64),now());
 IF with_object THEN INSERT INTO storage.objects(bucket_id,name) VALUES('recruitment-documents',object_path); END IF;
END $$;
CREATE FUNCTION b9_test.application(period uuid, nim_value text, first_sub text, second_sub text, assignment text DEFAULT NULL, assignment_bytes integer DEFAULT 10)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE app uuid := gen_random_uuid(); r record;
BEGIN
 INSERT INTO public.recruitment_applications(id,period_id,idempotency_key,request_hash,full_name,nim,birth_place,birth_date,email,phone,major,batch)
 VALUES(app,period,gen_random_uuid(),repeat('a',64),'Synthetic B9 Applicant',nim_value,'Synthetic','2006-01-01','b9@example.invalid','0000000000','Synthetic','2026');
 INSERT INTO public.recruitment_preferences(application_id,period_id,rank,main_code,sub_code,motivation)
 SELECT app,period,1,main_code,sub_code,'Synthetic' FROM public.recruitment_options WHERE period_id=period AND sub_code=first_sub;
 INSERT INTO public.recruitment_preferences(application_id,period_id,rank,main_code,sub_code,motivation)
 SELECT app,period,2,main_code,sub_code,'Synthetic' FROM public.recruitment_options WHERE period_id=period AND sub_code=second_sub;
 FOR r IN SELECT * FROM public.recruitment_document_requirements WHERE period_id=period LOOP
  PERFORM b9_test.document(app,r.slot,r.formats[1]);
 END LOOP;
 IF assignment IS NOT NULL THEN PERFORM b9_test.document(app,'assignment1',assignment,assignment_bytes); END IF;
 RETURN app;
END $$;
CREATE FUNCTION b9_test.finalize(app uuid) RETURNS uuid LANGUAGE sql AS $$
 SELECT public.recruitment_finalize(id,idempotency_key,request_hash) FROM public.recruitment_applications WHERE id=app;
$$;
CREATE FUNCTION b9_test.snapshot(code_value text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'period',to_jsonb(p),
 'options',(SELECT jsonb_agg(to_jsonb(o) ORDER BY main_code,sub_code) FROM public.recruitment_options o WHERE period_id=p.id),
 'requirements',(SELECT jsonb_agg(to_jsonb(r) ORDER BY slot) FROM public.recruitment_document_requirements r WHERE period_id=p.id),
 'applications',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.recruitment_applications a WHERE period_id=p.id),
 'preferences',(SELECT jsonb_agg(to_jsonb(r) ORDER BY application_id,rank) FROM public.recruitment_preferences r WHERE period_id=p.id),
 'documents',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.recruitment_documents d WHERE period_id=p.id),
 'audit',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.recruitment_audit e WHERE period_id=p.id),
 'objects',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o WHERE name LIKE p.id::text || '/%')
 ) FROM public.recruitment_periods p WHERE code=code_value;
$$;
-- B7-like history created only here; never reads or imports actual B7 rows.
INSERT INTO auth.users(id,email) VALUES('b9000000-0000-4000-a000-000000000001','b9-reviewer@example.invalid');
INSERT INTO public.profiles(id,username,role,is_active) VALUES('b9000000-0000-4000-a000-000000000001','b9.synthetic','super_admin',true);
SELECT set_config('request.jwt.claim.sub','b9000000-0000-4000-a000-000000000001',true);
INSERT INTO public.recruitment_periods(code,label,opens_at,closes_at,batches)
VALUES('b3c1-synthetic-test','Synthetic B7 preservation fixture','2000-01-01','2099-01-01',ARRAY['2026']);
INSERT INTO public.recruitment_options(period_id,main_code,sub_code,main_label,sub_label,assignment_state,instructions,formats,max_bytes)
SELECT p.id,v.* FROM public.recruitment_periods p CROSS JOIN (VALUES
 ('internal-affairs','human-capital','Internal Affairs','Human Capital','required','Synthetic',ARRAY['pdf'],1048576),
 ('external-affairs','relations-partnership','External Affairs','Relations & Partnership','none','Synthetic',NULL,NULL)
) v WHERE p.code='b3c1-synthetic-test';
INSERT INTO public.recruitment_document_requirements(period_id,slot,formats,max_bytes)
SELECT p.id,v.slot,v.formats,3145728 FROM public.recruitment_periods p CROSS JOIN (VALUES
 ('cv',ARRAY['pdf']),('idCard',ARRAY['pdf']),('commitment',ARRAY['pdf']),('followProof',ARRAY['png']),('storyProof',ARRAY['png'])
) v(slot,formats) WHERE p.code='b3c1-synthetic-test';
UPDATE public.recruitment_periods SET approved_at=now(),approval_reference='B3-C1-SYNTHETIC-INTEGRATION-TEST-NOT-OFFICIAL',is_open=true WHERE code='b3c1-synthetic-test';
DO $$ DECLARE period uuid; app uuid; BEGIN
 SELECT id INTO period FROM public.recruitment_periods WHERE code='b3c1-synthetic-test';
 app := b9_test.application(period,'b9-history-submitted','human-capital','relations-partnership','pdf');
 PERFORM b9_test.finalize(app);
 app := b9_test.application(period,'b9-history-accepted','human-capital','relations-partnership','pdf');
 PERFORM b9_test.finalize(app);
 PERFORM public.recruitment_review(app,'under_review'); PERFORM public.recruitment_review(app,'accepted');
END $$;
INSERT INTO b9_test.snapshots VALUES('b7',b9_test.snapshot('b3c1-synthetic-test'));
COMMIT;

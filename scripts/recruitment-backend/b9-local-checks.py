"""B9 focused LOCAL SQL checks. Requires fresh b9-local-harness.py setup."""
from pathlib import Path
import importlib.util,json,re,hashlib,subprocess,sys
sys.dont_write_bytecode=True
ROOT=Path.cwd();WORK=ROOT/'.next/b9-local-recovery'
assert not (WORK/'result.json').exists(), 'Completed/failed evidence exists: no automatic rerun'
spec=importlib.util.spec_from_file_location('local',ROOT/'scripts/recruitment-backend/b9-local-harness.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
state=json.loads((WORK/'state.json').read_text());r.NAME=state['name']
result={'container':state,'tests':[],'corrections':[]}
def sql(s,label,expected=None):
 p=r.sql(s,label,ok=expected is None)
 if expected:
  assert p.returncode!=0 and expected in p.stderr.decode(),label+': wrong expected failure'
 result['tests'].append({'name':label,'pass':True,'expected_failure':expected})
 print('PASS',label,flush=True);return p.stdout.decode()
source=(ROOT/'scripts/recruitment-backend/guidebook-v3-staging-config.sql').read_text(encoding='utf8')
# The local-only adapter changes exactly the remote target/TLS IF, not Part A.
pattern=r"  IF current_setting\('spe_staging.verified_project_ref'.*?END IF;"
replacement="  IF current_database() <> 'spe_b9_rehearsal' OR current_setting('cluster_name') <> '"+r.NAME+"' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'STOP: wrong isolated local target'; END IF;"
adapter,count=re.subn(pattern,replacement,source,count=1,flags=re.S);assert count==1
# Synthetic, deliberately non-official times; no environment variables changed.
inputs="SELECT set_config('spe_staging.confirmed_opens_at','2026-11-05T09:17:00+07:00',true); SELECT set_config('spe_staging.confirmed_closes_at','2026-11-12T16:43:00+07:00',true);"
adapter=adapter.replace('BEGIN;','BEGIN;\n'+inputs,1)
(WORK/'local-config-adapter.sql').write_text(adapter)
try:
 sql((ROOT/'supabase/tests/guidebook_v3_local.sql').read_text(),'synthetic-baseline')
 old=sql("SELECT prosrc FROM pg_proc WHERE oid='public.recruitment_application_guard()'::regprocedure;",'original-trigger-body')
 migration=ROOT/'supabase/migrations/20261103000000_guidebook_v3_assignment_policy.sql'
 sql(migration.read_text(),'guidebook-v3-migration')
 new=sql("SELECT prosrc FROM pg_proc WHERE oid='public.recruitment_application_guard()'::regprocedure;",'updated-trigger-body')
 assignment=r"if exists\s*\(\s*select 1 from public.recruitment_preferences r.*?then raise exception 'assignment_requirements_not_met'; end if;"
 a,n1=re.subn(assignment,'ASSIGNMENT_RULE',old,flags=re.S);b,n2=re.subn(assignment,'ASSIGNMENT_RULE',new,flags=re.S)
 assert n1==n2==1 and a.split()==b.split(),'Unrelated trigger behavior changed'
 result['tests'].append({'name':'all-unrelated-trigger-source-preserved','pass':True})
 sql("SELECT b9_test.ok('historic rows unchanged by migration',b9_test.snapshot('b3c1-synthetic-test')=(SELECT value FROM b9_test.snapshots WHERE name='b7'));",'history-after-migration')
 sql(source,'cloud-guard-rejects-local',expected='explicit staging identity/TLS verification required')
 sql(adapter,'config-new-draft')
 checks="""SELECT b9_test.ok('canonical counts', (SELECT count(DISTINCT main_code)=6 AND count(*)=13 AND count(*) FILTER(WHERE assignment_state='required')=12 AND count(*) FILTER(WHERE sub_code='relations-partnership' AND assignment_state='none')=1 FROM public.recruitment_options WHERE period_id=(SELECT id FROM public.recruitment_periods WHERE code='oprec-2026-2027')));
 SELECT b9_test.ok('five requirements', (SELECT count(*)=5 AND count(*) FILTER(WHERE formats=ARRAY['pdf'])=3 AND count(*) FILTER(WHERE formats=ARRAY['png'])=2 FROM public.recruitment_document_requirements WHERE period_id=(SELECT id FROM public.recruitment_periods WHERE code='oprec-2026-2027')));
 SELECT b9_test.ok('official draft and closed', (SELECT approved_at IS NULL AND approval_reference IS NULL AND NOT is_open FROM public.recruitment_periods WHERE code='oprec-2026-2027'));
 INSERT INTO b9_test.snapshots VALUES('official',b9_test.snapshot('oprec-2026-2027'));
 """
 sql(checks,'official-configuration-checks')
 sql(adapter,'config-existing-draft')
 sql("SELECT b9_test.ok('draft rerun unchanged',b9_test.snapshot('oprec-2026-2027')=(SELECT value FROM b9_test.snapshots WHERE name='official'));",'draft-rerun-unchanged')
 inner=adapter[adapter.index('BEGIN;')+6:adapter.rindex('COMMIT;')]
 approved="UPDATE public.recruitment_periods SET approved_at=now(),approval_reference='LOCAL-ROLLED-BACK-ONLY' WHERE code='oprec-2026-2027';"
 sql('BEGIN;'+approved+inner+"SELECT b9_test.ok('approved rerun stayed closed',(SELECT approved_at IS NOT NULL AND NOT is_open FROM public.recruitment_periods WHERE code='oprec-2026-2027')); SELECT b9_test.expect_error('ON CONFLICT still invokes BEFORE INSERT', $q$ INSERT INTO public.recruitment_options SELECT * FROM public.recruitment_options WHERE period_id=(SELECT id FROM public.recruitment_periods WHERE code='oprec-2026-2027') ON CONFLICT DO NOTHING $q$, 'approved_configuration_immutable'); ROLLBACK;",'config-approved-rerun')
 mismatch="UPDATE public.recruitment_options SET sub_label='LOCAL MISMATCH' WHERE period_id=(SELECT id FROM public.recruitment_periods WHERE code='oprec-2026-2027') AND sub_code='human-capital';"
 sql('BEGIN;'+mismatch+inner+'ROLLBACK;','config-mismatch-draft',expected='exact catalogue labels/instructions mismatch')
 sql('BEGIN;'+mismatch+approved+inner+'ROLLBACK;','config-mismatch-approved',expected='exact catalogue labels/instructions mismatch')
 sql((ROOT/'supabase/tests/guidebook_v3_assignment_cases.sql').read_text(),'assignment-behavior')
 behavior=json.loads(next(x for x in (WORK/'assignment-behavior.stdout').read_text().splitlines() if x.startswith('{')))
 result['behavior']=behavior
 sql("SELECT b9_test.ok('B7 end snapshot unchanged',b9_test.snapshot('b3c1-synthetic-test')=(SELECT value FROM b9_test.snapshots WHERE name='b7')); SELECT b9_test.ok('official end snapshot unchanged',b9_test.snapshot('oprec-2026-2027')=(SELECT value FROM b9_test.snapshots WHERE name='official')); SELECT b9_test.ok('assignment fixture rollback complete', NOT EXISTS(SELECT 1 FROM public.recruitment_periods WHERE code='b9-assignment-only')); SELECT b9_test.ok('only original submitted and accepted fixtures remain',(SELECT count(*)=2 AND count(*) FILTER(WHERE status='submitted')=1 AND count(*) FILTER(WHERE status='accepted')=1 FROM public.recruitment_applications)); SELECT count(*) FROM b9_test.results;",'final-preservation')
 result['pass']=True
 result['behavior_assertion_count']=behavior['assertions']
 print(json.dumps(behavior,indent=2),flush=True)
except Exception as e:
 result['pass']=False;result['failure']=str(e);print('STOP',str(e),flush=True)
finally:
 before=json.loads((WORK/'before.json').read_text());after=r.inventory();result['all_existing_containers_unchanged']=all(x in after for x in before)
 r.cmd(r.D+['stop',r.NAME]);result['new_container_stopped']=True
 (WORK/'result.json').write_text(json.dumps(result,indent=2))
 print('RESULT',json.dumps({'pass':result.get('pass'),'existing_unchanged':result['all_existing_containers_unchanged'],'stopped':True}),flush=True)

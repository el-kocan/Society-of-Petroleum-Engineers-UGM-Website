"""B9 LOCAL ONLY: fresh network-disabled PostgreSQL, cached image, no environment edits."""
from pathlib import Path
import subprocess,json,uuid,time,shutil,re,hashlib
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'.next/b9-local-recovery'
NAME='spe-b9-sql-recovery-'+uuid.uuid4().hex[:10]
IMAGE='supabase/postgres:17.6.1.136'
DB='spe_b9_rehearsal'
D=['docker','--host','npipe:////./pipe/dockerDesktopLinuxEngine']
def cmd(args,data=None,check=True):
 p=subprocess.run(args,input=data,capture_output=True,timeout=90,cwd=ROOT)
 if check and p.returncode: raise RuntimeError(p.stderr.decode(errors='replace')[-2000:])
 return p

def inventory():
 ids=cmd(D+['ps','-aq']).stdout.decode().split()
 fmt='{{json .Id}}|{{json .Name}}|{{json .State.Status}}|{{json .State.StartedAt}}|{{json .Image}}|{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Networks}}'
 return cmd(D+['inspect','--format',fmt,*ids]).stdout.decode().splitlines()

def sql(text,label,ok=True):
 p=cmd(D+['exec','-i',NAME,'psql','-X','--no-password','--host','/tmp','-U','postgres','-d',DB,'-v','ON_ERROR_STOP=1','-qAt','-f','-'],text.encode(),check=False)
 (WORK/(label+'.stdout')).write_bytes(p.stdout);(WORK/(label+'.stderr')).write_bytes(p.stderr)
 if ok and p.returncode:raise RuntimeError(label+': '+p.stderr.decode(errors='replace')[-1600:])
 return p

if __name__=='__main__':
 WORK.mkdir(exist_ok=True)
 assert not (WORK/'state.json').exists(),'No automatic infrastructure retry'
 assert shutil.disk_usage('C:/').free>5*2**30
 before=inventory();assert not any(NAME in x for x in before)
 cmd(D+['image','inspect',IMAGE])
 image_id=cmd(D+['image','inspect','--format','{{.Id}}',IMAGE]).stdout.decode().strip()
 (WORK/'before.json').write_text(json.dumps(before))
 state={'name':NAME,'image':IMAGE,'image_id':image_id,'database':DB,'existing_containers':len(before)}
 (WORK/'state.json').write_text(json.dumps(state,indent=2))
 data='/tmp/'+NAME+'-pgdata'
 shell=f'''set -eu
if [ -s {data}/PG_VERSION ]; then
  test "$(cat {data}/PG_VERSION)" = "17"
  test -r {data}/global/pg_control
elif [ -d {data} ] && [ -n "$(ls -A {data})" ]; then
  echo "Refusing nonempty uninitialized data directory" >&2
  exit 65
else
  initdb -D {data} -U postgres --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8
fi
exec postgres -D {data} -c listen_addresses= -c unix_socket_directories=/tmp -c cluster_name={NAME} -c wal_level=logical -c shared_preload_libraries=pg_stat_statements,pg_net'''
 state['pgdata']=data
 (WORK/'state.json').write_text(json.dumps(state,indent=2))
 cmd(D+['create','--pull','never','--name',NAME,'--label','spe.scope=b9-disposable-sql','--network','none','--user','postgres','--entrypoint','/bin/sh',IMAGE,'-c',shell])
 cmd(D+['start',NAME])
 for _ in range(30):
  p=cmd(D+['exec',NAME,'pg_isready','-h','/tmp','-U','postgres'],check=False)
  if p.returncode==0:break
  status=cmd(D+['inspect','--format','{{.State.Status}}',NAME]).stdout.decode().strip()
  if status!='running':raise RuntimeError('New container startup failed: '+cmd(D+['logs',NAME],check=False).stderr.decode(errors='replace')[-1500:])
  time.sleep(1)
 else:raise RuntimeError('New container readiness timeout')
 meta=json.loads(cmd(D+['inspect','--format','{"id":{{json .Id}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"bindings":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}',NAME]).stdout)
 assert meta['network']=='none' and not meta['bindings'] and all(not x for x in meta['ports'].values())
 state.update(meta);(WORK/'state.json').write_text(json.dumps(state,indent=2))
 cmd(D+['exec',NAME,'psql','-X','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE '+DB])
 roles=['anon','authenticated','service_role','dashboard_user','pgbouncer','supabase_admin','supabase_auth_admin','supabase_functions_admin','supabase_storage_admin']
 sql('\n'.join('CREATE ROLE '+r+(' SUPERUSER' if r=='supabase_admin' else ' BYPASSRLS' if r=='service_role' else '')+' NOLOGIN;' for r in roles),'bootstrap-roles')
 baseline=(ROOT/'.env.staging.private/b2c3b-rehearsal/platform-baseline.sql').read_text(encoding='utf8')
 assert not re.search(r'CREATE TABLE public\.(profiles|recruitment_)',baseline)
 sql(baseline,'platform-bootstrap')
 files=sorted((ROOT/'supabase/migrations').glob('*.sql'));needed=files[:6]+[ROOT/'supabase/migrations/20261101000000_recruitment_schema.sql',ROOT/'supabase/migrations/20261101010000_recruitment_security.sql']
 for f in needed:sql(f.read_text(encoding='utf8'),'migration-'+f.stem)
 print(json.dumps({'isolated_container':NAME,'id':state['id'],'network':'none','published_ports':0,'prerequisites_applied':len(needed),'C_free_GiB':round(shutil.disk_usage('C:/').free/2**30,2)}))

 # Exercise restart of ONLY this fresh container, proving initdb is not repeated.
 identity=sql("SELECT system_identifier FROM pg_control_system();",'system-id-before').stdout
 cmd(D+['stop',NAME]);cmd(D+['start',NAME])
 for _ in range(30):
  if cmd(D+['exec',NAME,'pg_isready','-h','/tmp','-U','postgres'],check=False).returncode==0:break
  status=cmd(D+['inspect','--format','{{.State.Status}}',NAME]).stdout.decode().strip()
  if status!='running':raise RuntimeError('Own new container restart failed; stop without retry')
  time.sleep(.5)
 else:raise RuntimeError('Own new container restart timeout; stop without retry')
 assert sql("SELECT system_identifier FROM pg_control_system();",'system-id-after').stdout==identity
 print('PASS: initialized-cluster restart retained system identifier; initdb did not repeat.',flush=True)

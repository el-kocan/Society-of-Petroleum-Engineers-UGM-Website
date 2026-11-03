/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript test loader. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../');
let routeBackend;
const jar = new Map();
jar.get = function(key) { const value = Map.prototype.get.call(this,key); return value ? {value} : undefined; };
jar.set = function(key,value) { Map.prototype.set.call(this,key,value); };
const originalLoad = Module._load;
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {};
  if (id === 'next/headers') return {cookies:async()=>jar};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  if (routeBackend && id === path.join(root,'src/modules/recruitment/server/backend')) return routeBackend;
  return originalLoad.call(this,id,parent,main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true} }).outputText,filename);
global.fetch = () => { throw new Error('External network prohibited in offline tests'); };
const security = require('../../src/modules/recruitment/server/security.ts');
const {validatePayload,inspectDocument} = require('../../src/modules/recruitment/server/payload.ts');
const {assertOpen} = require('../../src/modules/recruitment/server/configuration.ts');
const {submit,settings} = require('../../src/modules/recruitment/server/backend.ts');
const secret = 'synthetic-test-only-secret-not-a-real-credential';
const key = '11111111-1111-4111-a111-111111111111';
function catalog() { return {
  period:{id:'22222222-2222-4222-a222-222222222222', label:'Synthetic', config_version:1, approved_at:new Date().toISOString(),is_open:true,opens_at:'2020-01-01T00:00:00Z',closes_at:'2099-01-01T00:00:00Z',batches:['2026']},
  options:['a','b'].map(sub_code=>({main_code:'same-main',main_label:'Same main',sub_code,sub_label:sub_code,assignment_state:'none',instructions:'Synthetic rule',formats:null,max_bytes:null})),
  requirements:['cv','idCard','commitment','followProof','storyProof'].map(slot=>({slot,required:true,formats:['pdf'],max_bytes:3145728}))
}; }
const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
function form(overrides={}) {
  const data={fullName:'Synthetic Applicant',nim:' SYNTHETIC-001 ',birthPlace:'Synthetic',birthDate:'2005-02-01',ugmEmail:' SYNTHETIC@example.invalid ',phoneNumber:'+620000000001',major:'Synthetic',batch:'2026',division1:'same-main',subDivision1:'a',motivation1:'Synthetic motivation',division2:'same-main',subDivision2:'b',motivation2:'Synthetic motivation',...overrides};
  const f=new FormData();for(const [k,v] of Object.entries(data))f.set(k,v);
  for(const slot of ['cv','idCard','commitment','followProof','storyProof']) f.set(slot,new File([pdf],'synthetic.pdf',{type:'application/pdf'}));
  return f;
}
function fakeDB() {
  const state={apps:[],preferences:[],documents:[],objects:new Map(),audit:0,fail:null};
  const db={state,from(table){
    let action='select',data,filters=[],ignore=false;
    const b={select(){return b;},eq(k,v){filters.push([k,v]);return b;},insert(v){action='insert';data=v;return b;},upsert(v){action='upsert';data=v;ignore=true;return b;},single(){return Promise.resolve(exec());},maybeSingle(){return Promise.resolve(exec());},then(resolve,reject){return Promise.resolve(exec()).then(resolve,reject);}};
    function exec(){
      const rows=table==='recruitment_applications'?state.apps:table==='recruitment_preferences'?state.preferences:state.documents;
      if(action==='select')return {data:rows.find(r=>filters.every(([k,v])=>r[k]===v))??null,error:null};
      if(state.fail==='metadata' && table==='recruitment_documents'){state.fail=null;return {error:{code:'unavailable'}};}
      const match=table==='recruitment_applications'?rows.find(r=>r.idempotency_key===data.idempotency_key||(r.period_id===data.period_id&&r.nim===data.nim)):rows.find(r=>r.application_id===data.application_id&&(table==='recruitment_preferences'?r.rank===data.rank:r.slot===data.slot));
      if(match)return ignore?{data:null,error:null}:{data:null,error:{code:'23505'}};
      const row={id:key,status:'uploading',...data};rows.push(row);return {data:row,error:null};
    }
    return b;
  },storage:{from(bucket){assert.equal(bucket,'recruitment-documents');return {
    async upload(name,bytes,options){assert.equal(options.upsert,false);assert(!name.includes('synthetic'));if(state.fail==='upload'){state.fail=null;return {error:{statusCode:'500'}};}if(state.objects.has(name))return {error:{statusCode:'409'}};state.objects.set(name,Buffer.from(bytes));return {error:null};},
    async download(name){const bytes=state.objects.get(name);return {data:bytes?new Blob([bytes]):null,error:bytes?null:{statusCode:404}};}
  };}},async rpc(name,args){assert.equal(name,'recruitment_finalize');assert.equal(args.p_key,state.apps[0].idempotency_key);const app=state.apps[0];if(app.status==='uploading'){app.status='submitted';state.audit++;}if(state.fail==='final-response'){state.fail=null;return {error:{message:'network failure'}};}return {data:app.id,error:null};}};
  return db;
}
test('signed session rejects forgery and expiry',()=>{const token=security.issueSession(secret,1000000000000);assert(security.verifySession(token,secret,1000000000001));assert.throws(()=>security.verifySession(token+'x',secret,1000000000001));assert.throws(()=>security.verifySession(token,secret,1000086400000));assert.throws(()=>security.verifySession(token,secret+'wrong',1000000000001));});
test('origin rejects cross-site and mismatched configured origin',()=>{security.requireOrigin(new Request('https://staging.invalid/api',{headers:{origin:'https://staging.invalid'}}),'https://staging.invalid');assert.throws(()=>security.requireOrigin(new Request('https://staging.invalid/api',{headers:{origin:'https://evil.invalid'}}),'https://staging.invalid'));});
test('limiter rejects excess requests',()=>{security.limit('test',1,1);assert.throws(()=>security.limit('test',1,2));security.limit('test',1,60001);});
test('body rejects oversized declared size before parsing',async()=>{await assert.rejects(()=>security.boundedForm(new Request('https://staging.invalid',{method:'POST',body:'x',headers:{'content-type':'multipart/form-data; boundary=x','content-length':'999999999'}})),e=>e.status===413);});
test('only explicit staging settings enable backend',()=>{assert.throws(()=>settings());process.env.RECRUITMENT_STAGING_ENABLED='true';process.env.RECRUITMENT_SINGLE_INSTANCE='true';process.env.RECRUITMENT_ORIGIN='http://localhost:3000';process.env.RECRUITMENT_SESSION_SECRET=secret;process.env.RECRUITMENT_PERIOD_ID=catalog().period.id;process.env.RECRUITMENT_STAGING_SECRET_KEY='sb_secret_synthetic_only';assert.equal(settings().period,catalog().period.id);process.env.RECRUITMENT_STAGING_SECRET_KEY=['x',Buffer.from(JSON.stringify({ref:'wrong-project',role:'service_role'})).toString('base64url'),'x'].join('.');assert.throws(()=>settings());});
test('server normalizes NIM/email and accepts same main with distinct subs',async()=>{const p=await validatePayload(form(),catalog());assert.equal(p.values.nim,'synthetic-001');assert.equal(p.values.ugmEmail,'synthetic@example.invalid');assert.equal(p.documents.length,5);});
test('identical and wrong-parent preferences fail',async()=>{await assert.rejects(()=>validatePayload(form({subDivision2:'a'}),catalog()));await assert.rejects(()=>validatePayload(form({division2:'unknown'}),catalog()));});
test('server rejects invalid personal fields and future dates',async()=>{for(const fields of [{birthDate:'2025-02-29'},{birthDate:'2999-01-01'},{ugmEmail:'bad'},{fullName:''},{batch:'not-approved'},{motivation1:''}])await assert.rejects(()=>validatePayload(form(fields),catalog()));});
test('unknown and repeated fields rejected',async()=>{const f=form();f.append('nim','other');await assert.rejects(()=>validatePayload(f,catalog()));const g=form();g.set('object_name','attacker/path');await assert.rejects(()=>validatePayload(g,catalog()));});
test('required/optional/none/unconfirmed rules',async()=>{const c=catalog();c.options[0]={...c.options[0],assignment_state:'required',formats:['pdf'],max_bytes:1000};await assert.rejects(()=>validatePayload(form(),c));const f=form();f.set('assignment1',new File([pdf],'a.pdf',{type:'application/pdf'}));await validatePayload(f,c);c.options[0].assignment_state='optional';await validatePayload(form(),c);c.options[0].assignment_state='unconfirmed';await assert.rejects(()=>validatePayload(form(),c));await assert.rejects(()=>validatePayload(f,catalog()));});
test('missing/oversize/spoofed supporting documents denied',async()=>{const f=form();f.delete('cv');await assert.rejects(()=>validatePayload(f,catalog()));f.set('cv',new File(['not-pdf'],'a.pdf',{type:'application/pdf'}));await assert.rejects(()=>validatePayload(f,catalog()));const c=catalog();c.requirements[0].max_bytes=1;await assert.rejects(()=>validatePayload(form(),c));});
test('file content checks reject interactive PDF and invalid PNG',()=>{assert.equal(inspectDocument(pdf,'a.pdf','application/pdf'),'pdf');assert.throws(()=>inspectDocument(Buffer.from('%PDF-1.7\n/Java#53cript\n%%EOF'),'a.pdf','application/pdf'));assert.throws(()=>inspectDocument(Buffer.from([137,80,78,71,13,10,26,10]),'a.png','image/png'));});
test('deadline and unapproved configuration fail closed',()=>{const c=catalog();c.period.is_open=false;assert.throws(()=>assertOpen(c));c.period.is_open=true;c.period.approved_at=null;assert.throws(()=>assertOpen(c));});
test('submission uploads privately and finalizes once; exact retry returns same receipt',async()=>{const c=catalog(),p=await validatePayload(form(),c),db=fakeDB();const receipt=await submit(db,c,key,p);assert.deepEqual(await submit(db,c,key,p),receipt);assert.equal(db.state.apps.length,1);assert.equal(db.state.documents.length,5);assert.equal(db.state.preferences.length,2);assert.equal(db.state.audit,1);assert.equal(db.state.objects.size,5);});
test('different email cannot bypass normalized NIM duplicate',async()=>{const c=catalog(),db=fakeDB();await submit(db,c,key,await validatePayload(form(),c));await assert.rejects(async()=>submit(db,c,'33333333-3333-4333-a333-333333333333',await validatePayload(form({ugmEmail:'changed@example.invalid'}),c)),e=>e.status===409);assert.equal(db.state.apps.length,1);});
test('payload conflict cannot edit existing submission',async()=>{const c=catalog(),db=fakeDB();await submit(db,c,key,await validatePayload(form(),c));await assert.rejects(async()=>submit(db,c,key,await validatePayload(form({fullName:'Changed'}),c)),e=>e.status===409);});
test('upload failure leaves no false success and same-payload retry resumes',async()=>{const c=catalog(),p=await validatePayload(form(),c),db=fakeDB();db.state.fail='upload';await assert.rejects(()=>submit(db,c,key,p));assert.equal(db.state.audit,0);await submit(db,c,key,p);assert.equal(db.state.audit,1);});
test('metadata failure reuses exact stored bytes without overwrite',async()=>{const c=catalog(),p=await validatePayload(form(),c),db=fakeDB();db.state.fail='metadata';await assert.rejects(()=>submit(db,c,key,p));assert.equal(db.state.objects.size,1);await submit(db,c,key,p);assert.equal(db.state.objects.size,5);});
test('mismatched orphan object cannot be reused',async()=>{const c=catalog(),p=await validatePayload(form(),c),db=fakeDB();db.state.fail='metadata';await assert.rejects(()=>submit(db,c,key,p));const name=[...db.state.objects.keys()][0];db.state.objects.set(name,Buffer.from('tampered'));await assert.rejects(()=>submit(db,c,key,p),e=>e.status===409);assert.equal(db.state.audit,0);});
test('lost finalization response returns receipt on retry without another audit',async()=>{const c=catalog(),p=await validatePayload(form(),c),db=fakeDB();db.state.fail='final-response';await assert.rejects(()=>submit(db,c,key,p));await submit(db,c,key,p);assert.equal(db.state.audit,1);});
test('completed retry works after closure, new attempt is denied',async()=>{const c=catalog(),p=await validatePayload(form(),c),db=fakeDB();await submit(db,c,key,p);c.period.is_open=false;await submit(db,c,key,p);await assert.rejects(()=>submit(fakeDB(),c,key,p),e=>e.status===409);});

test('same-session concurrent request is rejected and lock released on error',async()=>{
 let release; const first=security.singleSubmission('lock-test',()=>new Promise(resolve=>{release=resolve;}));
 await assert.rejects(()=>security.singleSubmission('lock-test',async()=>{}),e=>e.status===429);release();await first;
 await assert.rejects(()=>security.singleSubmission('lock-test',async()=>{throw new Error('failure');}));
 await security.singleSubmission('lock-test',async()=>{});
});
test('actual GET/POST handlers enforce session and origin before writes, return receipt and safe errors',async()=>{
 const db=fakeDB(), c=catalog();
 routeBackend={settings:()=>({origin:'https://staging.invalid',secret,key:'synthetic',period:c.period.id}),client:()=>db,loadCatalog:async()=>c,submit};
 const route=require('../../app/api/recruitment/route.ts');
 const get=await route.GET(new Request('https://staging.invalid/api/recruitment'));assert.equal(get.status,200);assert.equal(get.headers.get('cache-control'),'no-store');
 const config=await get.json();assert.equal(config.period.contentState,'approved');assert(config.token);
 const request=(origin,token)=>new Request('https://staging.invalid/api/recruitment',{method:'POST',headers:{origin,'x-recruitment-session':token},body:form()});
 assert.equal((await route.POST(request('https://evil.invalid',config.token))).status,403);
 assert.equal((await route.POST(request('https://staging.invalid','forged'))).status,403);assert.equal(db.state.apps.length,0);
 const result=await route.POST(request('https://staging.invalid',config.token));assert.equal(result.status,200);assert.equal((await result.json()).applicationId,key);
 const retry=await route.POST(request('https://staging.invalid',config.token));assert.equal(retry.status,200);assert.equal(db.state.audit,1);
 c.period.is_open=false;const closed=await route.GET(new Request('https://staging.invalid/api/recruitment'));assert.equal(closed.status,409);
});

test('valid PNG content accepted with checksum and image data; corrupted bytes denied',()=>{
 const {deflateSync}=require('node:zlib');
 function chunk(type,body) { const data=Buffer.concat([Buffer.from(type),body]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);data.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out; }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
 assert.equal(inspectDocument(png,'image.png','image/png'),'png');png[30]^=1;assert.throws(()=>inspectDocument(png,'image.png','image/png'));
});

test('Tier 1 GUIDEBOOK_v3 assignment policy enforcement', async () => {
  const gCatalog = {
    period: { id: '22222222-2222-4222-a222-222222222222', label: '2026/2027', config_version: 1, approved_at: new Date().toISOString(), is_open: true, opens_at: '2020-01-01T00:00:00Z', closes_at: '2099-01-01T00:00:00Z', batches: ['2026'] },
    options: [
      { main_code: 'internal-affairs', sub_code: 'human-capital', main_label: 'Internal Affairs', sub_label: 'Human Capital', assignment_state: 'required', instructions: 'Guidebook link', formats: ['pdf'], max_bytes: 3145728 },
      { main_code: 'internal-affairs', sub_code: 'internal-engagement', main_label: 'Internal Affairs', sub_label: 'Internal Engagement', assignment_state: 'required', instructions: 'Guidebook link', formats: ['pdf'], max_bytes: 3145728 },
      { main_code: 'external-affairs', sub_code: 'relations-partnership', main_label: 'External Affairs', sub_label: 'Relations & Partnership', assignment_state: 'none', instructions: 'No assignment', formats: null, max_bytes: null },
      { main_code: 'external-affairs', sub_code: 'external-engagement', main_label: 'External Affairs', sub_label: 'External Engagement', assignment_state: 'required', instructions: 'Guidebook link', formats: ['pdf'], max_bytes: 3145728 },
      { main_code: 'media-creative', sub_code: 'website-development', main_label: 'Media Creative', sub_label: 'Website Development', assignment_state: 'required', instructions: 'Guidebook link', formats: ['pdf'], max_bytes: 3145728 },
    ],
    requirements: ['cv', 'idCard', 'commitment', 'followProof', 'storyProof'].map(slot => ({ slot, required: true, formats: ['pdf'], max_bytes: 3145728 }))
  };

  // 1. Rank 1 Human Capital with valid assignment1 -> Accepted
  const f1 = form({ division1: 'internal-affairs', subDivision1: 'human-capital', division2: 'external-affairs', subDivision2: 'relations-partnership' });
  f1.set('assignment1', new File([pdf], 'hc.pdf', { type: 'application/pdf' }));
  const p1 = await validatePayload(f1, gCatalog);
  assert.equal(p1.documents.some(d => d.slot === 'assignment1'), true);

  // 2. Rank 1 Human Capital without assignment1 -> Rejected
  const f2 = form({ division1: 'internal-affairs', subDivision1: 'human-capital', division2: 'external-affairs', subDivision2: 'relations-partnership' });
  await assert.rejects(() => validatePayload(f2, gCatalog));

  // 3. Rank 1 Relations & Partnership without assignment -> Accepted
  const f3 = form({ division1: 'external-affairs', subDivision1: 'relations-partnership', division2: 'internal-affairs', subDivision2: 'human-capital' });
  const p3 = await validatePayload(f3, gCatalog);
  assert.equal(p3.documents.some(d => d.slot === 'assignment1'), false);

  // 4. Rank 1 Relations & Partnership with assignment1 -> Rejected
  const f4 = form({ division1: 'external-affairs', subDivision1: 'relations-partnership', division2: 'internal-affairs', subDivision2: 'human-capital' });
  f4.set('assignment1', new File([pdf], 'rel.pdf', { type: 'application/pdf' }));
  await assert.rejects(() => validatePayload(f4, gCatalog));

  // 5. Rank 2 Human Capital without assignment2 -> Accepted (even when Human Capital has assignment_state='required')
  const f5 = form({ division1: 'external-affairs', subDivision1: 'relations-partnership', division2: 'internal-affairs', subDivision2: 'human-capital' });
  const p5 = await validatePayload(f5, gCatalog);
  assert.equal(p5.documents.some(d => d.slot === 'assignment2'), false);

  // 6. Rank 2 Relations & Partnership without assignment2 -> Accepted
  const f6 = form({ division1: 'media-creative', subDivision1: 'website-development', division2: 'external-affairs', subDivision2: 'relations-partnership' });
  f6.set('assignment1', new File([pdf], 'web.pdf', { type: 'application/pdf' }));
  const p6 = await validatePayload(f6, gCatalog);
  assert.equal(p6.documents.some(d => d.slot === 'assignment2'), false);

  // 7. Any rank 2 with assignment2 -> Rejected
  const f7a = form({ division1: 'external-affairs', subDivision1: 'relations-partnership', division2: 'internal-affairs', subDivision2: 'human-capital' });
  f7a.set('assignment2', new File([pdf], 'hc2.pdf', { type: 'application/pdf' }));
  await assert.rejects(() => validatePayload(f7a, gCatalog));

  const f7b = form({ division1: 'media-creative', subDivision1: 'website-development', division2: 'external-affairs', subDivision2: 'relations-partnership' });
  f7b.set('assignment1', new File([pdf], 'web.pdf', { type: 'application/pdf' }));
  f7b.set('assignment2', new File([pdf], 'rel2.pdf', { type: 'application/pdf' }));
  await assert.rejects(() => validatePayload(f7b, gCatalog));

  // 8. Invalid assignment1 format (plain text instead of PDF) -> Rejected
  const f8 = form({ division1: 'internal-affairs', subDivision1: 'human-capital', division2: 'external-affairs', subDivision2: 'relations-partnership' });
  f8.set('assignment1', new File(['not a pdf'], 'hc.txt', { type: 'text/plain' }));
  await assert.rejects(() => validatePayload(f8, gCatalog));

  // 9. Oversized assignment1 PDF (> 3 MiB) -> Rejected
  const f9 = form({ division1: 'internal-affairs', subDivision1: 'human-capital', division2: 'external-affairs', subDivision2: 'relations-partnership' });
  f9.set('assignment1', new File([Buffer.alloc(3145729)], 'oversized.pdf', { type: 'application/pdf' }));
  await assert.rejects(() => validatePayload(f9, gCatalog));

  // 10. Identical sub-division selected twice -> Rejected
  const f10 = form({ division1: 'internal-affairs', subDivision1: 'human-capital', division2: 'internal-affairs', subDivision2: 'human-capital' });
  f10.set('assignment1', new File([pdf], 'hc.pdf', { type: 'application/pdf' }));
  await assert.rejects(() => validatePayload(f10, gCatalog));

  // 11. Different sub-divisions in same main division -> Accepted
  const f11 = form({ division1: 'internal-affairs', subDivision1: 'human-capital', division2: 'internal-affairs', subDivision2: 'internal-engagement' });
  f11.set('assignment1', new File([pdf], 'hc.pdf', { type: 'application/pdf' }));
  const p11 = await validatePayload(f11, gCatalog);
  assert.equal(p11.values.division1, p11.values.division2);
  assert.notEqual(p11.values.subDivision1, p11.values.subDivision2);
});

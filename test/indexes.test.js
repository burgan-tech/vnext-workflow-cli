// Node >=18 test runner; the CLI itself retains its existing Node requirement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fieldsFromSchema, projectionDefinitions, resolveMaster, physicalSchema, loadPlans } = require('../src/lib/indexes/definitions');
const { generateSql, indexes } = require('../src/lib/indexes/sql');
const { generate } = require('../src/commands/indexes');

function workspace() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vnext-indexes-'));
 const write=(file, data)=>{ const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data)); };
 write('vnext.config.json',{domain:'test', paths:{componentsRoot:'components',workflows:'Workflows',schemas:'Schemas'}});
 const master={type:'master',key:'master',version:'1.0.0',domain:'test',flow:'sys-schemas',attributes:{type:'workflow',schema:{type:'object',properties:{amount:{type:'number','x-indexed':true,'x-filterOperators':['gt']}}}}};
 const flow={key:'orders',version:'1.0.0',domain:'test',flow:'sys-flows',attributes:{schema:{key:'master',domain:'test',flow:'sys-schemas',version:'latest'}}};
 write('components/Schemas/master.json',master);write('components/Workflows/orders.json',flow);
 return {root,write,master,flow};
}

test('physical contract and readable names are stable, case-sensitive paths do not collide',()=>{
 const p=projectionDefinitions([{path:'amount',type:'number',operators:[],sortable:false}]);
 assert.equal(p[0].key, require('crypto').createHash('sha256').update('v1:latest:amount:text').digest('hex').slice(0,24));
 assert.deepEqual(p.map(x=>x.storage),['text','numeric']);
 const long=projectionDefinitions(['ABC','abc','veryLongField'.repeat(8)].map(path=>({path,type:'string',operators:['startsWith'],sortable:true})));
 const names=long.flatMap(indexes).map(i=>i.name);
 assert.equal(new Set(names).size,names.length); assert(names.every(n=>Buffer.byteLength(n)<=63));
 assert.equal(physicalSchema('Order-Flow'),'order_flow'); assert.throws(()=>physicalSchema('x;drop schema y'));
});
test('nested scalars supported; ambiguous, array, ref, conditional and invalid metadata rejected',()=>{
 assert.equal(fieldsFromSchema({properties:{nested:{type:'object',properties:{value:{type:'boolean','x-indexed':true}}}}}, 'master')[0].path,'nested.value');
 for(const node of [{type:'array','x-indexed':true},{type:['number','null'],'x-indexed':true},{type:'number','x-indexed':'true'},{type:'number','$ref':'x','x-indexed':true},{type:'number','x-indexed':true,'x-filterOperators':'gt'}])
   assert.throws(()=>fieldsFromSchema({properties:{x:node}}, 'master'));
 assert.throws(()=>fieldsFromSchema({allOf:[{properties:{x:{type:'number','x-indexed':true}}}]}, 'master'));
 assert.throws(()=>fieldsFromSchema({properties:{xs:{type:'array',items:{properties:{x:{type:'number','x-indexed':true}}}}}}, 'master'));
 assert.throws(()=>fieldsFromSchema({properties:{'a.b':{type:'number','x-indexed':true}}}, 'master'));
});
test('version resolution is numeric, pinned/local, and fails closed for missing references',()=>{
 const schemas=['1.2.0','1.10.0','2.0.0'].map(version=>({domain:'test',key:'m',version}));
 const ref={domain:'test',flow:'sys-schemas',key:'m'};
 for(const [version,expected] of [['latest','2.0.0'],['1','1.10.0'],['1.2','1.2.0'],['1.2.0','1.2.0']]) assert.equal(resolveMaster(schemas,{...ref,version},'test').version,expected);
 assert.throws(()=>resolveMaster(schemas,{...ref,version:'3'},'test'));
 assert.throws(()=>resolveMaster(schemas,{...ref,domain:'remote'},'test'));
 assert.throws(()=>resolveMaster(schemas,{...ref,version:'^1'},'test'));
 assert.throws(()=>projectionDefinitions([{path:'x',type:'number',operators:[]},{path:'x',type:'string',operators:[]}]));
});
test('generation is offline, immutable, scoped, and writes manifests matching SQL checksums',async()=>{
 const w=workspace();
 try {
  const {root}=w;
  const first=await generate({output:'output'},root), second=await generate({output:'output'},root);
  assert.notEqual(first.batch,second.batch);
  const manifest=JSON.parse(fs.readFileSync(path.join(first.batch,'manifest.json')));
  assert.equal(manifest.flows.length,1);assert.equal(manifest.flows[0].sources.length,2);
  const sql=fs.readFileSync(path.join(first.batch,'orders.sql'),'utf8');
  assert.equal(manifest.flows[0].sha256,require('crypto').createHash('sha256').update(sql).digest('hex'));
  assert.equal(sql,fs.readFileSync(path.join(second.batch,'orders.sql'),'utf8'));
  assert.doesNotMatch(sql,/current_database\(\)/);
  assert.equal(Object.hasOwn(manifest, 'database'), false);
  // The real CLI runs with network access forbidden. No profile or running API/DB is needed.
  const preload=path.join(root,'no-network.js');fs.writeFileSync(preload,"for (const name of ['net','tls','http','https']) { const m=require(name); for(const k of ['connect','createConnection','request','get']) if(m[k]) m[k]=()=>{throw Error('NETWORK FORBIDDEN')}; }");
  const result=spawnSync(process.execPath,['--require',preload,path.resolve(__dirname,'../bin/workflow.js'),'indexes','generate','--flow','orders','--output','from-command'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/No API or database connection/);
  await assert.rejects(loadPlans(root,'missing'));
 } finally {fs.rmSync(w.root,{recursive:true,force:true});}
});
test('all local workflow versions are merged; duplicate identities and schema collisions fail',async()=>{
 const w=workspace();
 try {
  w.write('components/Schemas/master2.json',{...w.master,version:'2.0.0',attributes:{schema:{properties:{name:{type:'string','x-indexed':true}}}}});
  w.write('components/Workflows/orders.json',{...w.flow,attributes:{schema:{...w.flow.attributes.schema,version:'1.0.0'}}});
  w.write('components/Workflows/orders2.json',{...w.flow,version:'2.0.0'});
  assert.deepEqual((await loadPlans(w.root))[0].projections.map(p=>p.path),['amount','amount','name']);
  w.write('components/Workflows/duplicate.json',w.flow);
  await assert.rejects(loadPlans(w.root),/Duplicate/);
 } finally {fs.rmSync(w.root,{recursive:true,force:true});}
});
test('SQL needs no database option; retirement is explicit',()=>{
 const plan={domain:'test',flow:'orders',schema:'orders',projections:[]};
 assert.doesNotMatch(generateSql(plan),/current_database|Wrong database/);
 assert.doesNotMatch(generateSql(plan),/DO \$retire\$/);
 assert.match(generateSql(plan,{retireObsolete:true}),/DO \$retire\$/);
});

test('package revisions match runtime selectors and ignore build metadata',()=>{
 const ref={domain:'test',flow:'sys-schemas',key:'m'};
 const schemas=['1.0.0-pkg.1.2.0+core','1.0.0-pkg.1.10.0+core','2.0.0-pkg.0.1.0+core'].map(version=>({domain:'test',key:'m',version}));
 for(const [version,expected] of [['1.0.0','1.0.0-pkg.1.10.0+core'],['1.0.0-pkg.1.2.0','1.0.0-pkg.1.2.0+core'],['latest','2.0.0-pkg.0.1.0+core'],['1.2.0','1.0.0-pkg.1.2.0+core']])
   assert.equal(resolveMaster(schemas,{...ref,version},'test').version,expected);
 assert.throws(()=>resolveMaster(schemas,{...ref,version:'1.0.0-pkg.1.3.0'},'test'));
});


test('conditional indexed nodes and ancestors are rejected without rejecting unrelated unindexed fields',()=>{
 for (const keyword of ['allOf','anyOf','oneOf','not','if','then','else','dependentSchemas']) {
  const condition=['allOf','anyOf','oneOf'].includes(keyword)?[{}]:{};
  assert.throws(()=>fieldsFromSchema({properties:{amount:{type:'number','x-indexed':true,[keyword]:condition}}}, 'master'),/amount/);
  assert.throws(()=>fieldsFromSchema({[keyword]:condition,properties:{amount:{type:'number','x-indexed':true}}}, 'master'),/amount/);
 }
 const fields=fieldsFromSchema({properties:{amount:{type:'number','x-indexed':true},other:{type:'string',oneOf:[{maxLength:10}]}}}, 'master');
 assert.deepEqual(fields.map(field=>field.path),['amount']);
});


test('only referenced master schemas produce SQL plans; skip non-master latest versions without falling back',async()=>{
 const w=workspace();
 try {
  for(const type of ['transition','view','function']) {
   w.write('components/Schemas/master.json',{...w.master,type,attributes:{schema:{type:'object',properties:{name:{type:'string'}}}}});
   assert.deepEqual(await loadPlans(w.root),[]);
   await assert.rejects(generate({output:'ignored-output'},w.root),/No workflows referencing type: master/);
   assert.equal(fs.existsSync(path.join(w.root,'ignored-output')),false);
  }
  w.write('components/Schemas/master.json',w.master);
  w.write('components/Schemas/next.json',{...w.master,version:'2.0.0',type:'transition',attributes:{schema:{type:'object'}}});
  assert.deepEqual(await loadPlans(w.root),[]);
  w.write('components/Workflows/orders.json',{...w.flow,attributes:{schema:{...w.flow.attributes.schema,version:'1.0.0'}}});
  assert.equal((await loadPlans(w.root)).length,1);
 } finally {fs.rmSync(w.root,{recursive:true,force:true});}
});

test('non-master x-indexed metadata and invalid schema purposes fail validation',async()=>{
 const w=workspace();
 try {
  for(const type of ['transition','view','function']) {
   for(const indexed of [true,false]) {
    w.write('components/Schemas/master.json',{...w.master,type,attributes:{schema:{properties:{nested:{properties:{value:{type:'number','x-indexed':indexed}}}}}}});
    await assert.rejects(loadPlans(w.root),/x-indexed is only allowed.*master/);
   }
  }
  for(const type of ['workflow','json-schema','MASTER',42,{},[]]) {
   w.write('components/Schemas/master.json',{...w.master,type,attributes:{schema:{type:'object'}}});
   await assert.rejects(loadPlans(w.root),/Schema type must be one of/);
  }
 } finally {fs.rmSync(w.root,{recursive:true,force:true});}
});


test('root type controls indexing while existing attributes.type remains independent',async()=>{
 const w=workspace();
 try {
  for(const attributeType of ['workflow','task','function','view','schema','extension','headers','json-schema']) {
   w.write('components/Schemas/master.json',{...w.master,attributes:{...w.master.attributes,type:attributeType}});
   assert.equal((await loadPlans(w.root)).length,1);
  }
  w.write('components/Schemas/master.json',{...w.master,type:'view',attributes:{type:'master',schema:{type:'object'}}});
  assert.deepEqual(await loadPlans(w.root),[]);
  w.write('components/Schemas/master.json',{...w.master,type:undefined,attributes:{...w.master.attributes,type:'master'}});
  await assert.rejects(loadPlans(w.root),/x-indexed is only allowed/);
 } finally {fs.rmSync(w.root,{recursive:true,force:true});}
});


test('optional root purpose has no default and never opts into indexing',async()=>{
 const w=workspace();
 try {
  for(const type of [undefined,null,'','   ']) {
   w.write('components/Schemas/master.json',{...w.master,type,attributes:{type:'master',schema:{type:'object'}}});
   assert.deepEqual(await loadPlans(w.root),[]);
   w.write('components/Schemas/master.json',{...w.master,type});
   await assert.rejects(loadPlans(w.root),/x-indexed is only allowed/);
  }
 } finally {fs.rmSync(w.root,{recursive:true,force:true});}
});

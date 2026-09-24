const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { projectionDefinitions } = require('../src/lib/indexes/definitions');
const { generateSql, indexes } = require('../src/lib/indexes/sql');
const connectionString = process.env.VNEXT_INDEX_TEST_URL;

test('DBA-generated SQL contract on real PostgreSQL', {skip:!connectionString}, async t=>{
 const client=new Client({connectionString}); await client.connect();
 const schemas=[];
 const fields=[{path:'amount',type:'number',operators:['gt'],sortable:true},{path:'name',type:'string',operators:['contains'],sortable:true},
  {path:'nested.when',type:'string',format:'date-time',operators:['between']}];
 const planFor=async(values=fields)=>{
  const schema='cli_test_'+require('crypto').randomBytes(8).toString('hex'); schemas.push(schema);
  await client.query(`CREATE SCHEMA "${schema}"; CREATE TABLE "${schema}"."InstancesData" ("InstanceId" uuid, "Data" jsonb, "IsLatest" boolean);`);
  return {domain:'test',flow:schema,schema,projections:projectionDefinitions(values)};
 };
 const execute=(plan,extra={})=>client.query(generateSql(plan,extra));
 const failed=async(plan,regex,extra={})=>{await assert.rejects(execute(plan,extra),regex);await client.query('ROLLBACK');};
 const listIndexes=async p=>(await client.query('SELECT c.relname,c.oid::text FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE i.indrelid=$1::regclass ORDER BY c.relname',[`"${p.schema}"."InstancesData"`])).rows;
 const seed=async(p,value,latest=true)=>client.query(`INSERT INTO "${p.schema}"."InstancesData" VALUES ('00000000-0000-0000-0000-000000000001',$1,$2)`,[value,latest]);
 try {
  await t.test('replay preserves index OIDs, history is null, timestamp is timezone independent, updates track IsLatest',async()=>{
   const p=await planFor(); const data={amount:10,name:'İstanbul_😀',nested:{when:'2026-01-02T03:00:00+03:00'}};
   await seed(p,data);await seed(p,data,false);await execute(p);
   const original=await listIndexes(p);await execute(p);assert.deepEqual(await listIndexes(p),original);
   const col=p.projections.find(x=>x.storage==='timestamptz').column;
   const amount=p.projections.find(x=>x.storage==='numeric').column;
   const rows=(await client.query(`SELECT "IsLatest", "${col}" AS time, "${amount}" AS amount FROM "${p.schema}"."InstancesData" ORDER BY "IsLatest" DESC`)).rows;
   assert.equal(rows[0].time.toISOString(),'2026-01-02T00:00:00.000Z');assert.equal(rows[1].time,null);assert.equal(rows[1].amount,null);
   await client.query("SET TIME ZONE 'America/New_York'; SET DateStyle = 'SQL, DMY'");
   await seed(p,{...data,nested:{when:'2026-01-01T19:00:00-05:00'}});
   assert.equal((await client.query(`SELECT count(DISTINCT "${col}")::int n FROM "${p.schema}"."InstancesData"`)).rows[0].n,1);
   await client.query(`UPDATE "${p.schema}"."InstancesData" SET "IsLatest"=false;`);
   assert.equal((await client.query(`SELECT count("${amount}")::int n FROM "${p.schema}"."InstancesData"`)).rows[0].n,0);
   await client.query("RESET TIME ZONE; RESET DateStyle");
  });
  await t.test('equivalent legacy names are adopted without another index',async()=>{
   const p=await planFor(fields.slice(0,1));await execute(p);const ix=indexes(p.projections[0])[0];
   await client.query(`ALTER INDEX "${p.schema}"."${ix.name}" RENAME TO "${ix.legacy}"; COMMENT ON INDEX "${p.schema}"."${ix.legacy}" IS NULL`);
   const before=await listIndexes(p);await execute(p);assert.deepEqual(await listIndexes(p),before);
   const catalog=(await client.query(`SELECT "Indexes" FROM "${p.schema}"."AttributeIndexCatalog" WHERE "Key"=$1`,[p.projections[0].key])).rows[0];
   assert(catalog.Indexes.includes(ix.legacy));
  });
  await t.test('changed managed index is rebuilt and unrelated index remains untouched',async()=>{
   const p=await planFor(fields.slice(0,1));await execute(p);const pr=p.projections[0],ix=indexes(pr)[0];
   const before=await listIndexes(p);
   await client.query(`DROP INDEX "${p.schema}"."${ix.name}"; CREATE INDEX "${ix.name}" ON "${p.schema}"."InstancesData" ("${pr.column}") WHERE "IsLatest"=false; COMMENT ON INDEX "${p.schema}"."${ix.name}" IS 'vnext-attribute-index:cli:v1:${pr.key}:${ix.kind}'; CREATE INDEX manual_index ON "${p.schema}"."InstancesData" ("IsLatest");`);
   const manual=(await listIndexes(p)).find(x=>x.relname==='manual_index');
   await execute(p);const after=await listIndexes(p);
   assert.notEqual(after.find(x=>x.relname===ix.name).oid,before.find(x=>x.relname===ix.name).oid);
   assert.deepEqual(after.find(x=>x.relname==='manual_index'),manual);
   const stable=after.filter(x=>x.relname!==ix.name&&x.relname!=='manual_index'); assert.deepEqual(stable,before.filter(x=>x.relname!==ix.name));
  });
  await t.test('metadata update adds/removes managed trigram and descending indexes without rewriting columns',async()=>{
   const p=await planFor([{path:'name',type:'string',operators:[],sortable:false}]);await execute(p);const before=await listIndexes(p);
   const next={...p,projections:projectionDefinitions([fields[1]])};await execute(next);assert.equal((await listIndexes(p)).length,3);
   await execute(p);assert.deepEqual(await listIndexes(p),before);
  });
  await t.test('invalid historical numeric value rolls back every addition; corrected replay succeeds',async()=>{
   const p=await planFor(fields.slice(0,1));await seed(p,{amount:'invalid'},false);
   await failed(p,/Cannot index field amount/);
   assert.equal((await client.query('SELECT to_regclass($1) AS value',[`"${p.schema}"."AttributeIndexCatalog"`])).rows[0].value,null);
   await client.query(`UPDATE "${p.schema}"."InstancesData" SET "Data"='{"amount":12}'`);await execute(p);
  });
  await t.test('invalid timestamp (missing offset) refuses activation and reports field',async()=>{
   const p=await planFor(fields.slice(2));await seed(p,{nested:{when:'2026-01-01T00:00:00'}});
   await failed(p,/Cannot index field nested.when/);
  });
  await t.test('unmanaged index name collision fails without dropping it',async()=>{
   const p=await planFor(fields.slice(0,1));const ix=indexes(p.projections[0])[0];
   await client.query(`CREATE INDEX "${ix.name}" ON "${p.schema}"."InstancesData" ("IsLatest")`);
   const before=await listIndexes(p);await failed(p,/Unmanaged index name collision/);assert.deepEqual(await listIndexes(p),before);
  });
  await t.test('unrecognized generated column collision rolls back without altering it',async()=>{
   const p=await planFor(fields.slice(0,1));const column=p.projections[0].column;
   await client.query(`ALTER TABLE "${p.schema}"."InstancesData" ADD COLUMN "${column}" text;`);
   await failed(p,/Unrecognized projection collision/);assert.deepEqual(await listIndexes(p),[]);
  });
  await t.test('projection retirement is opt-in; retains values, removes owned indexes and permits type change',async()=>{
   const p=await planFor(fields.slice(0,1));await seed(p,{amount:10});await execute(p);
   const next={...p,projections:projectionDefinitions([{path:'amount',type:'string',operators:[]}])};await execute(next);
   assert.equal((await client.query(`SELECT count(*)::int n FROM "${p.schema}"."AttributeIndexCatalog" WHERE "Ready"`)).rows[0].n,2);
   await execute(next,{retireObsolete:true});assert.equal((await listIndexes(p)).length,1);
   await execute(p); // A previously retired numeric projection can be prepared again.
   await execute(next,{retireObsolete:true});
   await seed(p,{amount:'text-now'});
   assert.equal((await client.query(`SELECT count(*)::int n FROM "${p.schema}"."AttributeIndexCatalog" WHERE "Ready"`)).rows[0].n,1);
  });
  await t.test('session concurrency rejects competing maintenance and releases after rollback',async()=>{
   const p=await planFor(fields.slice(0,1));const lock=new Client({connectionString});await lock.connect();
   try {await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['attribute-indexes:'+p.schema]);await failed(p,/Another attribute-index maintenance/);}
   finally {await lock.query('ROLLBACK');await lock.end();}
   await execute(p);
  });
 } finally {await client.query('ROLLBACK'); for(const schema of schemas) await client.query(`DROP SCHEMA "${schema}" CASCADE`);await client.end();}
});

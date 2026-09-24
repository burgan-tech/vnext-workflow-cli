const fs = require('fs');
const path = require('path');
const { LOG } = require('../lib/ui');
const { loadPlans, hash } = require('../lib/indexes/definitions');
const { generateSql, indexes } = require('../lib/indexes/sql');

async function generate(options, projectRoot = process.cwd()) {
  const plans = await loadPlans(projectRoot, options.flow);
  if (!plans.length) throw new Error("No workflows referencing attributes.type: master schemas found; no SQL files generated.");
  // Validate/render the whole batch before creating any output; never overwrite an earlier batch.
  const rendered = plans.map(plan => ({ plan, sql: generateSql(plan, options) }));
  const output = path.resolve(projectRoot, options.output || 'index-sql');
  fs.mkdirSync(output, { recursive: true });
  const batch = fs.mkdtempSync(path.join(output, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const manifest = { formatVersion: 1, physicalContract: 'v1:latest', generatorVersion: require('../../package.json').version,
    domain: plans[0].domain, retireObsolete: !!options.retireObsolete,
    generatedAt: new Date().toISOString(), flows: [] };
  for (const { plan, sql } of rendered) {
    const file = plan.schema + '.sql';
    fs.writeFileSync(path.join(batch, file), sql, { flag: 'wx' });
    manifest.flows.push({ ...plan, projections: plan.projections.map(p => ({ ...p, indexes: indexes(p) })), file, sha256: hash(sql) });
  }
  fs.writeFileSync(path.join(batch, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(batch, 'README.txt'), [
    `Domain: ${manifest.domain}. Generated offline; nothing was executed.`,
    'DBA: review manifest/source versions and each SQL file. Execute files individually in a maintenance window.',
    'Example: psql -X -v ON_ERROR_STOP=1 --dbname=<target-database> --file=<flow.sql>',
    'Scripts lock InstancesData ACCESS EXCLUSIVE and use one transaction per flow. Plan disk/WAL/replica capacity for table rewrites.',
    'A 5s lock_timeout is included; adjust it during DBA review if necessary. Re-run the SAME script after rollback on failure.',
    'Existing correct indexes are adopted; changed CLI-owned indexes are rebuilt. Unmanaged name collisions fail.',
    'No obsolete projection is retired unless --retire-obsolete was explicitly passed. Retirement requires all active versions locally and drained runtime readers/writers.',
    'Stored values/columns are retained on retirement; physical cleanup remains a separate DBA operation.',
    'Runtime reads use AttributeIndexes:Enabled and refresh the catalog after CatalogCacheSeconds (default 30).',
    'Rollback routing with AttributeIndexes:DisabledFlows. Do not drop columns under running readers.', ''
  ].join('\n'), { flag: 'wx' });
  return { batch, count: rendered.length };
}
async function command(options) {
  try {
    const { batch, count } = await generate(options);
    LOG.success(`Generated ${count} SQL file(s): ${batch}`);
    LOG.info('No API or database connection was made. Give this batch to your DBA for review and execution.');
  } catch (error) { LOG.error(error.message); process.exitCode = 1; }
}
module.exports = command;
module.exports.generate = generate;

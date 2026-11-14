// Node >=18 test runner; the CLI itself retains its existing Node requirement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { orderForPublish, discoverComponents, findAllJsonFiles } = require('../src/lib/discover');
const { detectComponentType, sortForPublish } = require('../src/lib/workflow');
const { getAgentSchema, loadAgentValidator, checkAgentFile } = require('../src/lib/agentSchema');

const AGENT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['key', 'version', 'domain', 'flow', 'attributes'],
  properties: {
    flow: { const: 'sys-agents' },
    attributes: { type: 'object', required: ['provider'], properties: { provider: { type: 'string' } } }
  }
};

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root, file, data) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

function agent(overrides = {}) {
  return { key: 'triage', version: '1.0.0', domain: 'agentlab', flow: 'sys-agents', attributes: { provider: 'local' }, ...overrides };
}

// A project with a fake @burgan-tech/vnext-schema; `index` is the package's index.js source.
function projectWithSchemaPackage(index, version = '9.9.9') {
  const root = tempDir('vnext-agents-pkg-');
  write(root, 'node_modules/@burgan-tech/vnext-schema/package.json', { name: '@burgan-tech/vnext-schema', version, main: 'index.js' });
  write(root, 'node_modules/@burgan-tech/vnext-schema/index.js', index);
  return root;
}

function workspace(paths) {
  const root = tempDir('vnext-agents-ws-');
  write(root, 'vnext.config.json', { domain: 'agentlab', paths: { componentsRoot: 'core', ...paths } });
  write(root, 'core/Tasks/lab/task.json', { key: 'task', version: '1.0.0', domain: 'agentlab', flow: 'sys-tasks' });
  write(root, 'core/Workflows/lab/flow.json', { key: 'flow', version: '1.0.0', domain: 'agentlab', flow: 'sys-flows' });
  write(root, 'core/Agents/lab/triage.json', agent());
  return root;
}

function solutionFor(root, paths) {
  const { componentsRoot, ...componentTypes } = { componentsRoot: 'core', ...paths };
  return { domain: 'agentlab', projectRoot: root, componentsRoot: path.join(root, componentsRoot), componentTypes };
}

test('orderForPublish moves agents right before workflows and leaves everything else alone', () => {
  assert.deepEqual(Object.keys(orderForPublish({ tasks: 't', workflows: 'w', views: 'v', agents: 'a' })), ['tasks', 'agents', 'workflows', 'views']);
  assert.deepEqual(Object.keys(orderForPublish({ tasks: 't', agents: 'a', workflows: 'w' })), ['tasks', 'agents', 'workflows']);
  assert.deepEqual(Object.keys(orderForPublish({ workflows: 'w', tasks: 't', views: 'v' })), ['workflows', 'tasks', 'views']);
  assert.deepEqual(Object.keys(orderForPublish({ tasks: 't', agents: 'a' })), ['tasks', 'agents']);
});

test('sync scans Agents/ before Workflows/ when paths.agents is declared after workflows', async () => {
  const paths = { tasks: 'Tasks', workflows: 'Workflows', agents: 'Agents' };
  const root = workspace(paths);
  const discovered = await discoverComponents(solutionFor(root, paths));
  assert.deepEqual(Object.keys(discovered), ['tasks', 'agents', 'workflows']);

  const files = await findAllJsonFiles(discovered);
  assert.deepEqual(files.map(f => f.type), ['tasks', 'agents', 'workflows']);
});

test('a solution without paths.agents discovers exactly what it did before', async () => {
  const paths = { workflows: 'Workflows', tasks: 'Tasks' };
  const root = workspace(paths);
  const discovered = await discoverComponents(solutionFor(root, paths));
  assert.deepEqual(Object.keys(discovered), ['workflows', 'tasks']);

  const files = await findAllJsonFiles(discovered);
  assert.deepEqual(files.map(f => f.fileName), ['flow.json', 'task.json']);
});

test('detectComponentType maps the agents folder to sys-agents', () => {
  const solution = solutionFor('/p', { workflows: 'Workflows', agents: 'Agents' });
  assert.equal(detectComponentType('/p/core/Agents/lab/triage.json', solution), 'sys-agents');
  assert.equal(detectComponentType('/p/core/Workflows/lab/flow.json', solution), 'sys-flows');
  // Path fallback when the folder is not declared
  assert.equal(detectComponentType('/p/core/Agents/x.json', solutionFor('/p', {})), 'sys-agents');
});

test('sortForPublish moves late agent files before the first workflow file only', () => {
  const list = [
    { fileName: 'flow-a', type: 'sys-flows' },
    { fileName: 'task', type: 'sys-tasks' },
    { fileName: 'agent', type: 'sys-agents' },
    { fileName: 'flow-b', type: 'sys-flows' }
  ];
  assert.deepEqual(sortForPublish(list).map(f => f.fileName), ['agent', 'flow-a', 'task', 'flow-b']);

  const early = [{ fileName: 'agent', type: 'sys-agents' }, { fileName: 'flow', type: 'sys-flows' }];
  assert.equal(sortForPublish(early), early);

  const noAgents = [{ fileName: 'flow', type: 'sys-flows' }, { fileName: 'task', type: 'sys-tasks' }];
  assert.equal(sortForPublish(noAgents), noAgents);
});

test('getAgentSchema follows the vnext-schema package conventions', () => {
  // Released versions: no agent type
  const released = { getSchema: (t) => (t === 'workflow' ? {} : null), getAvailableTypes: () => ['workflow'] };
  assert.equal(getAgentSchema(released), null);

  const viaGetSchema = { getSchema: (t) => (t === 'agent' ? AGENT_SCHEMA : null), getAvailableTypes: () => ['workflow', 'agent'] };
  assert.equal(getAgentSchema(viaGetSchema), AGENT_SCHEMA);

  assert.equal(getAgentSchema({ agentDefinition: AGENT_SCHEMA }), AGENT_SCHEMA);
  assert.equal(getAgentSchema({ schemas: { agentDefinition: AGENT_SCHEMA } }), AGENT_SCHEMA);
  assert.equal(getAgentSchema(null), null);
});

test('agent schema validation is skipped with a reason when the package is missing or too old', () => {
  const none = loadAgentValidator(tempDir('vnext-agents-empty-'), []);
  assert.equal(none.status, 'unavailable');
  assert.match(none.reason, /is not installed in the project/);

  const old = projectWithSchemaPackage(
    "module.exports = { getSchema: () => null, getAvailableTypes: () => ['workflow'] };",
    '0.0.57'
  );
  const tooOld = loadAgentValidator(old, []);
  assert.equal(tooOld.status, 'unavailable');
  assert.match(tooOld.reason, /0\.0\.57 does not export the agent-definition schema/);
});

test('agent files are validated against the schema when the package exports it', () => {
  const root = projectWithSchemaPackage(
    `const s = ${JSON.stringify(AGENT_SCHEMA)};
     module.exports = { getSchema: (t) => (t === 'agent' ? s : null), getAvailableTypes: () => ['agent'] };`
  );
  const validator = loadAgentValidator(root, []);
  assert.equal(validator.status, 'ready');
  assert.equal(validator.version, '9.9.9');

  const solution = { domain: 'agentlab' };
  write(root, 'ok.json', agent());
  assert.deepEqual(checkAgentFile(path.join(root, 'ok.json'), solution, validator).problems, []);

  write(root, 'bad.json', agent({ attributes: {} }));
  const bad = checkAgentFile(path.join(root, 'bad.json'), solution, validator).problems;
  assert.equal(bad.length, 1);
  assert.equal(bad[0].path, '/attributes');
  assert.match(bad[0].message, /provider/);
});

test('header checks run even without a schema', () => {
  const root = tempDir('vnext-agents-header-');
  const solution = { domain: 'agentlab' };
  const skipped = { status: 'unavailable', reason: 'n/a' };

  write(root, 'wrong.json', agent({ flow: 'sys-flows', domain: 'other', version: undefined }));
  const problems = checkAgentFile(path.join(root, 'wrong.json'), solution, skipped).problems.map(p => p.path);
  assert.deepEqual(problems, ['/version', '/flow', '/domain']);

  write(root, 'broken.json', '{ not json');
  assert.match(checkAgentFile(path.join(root, 'broken.json'), solution, skipped).problems[0].message, /invalid JSON/);
});

test('wf check lists agent files and explains a skipped schema validation', () => {
  const paths = { tasks: 'Tasks', workflows: 'Workflows', agents: 'Agents' };
  const root = workspace(paths);
  write(root, 'vnext.config.json', { domain: 'agentlab-cli-test', paths: { componentsRoot: 'core', ...paths } });
  write(root, 'core/Agents/lab/triage.json', agent({ domain: 'agentlab-cli-test' }));

  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'workflow.js'), 'check'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' }
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Agents:/);
  assert.match(run.stdout, /Agent schema validation skipped: @burgan-tech\/vnext-schema is not installed/);
  assert.match(run.stdout, /✓ lab\/triage\.json/);
});

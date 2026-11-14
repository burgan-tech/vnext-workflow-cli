// Node >=18 test runner; the CLI itself retains its existing Node requirement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  normalizeInstructionsText,
  syncAgentInstructions,
  findAgentFiles,
  findAgentsReferencing,
  runInstructionSync
} = require('../src/lib/agentInstructions');
const { checkAgentFile } = require('../src/lib/agentSchema');

const CLI = path.join(__dirname, '..', 'bin', 'workflow.js');
const SILENT_LOG = { component() {}, warning() {} };
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

function write(root, file, data) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  return target;
}

function agent(key, instructions) {
  return { key, version: '1.0.0', domain: 'mdlab', flow: 'sys-agents', attributes: { provider: 'local', instructions } };
}

// Workspace: core/Agents/lab/*.json with instruction files next to them, plus markdown no agent references.
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-md-'));
  write(root, 'vnext.config.json', { domain: 'mdlab', paths: { componentsRoot: 'core', workflows: 'Workflows', agents: 'Agents' } });
  write(root, 'README.md', '# repo readme\n');
  write(root, 'core/README.md', '# components readme\n');
  write(root, 'core/Agents/docs/notes.md', 'not instructions\n');
  write(root, 'core/Agents/lab/instructions/refund.md', 'You handle refunds.\n');
  const solution = {
    domain: 'mdlab',
    projectRoot: root,
    componentsRoot: path.join(root, 'core'),
    componentTypes: { workflows: 'Workflows', agents: 'Agents' }
  };
  return { root, solution, agentsDir: path.join(root, 'core/Agents/lab') };
}

function spyOnReads(fn) {
  const reads = [];
  const sync = fs.readFileSync;
  const promised = fs.promises.readFile;
  fs.readFileSync = (file, ...rest) => { reads.push(path.resolve(String(file))); return sync(file, ...rest); };
  fs.promises.readFile = (file, ...rest) => { reads.push(path.resolve(String(file))); return promised(file, ...rest); };
  return Promise.resolve()
    .then(fn)
    .finally(() => { fs.readFileSync = sync; fs.promises.readFile = promised; })
    .then(result => ({ result, reads }));
}

function runCli(args, cwd) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-md-home-'));
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData'), FORCE_COLOR: '0' }
  });
}

test('line endings follow Forge: CRLF and trailing newlines are not a change', () => {
  assert.equal(normalizeInstructionsText('a\r\nb\r\n\r\n'), 'a\nb');
  assert.equal(normalizeInstructionsText('a\nb'), 'a\nb');
  assert.notEqual(normalizeInstructionsText('a \nb'), normalizeInstructionsText('a\nb'));
});

test('a referenced .md is encoded into code (B64 default, encoding written)', () => {
  const { solution, agentsDir } = workspace();
  const json = write(agentsDir, 'refund.json', agent('refund', { location: './instructions/refund.md' }));

  assert.deepEqual(syncAgentInstructions(json, solution), { status: 'updated', location: './instructions/refund.md' });
  const saved = JSON.parse(fs.readFileSync(json, 'utf8')).attributes.instructions;
  assert.equal(saved.code, b64('You handle refunds.\n'));
  assert.equal(saved.encoding, 'B64');
  assert.equal(saved.location, './instructions/refund.md');
});

test('NAT stores the plain text', () => {
  const { solution, agentsDir } = workspace();
  const json = write(agentsDir, 'nat.json', agent('nat', { location: './instructions/refund.md', code: 'old', encoding: 'NAT' }));

  assert.equal(syncAgentInstructions(json, solution).status, 'updated');
  const saved = JSON.parse(fs.readFileSync(json, 'utf8')).attributes.instructions;
  assert.equal(saved.code, 'You handle refunds.\n');
  assert.equal(saved.encoding, 'NAT');
});

test('an unchanged file is not rewritten, including CRLF / trailing newline differences', () => {
  const { solution, agentsDir } = workspace();
  const same = write(agentsDir, 'same.json', agent('same', { location: './instructions/refund.md', code: b64('You handle refunds.'), encoding: 'B64' }));
  write(agentsDir, 'instructions/crlf.md', 'Line one.\r\nLine two.\r\n');
  const crlf = write(agentsDir, 'crlf.json', agent('crlf', { location: './instructions/crlf.md', code: 'Line one.\nLine two.', encoding: 'NAT' }));
  const before = [fs.readFileSync(same, 'utf8'), fs.readFileSync(crlf, 'utf8')];
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(same, past, past);
  fs.utimesSync(crlf, past, past);

  assert.equal(syncAgentInstructions(same, solution).status, 'unchanged');
  assert.equal(syncAgentInstructions(crlf, solution).status, 'unchanged');
  assert.deepEqual([fs.readFileSync(same, 'utf8'), fs.readFileSync(crlf, 'utf8')], before);
  assert.ok(Math.abs(fs.statSync(same).mtimeMs - past.getTime()) < 1, 'same.json was rewritten');
  assert.ok(Math.abs(fs.statSync(crlf).mtimeMs - past.getTime()) < 1, 'crlf.json was rewritten');
});

test('a rewrite keeps the JSON formatting (indent, trailing newline)', () => {
  const { solution, agentsDir } = workspace();
  const json = path.join(agentsDir, 'tabs.json');
  fs.writeFileSync(json, JSON.stringify(agent('tabs', { location: './instructions/refund.md' }), null, 4));

  syncAgentInstructions(json, solution);
  const text = fs.readFileSync(json, 'utf8');
  assert.match(text, /^\{\n {4}"key": "tabs"/);
  assert.ok(!text.endsWith('\n'));
});

test('a missing file is an error that blocks the agent', () => {
  const { solution, agentsDir } = workspace();
  const json = write(agentsDir, 'gone.json', agent('gone', { location: './instructions/gone.md' }));
  const before = fs.readFileSync(json, 'utf8');

  const results = runInstructionSync([json], solution, SILENT_LOG);
  assert.equal(results.failed, 1);
  assert.ok(results.blocked.has(path.resolve(json)));
  assert.equal(results.errors[0].type, 'MD');
  assert.match(results.errors[0].error, /instructions file ".\/instructions\/gone.md" not found/);
  assert.equal(fs.readFileSync(json, 'utf8'), before);
});

test('a location outside the components root is rejected with a warning', () => {
  const { root, solution, agentsDir } = workspace();
  const escape = write(agentsDir, 'escape.json', agent('escape', { location: '../../../README.md' }));
  const absolute = write(agentsDir, 'absolute.json', agent('absolute', { location: path.join(root, 'README.md') }));
  const before = [fs.readFileSync(escape, 'utf8'), fs.readFileSync(absolute, 'utf8')];

  assert.equal(syncAgentInstructions(escape, solution).status, 'outside');
  assert.equal(syncAgentInstructions(absolute, solution).status, 'outside');
  const results = runInstructionSync([escape, absolute], solution, SILENT_LOG);
  assert.equal(results.warnings, 2);
  assert.equal(results.failed, 0);
  assert.deepEqual([fs.readFileSync(escape, 'utf8'), fs.readFileSync(absolute, 'utf8')], before);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '# repo readme\n');
});

test('inline text, REF and non-.md locations are left alone', () => {
  const { solution, agentsDir } = workspace();
  const files = [
    write(agentsDir, 'text.json', agent('text', { text: 'Inline.' })),
    write(agentsDir, 'ref.json', agent('ref', { location: './instructions/refund.md', encoding: 'REF', code: { key: 'x' } })),
    write(agentsDir, 'txt.json', agent('txt', { location: './instructions/refund.txt' }))
  ];
  const before = files.map(f => fs.readFileSync(f, 'utf8'));

  for (const file of files) assert.equal(syncAgentInstructions(file, solution).status, 'none');
  assert.equal(runInstructionSync(files, solution, SILENT_LOG).processed, 0);
  assert.deepEqual(files.map(f => fs.readFileSync(f, 'utf8')), before);
});

test('only referenced .md files are read; README and docs are never opened', async () => {
  const { root, solution, agentsDir } = workspace();
  write(agentsDir, 'refund.json', agent('refund', { location: './instructions/refund.md' }));
  write(agentsDir, 'text.json', agent('text', { text: 'Inline.' }));

  const { reads } = await spyOnReads(async () => {
    const agents = await findAgentFiles(solution);
    runInstructionSync(agents, solution, SILENT_LOG);
    await findAgentsReferencing(solution, [path.join(root, 'core/Agents/docs/notes.md')]);
  });

  const mdReads = reads.filter(file => file.endsWith('.md'));
  assert.deepEqual(mdReads, [path.join(agentsDir, 'instructions/refund.md')]);
});

test('wf csx --all and --file re-inline instructions and report MD', () => {
  const { root, agentsDir } = workspace();
  const json = write(agentsDir, 'refund.json', agent('refund', { location: './instructions/refund.md' }));

  const all = runCli(['csx', '--all'], root);
  assert.equal(all.status, 0, all.stdout + all.stderr);
  assert.match(all.stdout, /\[MD\] ✓ refund\.json ← \.\/instructions\/refund\.md/);
  assert.match(all.stdout, /MD Files\s+: 1 success/);
  assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).attributes.instructions.code, b64('You handle refunds.\n'));

  write(agentsDir, 'instructions/refund.md', 'You handle refunds politely.\n');
  const one = runCli(['csx', '--file', 'core/Agents/lab/instructions/refund.md'], root);
  assert.equal(one.status, 0, one.stdout + one.stderr);
  assert.match(one.stdout, /MD Files\s+: 1 success/);
  assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).attributes.instructions.code, b64('You handle refunds politely.\n'));

  const unreferenced = runCli(['csx', '--file', 'core/README.md'], root);
  assert.match(unreferenced.stdout, /No agent references this file/);
  assert.equal(fs.readFileSync(path.join(root, 'core/README.md'), 'utf8'), '# components readme\n');
});

test('wf csx (git-changed) picks up a changed referenced .md and ignores other changed markdown', () => {
  const { root, agentsDir } = workspace();
  const json = write(agentsDir, 'refund.json', agent('refund', { location: './instructions/refund.md', code: b64('You handle refunds.\n'), encoding: 'B64' }));
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');

  write(agentsDir, 'instructions/refund.md', 'Changed instructions.\n');
  write(root, 'core/README.md', '# edited readme\n');
  const run = runCli(['csx'], root);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /MD Files\s+: 1 success/);
  assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).attributes.instructions.code, b64('Changed instructions.\n'));
  assert.equal(fs.readFileSync(path.join(root, 'core/README.md'), 'utf8'), '# edited readme\n');
});

test('wf check flags a missing instructions file', () => {
  const { solution, agentsDir } = workspace();
  const ok = write(agentsDir, 'refund.json', agent('refund', { location: './instructions/refund.md' }));
  const gone = write(agentsDir, 'gone.json', agent('gone', { location: './instructions/gone.md' }));
  const outside = write(agentsDir, 'escape.json', agent('escape', { location: '../../../README.md' }));
  const skipped = { status: 'unavailable' };

  assert.deepEqual(checkAgentFile(ok, solution, skipped).problems, []);
  assert.deepEqual(checkAgentFile(gone, solution, skipped).problems, [
    { path: '/attributes/instructions/location', message: 'instructions file "./instructions/gone.md" not found' }
  ]);
  assert.match(checkAgentFile(outside, solution, skipped).problems[0].message, /outside the components root/);
});

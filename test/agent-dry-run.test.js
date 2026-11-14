// Node >=18 test runner; the CLI itself retains its existing Node requirement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { buildAgentDryRunRequest, dryRunAgent } = require('../src/lib/api');
const { buildDryRunInput } = require('../src/commands/agent');
const { printAgentDryRunResult } = require('../src/lib/ui');

const CLI = path.join(__dirname, '..', 'bin', 'workflow.js');

const OUTPUT = {
  status: 'Completed',
  output: { category: 'fraud', summary: 'classified by the local provider' },
  decision: 'to-fraud',
  reason: 'mentions a stolen card',
  failureReason: null,
  toolCalls: [
    { name: 'bump', kind: 2, status: 'Succeeded', durationMs: 3, error: null },
    { name: 'lab_script', kind: 1, status: 'Failed', durationMs: 5, bindingRef: 'core/sys-tasks/sched-script-task@1.0.0', error: 'stubbed' }
  ],
  promptTokens: 42,
  completionTokens: 7,
  durationMs: 120
};

const FORBIDDEN = {
  type: 'https://httpstatuses.com/403/forbidden/Agent/100004',
  title: 'Forbidden',
  status: 403,
  detail: 'Agent dry-run is not allowed for this caller.',
  errorCode: 'forbidden.Agent:100004',
  traceId: '00-trace-01'
};

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(dir, name, data) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

// Stub runtime: answers 200 with OUTPUT when the role header is "tester", else 403 Problem Details.
async function stubRuntime() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      if (req.headers.role === 'tester') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(OUTPUT));
      } else {
        res.writeHead(403, { 'Content-Type': 'application/problem+json' });
        res.end(JSON.stringify(FORBIDDEN));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function captureConsole(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function runCli(args, { cwd, home }) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData'), FORCE_COLOR: '0' }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('buildAgentDryRunRequest builds the runtime route, body and role header', () => {
  const request = buildAgentDryRunRequest({
    baseUrl: 'http://localhost:4201/',
    apiVersion: 'v1',
    domain: 'core',
    key: 'ai triage',
    agentVersion: '1.0.0',
    prompt: '<message>{{ data.message }}</message>',
    data: { message: 'hi' },
    candidates: [{ key: 'to-fraud', when: 'fraud', whenSource: 'description' }],
    role: 'tester'
  });
  assert.equal(request.url, 'http://localhost:4201/api/v1/core/definitions/agents/ai%20triage/dry-run?version=1.0.0');
  assert.deepEqual(request.body, {
    prompt: '<message>{{ data.message }}</message>',
    data: { message: 'hi' },
    candidates: [{ key: 'to-fraud', when: 'fraud', whenSource: 'description' }]
  });
  assert.equal(request.headers.role, 'tester');

  const minimal = buildAgentDryRunRequest({ baseUrl: 'http://h', apiVersion: 'v1', domain: 'core', key: 'a', candidates: [] });
  assert.equal(minimal.url, 'http://h/api/v1/core/definitions/agents/a/dry-run');
  assert.deepEqual(minimal.body, { prompt: '', data: {} });
  assert.equal(minimal.headers.role, undefined);
});

test('buildDryRunInput reads the option files and rejects bad input', () => {
  const dir = tempDir('vnext-dryrun-input-');
  const profile = { API_BASE_URL: 'http://h', API_VERSION: 'v1' };
  const data = writeJson(dir, 'data.json', { message: 'hi' });
  const candidates = writeJson(dir, 'candidates.json', [{ key: 'a', when: 'b', whenSource: 'description' }]);
  const promptFile = path.join(dir, 'prompt.txt');
  fs.writeFileSync(promptFile, 'from file {{ data.message }}');

  const input = buildDryRunInput('triage', { data, candidates, promptFile, agentVersion: '2.0.0', role: 'r' }, profile, 'core');
  assert.equal(input.prompt, 'from file {{ data.message }}');
  assert.deepEqual(input.data, { message: 'hi' });
  assert.equal(input.candidates.length, 1);
  assert.equal(input.agentVersion, '2.0.0');
  assert.equal(input.domain, 'core');
  assert.equal(input.baseUrl, 'http://h');

  assert.throws(() => buildDryRunInput('t', { data: writeJson(dir, 'arr.json', [1]) }, profile, 'core'), /JSON object/);
  assert.throws(() => buildDryRunInput('t', { data: writeJson(dir, 'bad.json', '{ nope') }, profile, 'core'), /not valid JSON/);
  assert.throws(() => buildDryRunInput('t', { data: path.join(dir, 'missing.json') }, profile, 'core'), /cannot read/);
  assert.throws(() => buildDryRunInput('t', { data, candidates: data }, profile, 'core'), /JSON array/);
  assert.throws(() => buildDryRunInput('t', { data, prompt: 'x', promptFile }, profile, 'core'), /either --prompt or --prompt-file/);
});

test('dryRunAgent posts the request and unwraps the runtime error body', async () => {
  const { server, requests, baseUrl } = await stubRuntime();
  try {
    const ok = await dryRunAgent(buildAgentDryRunRequest({ baseUrl, apiVersion: 'v1', domain: 'core', key: 'triage', prompt: 'p', data: { a: 1 }, role: 'tester' }));
    assert.equal(ok.success, true);
    assert.deepEqual(ok.data, OUTPUT);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/v1/core/definitions/agents/triage/dry-run');
    assert.deepEqual(requests[0].body, { prompt: 'p', data: { a: 1 } });

    const denied = await dryRunAgent(buildAgentDryRunRequest({ baseUrl, apiVersion: 'v1', domain: 'core', key: 'triage' }));
    assert.equal(denied.success, false);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.apiError.errorCode, 'forbidden.Agent:100004');
    assert.equal(denied.error, 'Agent dry-run is not allowed for this caller.');
  } finally {
    server.close();
  }
});

test('printAgentDryRunResult renders status, decision, output, tool calls and usage', () => {
  const text = captureConsole(() => printAgentDryRunResult(OUTPUT));
  assert.match(text, /Status\s+Completed/);
  assert.match(text, /Decision\s+to-fraud/);
  assert.match(text, /Reason\s+mentions a stolen card/);
  assert.match(text, /"category": "fraud"/);
  assert.match(text, /Tool calls \(2\):/);
  assert.match(text, /✓ 1\. bump \(kind 2, Succeeded, 3 ms\)/);
  assert.match(text, /✗ 2\. lab_script/);
  assert.match(text, /→ core\/sys-tasks\/sched-script-task@1\.0\.0/);
  assert.match(text, /stubbed/);
  assert.match(text, /Tokens: 42 prompt, 7 completion · 120 ms/);

  const failed = captureConsole(() => printAgentDryRunResult({ status: 'Failed', failureReason: 'provider timeout', toolCalls: [] }));
  assert.match(failed, /Failure\s+provider timeout/);
  assert.match(failed, /Output:\n\s+\(none\)/);
});

test('wf agent dry-run prints the result, and surfaces a 403 with its error code', async () => {
  const { server, requests, baseUrl } = await stubRuntime();
  const home = tempDir('vnext-dryrun-home-');
  const cwd = tempDir('vnext-dryrun-cwd-');
  writeJson(cwd, 'sample.json', { message: 'my card was stolen' });

  try {
    const add = await runCli(['domain', 'add', 'stublab', '--API_BASE_URL', baseUrl], { cwd, home });
    assert.equal(add.status, 0, add.stdout + add.stderr);

    const ok = await runCli(['agent', 'dry-run', 'triage', '--data', 'sample.json', '--prompt', '{{ data.message }}', '--role', 'tester', '--agent-version', '1.0.0', '--domain', 'stublab'], { cwd, home });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Status\s+Completed/);
    assert.match(ok.stdout, /Decision\s+to-fraud/);
    const sent = requests[requests.length - 1];
    assert.equal(sent.url, '/api/v1/stublab/definitions/agents/triage/dry-run?version=1.0.0');
    assert.deepEqual(sent.body, { prompt: '{{ data.message }}', data: { message: 'my card was stolen' } });

    const json = await runCli(['agent', 'dry-run', 'triage', '--data', 'sample.json', '--role', 'tester', '--json', '--domain', 'stublab'], { cwd, home });
    assert.deepEqual(JSON.parse(json.stdout.slice(json.stdout.indexOf('{\n'))), OUTPUT);

    const denied = await runCli(['agent', 'dry-run', 'triage', '--data', 'sample.json', '--domain', 'stublab'], { cwd, home });
    assert.equal(denied.status, 1);
    assert.match(denied.stdout, /HTTP 403 Forbidden/);
    assert.match(denied.stdout, /Code: forbidden\.Agent:100004/);
    assert.match(denied.stdout, /AiAgent:DryRun:Roles/);

    const noProfile = await runCli(['agent', 'dry-run', 'triage', '--data', 'sample.json', '--domain', 'nowhere'], { cwd, home });
    assert.equal(noProfile.status, 1);
    assert.match(noProfile.stdout, /No CLI domain profile for "nowhere"/);
  } finally {
    server.close();
  }
});

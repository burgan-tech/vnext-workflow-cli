const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { discoverComponents, findJsonInComponent, toGlobPattern, JSON_IGNORE_PATTERNS, AGENT_TYPE } = require('./discover');
const { getGitChangedFiles } = require('./csx');

/**
 * File-backed agent instructions (`sys-agents` `attributes.instructions`):
 *
 *   "instructions": { "location": "./instructions/refund.md", "code": "<base64>", "encoding": "B64" }
 *
 * The runtime reads only `code` (or `text`), so the CLI re-inlines the file
 * into `code` before publishing, the way it does for `.csx` scripts.
 *
 * Discovery always starts from agent JSON files: only a `.md` that an agent
 * references is ever read. The workspace is never globbed for `*.md`, so
 * README, CHANGELOG and docs are never touched.
 */

const AGENT_FLOW = 'sys-agents';
const INSTRUCTIONS_PATTERN = /\.md$/i;

/**
 * Text comparison shared with vnext-forge (agentInstructionsFile.sameInstructionsText):
 * CRLF vs LF and trailing newlines do not count as a change, so the two tools
 * never rewrite each other's output.
 * @param {string} text
 * @returns {string}
 */
function normalizeInstructionsText(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The file-backed instructions of a parsed agent document, or null when it
 * has none (inline `text`, no `location`, a non-.md location, or REF).
 * @param {Object} data - Parsed agent JSON
 * @returns {{ location: string, encoding: 'B64'|'NAT', node: Object }|null}
 */
function getInstructionsRef(data) {
  const attributes = isRecord(data) && isRecord(data.attributes) ? data.attributes : null;
  const node = attributes && isRecord(attributes.instructions) ? attributes.instructions : null;
  if (!node || typeof node.location !== 'string') return null;

  const location = node.location.trim();
  if (!INSTRUCTIONS_PATTERN.test(location)) return null;

  const encoding = typeof node.encoding === 'string' ? node.encoding.toUpperCase() : 'B64';
  if (encoding === 'REF') return null;

  return { location, encoding: encoding === 'NAT' ? 'NAT' : 'B64', node };
}

/**
 * Resolves an instructions `location` against the agent JSON's folder (the
 * same base `.csx` locations use: `./src/X.csx` sits next to the component
 * JSON). Only files inside the solution's componentsRoot are accepted.
 * @param {string} jsonPath - Agent JSON file
 * @param {string} location - `instructions.location`
 * @param {Object} solution - Solution object
 * @returns {{ path: string }|{ error: string }}
 */
function resolveInstructionsPath(jsonPath, location, solution) {
  if (path.isAbsolute(location) || /^[a-zA-Z]:[\\/]/.test(location)) {
    return { error: `instructions location "${location}" is absolute; use a path relative to the agent file` };
  }

  const resolved = path.resolve(path.dirname(jsonPath), location);
  const root = path.resolve(solution.componentsRoot);
  if (!resolved.startsWith(root + path.sep)) {
    return { error: `instructions location "${location}" points outside the components root` };
  }

  return { path: resolved };
}

/**
 * Checks the instructions file of one agent without changing anything.
 * Used by `wf check` and by the sync below.
 * @param {string} jsonPath - Agent JSON file
 * @param {Object} data - Parsed agent JSON
 * @param {Object} solution - Solution object
 * @returns {{ status: 'none' }|{ status: 'ok', ref: Object, mdPath: string }
 *   |{ status: 'outside'|'missing', ref: Object, message: string }}
 */
function inspectInstructions(jsonPath, data, solution) {
  const ref = getInstructionsRef(data);
  if (!ref) return { status: 'none' };

  const resolved = resolveInstructionsPath(jsonPath, ref.location, solution);
  if (resolved.error) return { status: 'outside', ref, message: resolved.error };

  if (!fs.existsSync(resolved.path) || !fs.statSync(resolved.path).isFile()) {
    return { status: 'missing', ref, message: `instructions file "${ref.location}" not found` };
  }

  return { status: 'ok', ref, mdPath: resolved.path };
}

/**
 * Decodes the `code` currently inlined in the agent JSON.
 * @returns {string|null} null when there is no usable code yet
 */
function decodeCode(code, encoding) {
  if (typeof code !== 'string') return null;
  if (encoding === 'NAT') return code;
  try {
    return Buffer.from(code, 'base64').toString('utf8');
  } catch (error) {
    return null;
  }
}

/**
 * Detects the indentation of a JSON document so a rewrite keeps it.
 * @param {string} content - Original JSON text
 * @returns {string|number} Indent for JSON.stringify (default 2 spaces)
 */
function detectIndent(content) {
  const match = /\n([ \t]+)"/.exec(content);
  return match ? match[1] : 2;
}

/**
 * Re-inlines one agent's instructions file into `instructions.code`.
 * The JSON is written only when the text actually changed (ignoring CRLF and
 * trailing newlines, see normalizeInstructionsText); the raw file content is
 * stored, plain for NAT, base64 otherwise (with `encoding: "B64"`).
 * @param {string} jsonPath - Agent JSON file
 * @param {Object} solution - Solution object
 * @returns {{ status: 'none'|'updated'|'unchanged'|'outside'|'missing'|'invalid', location?: string, message?: string }}
 */
function syncAgentInstructions(jsonPath, solution) {
  let content;
  let data;
  try {
    content = fs.readFileSync(jsonPath, 'utf8');
    data = JSON.parse(content);
  } catch (error) {
    return { status: 'invalid', message: `cannot read agent JSON: ${error.message}` };
  }

  const inspected = inspectInstructions(jsonPath, data, solution);
  if (inspected.status === 'none') return { status: 'none' };
  if (inspected.status !== 'ok') {
    return { status: inspected.status, location: inspected.ref.location, message: inspected.message };
  }

  const { ref, mdPath } = inspected;
  const text = fs.readFileSync(mdPath, 'utf8');
  const current = decodeCode(ref.node.code, ref.encoding);

  if (current !== null && normalizeInstructionsText(current) === normalizeInstructionsText(text)) {
    return { status: 'unchanged', location: ref.location };
  }

  if (ref.encoding === 'NAT') {
    ref.node.code = text;
  } else {
    ref.node.code = Buffer.from(text, 'utf8').toString('base64');
    ref.node.encoding = 'B64';
  }

  const trailingNewline = /\n$/.test(content) ? '\n' : '';
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, detectIndent(content)) + trailingNewline, 'utf8');
  return { status: 'updated', location: ref.location };
}

/**
 * Reads a JSON file and tells whether it is an agent component.
 * @param {string} jsonPath
 * @returns {Object|null} Parsed data when it is an agent, else null
 */
function readAgent(jsonPath) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return data && data.flow === AGENT_FLOW ? data : null;
  } catch (error) {
    return null;
  }
}

/**
 * All agent JSON files of a solution (its `paths.agents` folder).
 * @param {Object} solution - Solution object
 * @returns {Promise<string[]>}
 */
async function findAgentFiles(solution) {
  const discovered = await discoverComponents(solution);
  if (!discovered[AGENT_TYPE]) return [];
  return findJsonInComponent(discovered[AGENT_TYPE]);
}

/**
 * Keeps the agent components of a list of JSON files.
 * @param {string[]} jsonPaths
 * @returns {string[]}
 */
function filterAgentFiles(jsonPaths) {
  return jsonPaths.filter(file => readAgent(file) !== null);
}

/**
 * Agent JSON files under some folders (update --folder).
 * @param {string[]} dirs
 * @returns {Promise<string[]>}
 */
async function findAgentFilesInDirs(dirs) {
  const files = [];
  for (const dir of dirs) {
    files.push(...await glob(toGlobPattern(dir, '**/*.json'), { ignore: JSON_IGNORE_PATTERNS }));
  }
  return filterAgentFiles(files);
}

/**
 * Agents of the solution whose instructions file resolves to one of `mdPaths`.
 * Only the paths are compared; no .md file is read here.
 * @param {Object} solution - Solution object
 * @param {string[]} mdPaths - Absolute .md paths
 * @returns {Promise<string[]>} Agent JSON files
 */
async function findAgentsReferencing(solution, mdPaths) {
  const wanted = new Set(mdPaths.map(p => path.resolve(p)));
  if (wanted.size === 0) return [];

  const agents = [];
  for (const jsonPath of await findAgentFiles(solution)) {
    const data = readAgent(jsonPath);
    const ref = data && getInstructionsRef(data);
    if (!ref) continue;
    const resolved = resolveInstructionsPath(jsonPath, ref.location, solution);
    if (resolved.path && wanted.has(resolved.path)) agents.push(jsonPath);
  }
  return agents;
}

/**
 * Agents to re-inline in git-changed mode: agents whose referenced .md is
 * git-changed. A changed .md no agent references is ignored (never read).
 * @param {Object} solution - Solution object
 * @returns {Promise<string[]>} Agent JSON files
 */
async function findAgentsForChangedInstructions(solution) {
  const changed = await getGitChangedFiles(solution, '.md');
  return findAgentsReferencing(solution, changed);
}

/**
 * Runs syncAgentInstructions over agent files, printing one line per agent
 * that has file-backed instructions.
 * @param {string[]} agentFiles - Agent JSON files
 * @param {Object} solution - Solution object
 * @param {Object} LOG - ui.LOG
 * @returns {{ success: number, unchanged: number, failed: number, warnings: number,
 *   errors: Object[], blocked: Set<string>, processed: number }}
 *   `blocked` holds agent JSON paths that must not be published (missing file).
 */
function runInstructionSync(agentFiles, solution, LOG) {
  const results = { success: 0, unchanged: 0, failed: 0, warnings: 0, errors: [], blocked: new Set(), processed: 0 };

  for (const jsonPath of [...new Set(agentFiles.map(f => path.resolve(f)))]) {
    const fileName = path.basename(jsonPath);
    const result = syncAgentInstructions(jsonPath, solution);
    if (result.status === 'none') continue;
    results.processed++;

    if (result.status === 'updated') {
      LOG.component('MD', fileName, 'success', `← ${result.location}`);
      results.success++;
    } else if (result.status === 'unchanged') {
      LOG.component('MD', fileName, 'skip', `${result.location} unchanged`);
      results.unchanged++;
    } else if (result.status === 'outside') {
      LOG.warning(`[MD] ${fileName}: ${result.message} — skipped`);
      results.warnings++;
    } else {
      LOG.component('MD', fileName, 'error', result.message);
      results.failed++;
      results.blocked.add(jsonPath);
      results.errors.push({ type: 'MD', file: fileName, error: result.message, errorCode: 'INSTRUCTIONS_MISSING' });
    }
  }

  return results;
}

/**
 * The `MD` line of a command summary, or null when nothing was processed.
 * @param {Object} results - Result of runInstructionSync
 * @param {Object} chalk
 * @returns {string|null}
 */
function formatInstructionSummary(results, chalk) {
  if (!results || results.processed === 0) return null;
  const parts = [
    results.success > 0 ? chalk.green(`${results.success} success`) : chalk.dim('0 success'),
    results.unchanged > 0 ? chalk.dim(`${results.unchanged} unchanged`) : null,
    results.failed > 0 ? chalk.red(`${results.failed} failed`) : null,
    results.warnings > 0 ? chalk.yellow(`${results.warnings} skipped`) : null
  ].filter(Boolean);
  return parts.join(', ');
}

module.exports = {
  AGENT_FLOW,
  normalizeInstructionsText,
  getInstructionsRef,
  resolveInstructionsPath,
  inspectInstructions,
  syncAgentInstructions,
  findAgentFiles,
  filterAgentFiles,
  findAgentFilesInDirs,
  findAgentsReferencing,
  findAgentsForChangedInstructions,
  runInstructionSync,
  formatInstructionSummary
};

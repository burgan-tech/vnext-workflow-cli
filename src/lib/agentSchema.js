const fs = require('fs');
const path = require('path');

/**
 * Validation of agent component files (`sys-agents`) for `wf check`.
 *
 * The agent-definition schema ships with `@burgan-tech/vnext-schema`, which
 * the CLI does not bundle: it is read from the user's project (where the
 * vNext template installs it), falling back to a copy next to the CLI. Older
 * package versions do not export it; validation is then skipped with a
 * notice rather than failing, and the header checks still run.
 */

const { inspectInstructions } = require('./agentInstructions');

const SCHEMA_PACKAGE = '@burgan-tech/vnext-schema';
const AGENT_SCHEMA_TYPE = 'agent';
const AGENT_FLOW = 'sys-agents';

/**
 * Loads `@burgan-tech/vnext-schema` from the project, then from the CLI's own install.
 * @param {string} projectRoot - Project root folder
 * @param {string[]} [extraPaths] - Additional lookup roots (tests)
 * @returns {{ pkg: Object, version: string|null, dir: string }|null} null when not installed
 */
function loadSchemaPackage(projectRoot, extraPaths = [path.join(__dirname, '..', '..')]) {
  let entry;
  try {
    entry = require.resolve(SCHEMA_PACKAGE, { paths: [projectRoot, ...extraPaths] });
  } catch (error) {
    return null;
  }

  const pkg = require(entry);
  const dir = findPackageDir(entry);
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null;
  } catch (error) {
    // version stays unknown
  }

  return { pkg, version, dir };
}

/**
 * Walks up from a resolved entry file to the folder holding its package.json.
 * @param {string} entry - Resolved entry file
 * @returns {string} Package folder
 */
function findPackageDir(entry) {
  let dir = path.dirname(entry);
  while (!fs.existsSync(path.join(dir, 'package.json')) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  return dir;
}

/**
 * Returns the agent-definition schema exported by a vnext-schema package,
 * following the package's own conventions (`getSchema(type)` listed in
 * `getAvailableTypes()`, or the `agentDefinition` export).
 * @param {Object} pkg - Loaded vnext-schema package
 * @returns {Object|null} The schema, or null when this version has none
 */
function getAgentSchema(pkg) {
  if (!pkg) return null;

  if (typeof pkg.getSchema === 'function') {
    const listed = typeof pkg.getAvailableTypes !== 'function' || pkg.getAvailableTypes().includes(AGENT_SCHEMA_TYPE);
    const schema = listed ? pkg.getSchema(AGENT_SCHEMA_TYPE) : null;
    if (schema) return schema;
  }

  return pkg.agentDefinition || (pkg.schemas && pkg.schemas.agentDefinition) || null;
}

/**
 * Picks the AJV build matching the schema's draft.
 * @param {Object} schema - JSON schema
 * @returns {Function} AJV class
 */
function ajvClassFor(schema) {
  const draft = (schema && schema.$schema) || '';
  if (draft.includes('2020-12')) return require('ajv/dist/2020');
  if (draft.includes('2019-09')) return require('ajv/dist/2019');
  return require('ajv');
}

/**
 * Builds the agent validator for a project.
 * @param {string} projectRoot - Project root folder
 * @param {string[]} [extraPaths] - Additional lookup roots for the schema package (tests)
 * @returns {{ status: 'ready', version: string|null, validate: Function }
 *   | { status: 'unavailable', reason: string }}
 *   `validate(data)` returns a list of `{ path, message }` (empty when valid).
 */
function loadAgentValidator(projectRoot, extraPaths) {
  const loaded = loadSchemaPackage(projectRoot, extraPaths);
  if (!loaded) {
    return {
      status: 'unavailable',
      reason: `${SCHEMA_PACKAGE} is not installed in the project (run npm install)`
    };
  }

  const schema = getAgentSchema(loaded.pkg);
  const label = `${SCHEMA_PACKAGE}${loaded.version ? ` ${loaded.version}` : ''}`;
  if (!schema) {
    return {
      status: 'unavailable',
      reason: `${label} does not export the agent-definition schema yet (upgrade it to a version that does)`
    };
  }

  let compiled;
  try {
    const Ajv = ajvClassFor(schema);
    const ajv = new Ajv({ strict: false, allErrors: true });
    require('ajv-formats')(ajv);
    if (typeof loaded.pkg.addVocabularies === 'function') {
      loaded.pkg.addVocabularies(ajv);
    }
    compiled = ajv.compile(schema);
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `the agent-definition schema of ${label} could not be compiled: ${error.message}`
    };
  }

  return {
    status: 'ready',
    version: loaded.version,
    validate(data) {
      if (compiled(data)) return [];
      return (compiled.errors || []).map(error => ({
        path: error.instancePath || '/',
        message: error.message
      }));
    }
  };
}

/**
 * Checks one agent file: JSON syntax, the component header, a file-backed
 * instructions `location` (must exist inside the components root), and —
 * when a validator is ready — the agent-definition schema.
 * @param {string} filePath - Agent JSON file
 * @param {Object} solution - Solution object
 * @param {Object} validator - Result of loadAgentValidator
 * @returns {{ file: string, problems: Array<{path: string, message: string}> }}
 */
function checkAgentFile(filePath, solution, validator) {
  const problems = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { file: filePath, problems: [{ path: '/', message: `invalid JSON: ${error.message}` }] };
  }

  if (!data.key) problems.push({ path: '/key', message: 'is required' });
  if (!data.version) problems.push({ path: '/version', message: 'is required' });
  if (data.flow !== AGENT_FLOW) {
    problems.push({ path: '/flow', message: `must be "${AGENT_FLOW}" (found ${JSON.stringify(data.flow)})` });
  }
  if (data.domain !== solution.domain) {
    problems.push({ path: '/domain', message: `must be the solution domain "${solution.domain}" (found ${JSON.stringify(data.domain)})` });
  }

  // File-backed instructions: the referenced .md must exist inside the components root
  const instructions = inspectInstructions(filePath, data, solution);
  if (instructions.status === 'missing' || instructions.status === 'outside') {
    problems.push({ path: '/attributes/instructions/location', message: instructions.message });
  }

  if (validator && validator.status === 'ready') {
    problems.push(...validator.validate(data));
  }

  return { file: filePath, problems };
}

module.exports = {
  SCHEMA_PACKAGE,
  AGENT_FLOW,
  loadSchemaPackage,
  getAgentSchema,
  loadAgentValidator,
  checkAgentFile
};

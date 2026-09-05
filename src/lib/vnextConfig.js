const fs = require('fs');
const path = require('path');

/**
 * Default solution file name. A workspace may additionally contain
 * `vnext.{domain}.config.json` files (see SOLUTION_FILE_PATTERN); each one is
 * an independent solution with its own domain and componentsRoot.
 */
const DEFAULT_SOLUTION_FILE = 'vnext.config.json';

/**
 * Matches `vnext.{domain}.config.json`. The captured group is the domain name
 * as written in the file name (single segment, no dots). Note that the
 * default file name does not match this pattern and is handled explicitly.
 */
const SOLUTION_FILE_PATTERN = /^vnext\.([^.]+)\.config\.json$/;

/**
 * Reads and parses a solution file. Stateless: no caching — callers keep the
 * parsed object (see lib/solutions.js) instead of re-reading.
 * @param {string} projectRoot - Project root folder
 * @param {string} [fileName] - Solution file name (default: vnext.config.json)
 * @returns {Object} Parsed solution file content
 */
function loadVnextConfig(projectRoot, fileName = DEFAULT_SOLUTION_FILE) {
  const configPath = path.join(projectRoot, fileName);

  if (!fs.existsSync(configPath)) {
    throw new Error(`${fileName} not found: ${configPath}`);
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read ${fileName}: ${error.message}`);
  }
}

/**
 * Returns the domain declared in a parsed solution file.
 * @param {Object} config - Parsed solution file
 * @param {string} [fileName] - Used in error messages
 * @returns {string} Domain name
 */
function getDomainFromConfig(config, fileName = DEFAULT_SOLUTION_FILE) {
  if (!config.domain) {
    throw new Error(`domain not found in ${fileName}`);
  }
  return config.domain;
}

/**
 * Returns the paths object of a parsed solution file.
 * @param {Object} config - Parsed solution file
 * @param {string} [fileName] - Used in error messages
 * @returns {Object} Paths object
 */
function getPathsFromConfig(config, fileName = DEFAULT_SOLUTION_FILE) {
  if (!config.paths) {
    throw new Error(`paths not found in ${fileName}`);
  }
  return config.paths;
}

/**
 * Returns the absolute components root of a parsed solution file.
 * @param {string} projectRoot - Project root folder
 * @param {Object} config - Parsed solution file
 * @param {string} [fileName] - Used in error messages
 * @returns {string} Components root folder path
 */
function getComponentsRootFromConfig(projectRoot, config, fileName = DEFAULT_SOLUTION_FILE) {
  const paths = getPathsFromConfig(config, fileName);

  if (!paths.componentsRoot) {
    throw new Error(`paths.componentsRoot not found in ${fileName}`);
  }

  return path.join(projectRoot, paths.componentsRoot);
}

/**
 * Returns component types and folder names of a parsed solution file.
 * Every key under `paths` except `componentsRoot` is a component type.
 * @param {Object} config - Parsed solution file
 * @param {string} [fileName] - Used in error messages
 * @returns {Object} Component type -> folder name mapping
 */
function getComponentTypesFromConfig(config, fileName = DEFAULT_SOLUTION_FILE) {
  const paths = getPathsFromConfig(config, fileName);

  const componentTypes = {};
  for (const [key, value] of Object.entries(paths)) {
    if (key !== 'componentsRoot') {
      componentTypes[key] = value;
    }
  }

  return componentTypes;
}

// --- Thin wrappers that read the file on every call (kept for compatibility) ---

function getDomain(projectRoot, fileName = DEFAULT_SOLUTION_FILE) {
  return getDomainFromConfig(loadVnextConfig(projectRoot, fileName), fileName);
}

function getPaths(projectRoot, fileName = DEFAULT_SOLUTION_FILE) {
  return getPathsFromConfig(loadVnextConfig(projectRoot, fileName), fileName);
}

function getComponentsRoot(projectRoot, fileName = DEFAULT_SOLUTION_FILE) {
  return getComponentsRootFromConfig(projectRoot, loadVnextConfig(projectRoot, fileName), fileName);
}

function getComponentTypes(projectRoot, fileName = DEFAULT_SOLUTION_FILE) {
  return getComponentTypesFromConfig(loadVnextConfig(projectRoot, fileName), fileName);
}

function getFullConfig(projectRoot, fileName = DEFAULT_SOLUTION_FILE) {
  return loadVnextConfig(projectRoot, fileName);
}

module.exports = {
  DEFAULT_SOLUTION_FILE,
  SOLUTION_FILE_PATTERN,
  loadVnextConfig,
  getDomainFromConfig,
  getPathsFromConfig,
  getComponentsRootFromConfig,
  getComponentTypesFromConfig,
  getDomain,
  getPaths,
  getComponentsRoot,
  getComponentTypes,
  getFullConfig
};

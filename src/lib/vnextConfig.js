const fs = require('fs');
const path = require('path');

let cachedConfig = null;
let cachedProjectRoot = null;

/**
 * Reads and parses vnext.config.json file
 * @param {string} projectRoot - Project root folder
 * @returns {Object} vnext.config.json content
 */
function loadVnextConfig(projectRoot) {
  // Cache check
  if (cachedConfig && cachedProjectRoot === projectRoot) {
    return cachedConfig;
  }

  const configPath = path.join(projectRoot, 'vnext.config.json');
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`vnext.config.json not found: ${configPath}`);
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    cachedConfig = JSON.parse(content);
    cachedProjectRoot = projectRoot;
    return cachedConfig;
  } catch (error) {
    throw new Error(`Failed to read vnext.config.json: ${error.message}`);
  }
}

/**
 * Returns domain information
 * @param {string} projectRoot - Project root folder
 * @returns {string} Domain name
 */
function getDomain(projectRoot) {
  const config = loadVnextConfig(projectRoot);
  
  if (!config.domain) {
    throw new Error('domain not found in vnext.config.json');
  }
  
  return config.domain;
}

/**
 * Returns paths information
 * @param {string} projectRoot - Project root folder
 * @returns {Object} Paths object
 */
function getPaths(projectRoot) {
  const config = loadVnextConfig(projectRoot);
  
  if (!config.paths) {
    throw new Error('paths not found in vnext.config.json');
  }
  
  return config.paths;
}

/**
 * Returns components root folder
 * @param {string} projectRoot - Project root folder
 * @returns {string} Components root folder path
 */
function getComponentsRoot(projectRoot) {
  const paths = getPaths(projectRoot);
  
  if (!paths.componentsRoot) {
    throw new Error('paths.componentsRoot not found in vnext.config.json');
  }
  
  return path.join(projectRoot, paths.componentsRoot);
}

/**
 * Returns component types and folder names
 * @param {string} projectRoot - Project root folder
 * @returns {Object} Component type -> folder name mapping
 */
function getComponentTypes(projectRoot) {
  const paths = getPaths(projectRoot);
  
  // All paths except componentsRoot are component types
  const componentTypes = {};
  
  for (const [key, value] of Object.entries(paths)) {
    if (key !== 'componentsRoot') {
      componentTypes[key] = value;
    }
  }
  
  return componentTypes;
}

/**
 * Returns full configuration
 * @param {string} projectRoot - Project root folder
 * @returns {Object} Full vnext.config.json content
 */
function getFullConfig(projectRoot) {
  return loadVnextConfig(projectRoot);
}

/**
 * Clears the cache
 */
function clearCache() {
  cachedConfig = null;
  cachedProjectRoot = null;
}

module.exports = {
  loadVnextConfig,
  getDomain,
  getPaths,
  getComponentsRoot,
  getComponentTypes,
  getFullConfig,
  clearCache
};

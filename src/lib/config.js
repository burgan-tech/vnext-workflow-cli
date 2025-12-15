const Conf = require('conf');
const path = require('path');

const config = new Conf({
  projectName: 'vnext-workflow-cli',
  defaults: {
    AUTO_DISCOVER: true,
    API_BASE_URL: 'http://localhost:4201',
    API_VERSION: 'v1',
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_NAME: 'vNext_WorkflowDb',
    DB_USER: 'postgres',
    DB_PASSWORD: 'postgres',
    USE_DOCKER: false,
    DOCKER_POSTGRES_CONTAINER: 'vnext-postgres',
    DEBUG_MODE: false
  }
});

/**
 * Gets a config value
 * PROJECT_ROOT always returns current working directory (process.cwd())
 * @param {string} key - Config key
 * @returns {any} Config value
 */
function get(key) {
  // PROJECT_ROOT is always the current working directory
  if (key === 'PROJECT_ROOT') {
    return process.cwd();
  }
  return config.get(key);
}

/**
 * Sets a config value
 * PROJECT_ROOT cannot be set (ignored)
 * @param {string} key - Config key
 * @param {any} value - Config value
 */
function set(key, value) {
  // PROJECT_ROOT cannot be saved - always uses cwd
  if (key === 'PROJECT_ROOT') {
    console.log('Note: PROJECT_ROOT is always the current working directory and cannot be changed.');
    return;
  }
  config.set(key, value);
}

/**
 * Gets all config values including PROJECT_ROOT
 * @returns {Object} All config values
 */
function getAll() {
  return {
    PROJECT_ROOT: process.cwd(),
    ...config.store
  };
}

module.exports = {
  get,
  set,
  getAll,
  clear: () => config.clear(),
  path: config.path
};

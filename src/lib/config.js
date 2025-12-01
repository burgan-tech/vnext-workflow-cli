const Conf = require('conf');
const path = require('path');

const config = new Conf({
  projectName: 'vnext-workflow-cli',
  defaults: {
    PROJECT_ROOT: process.cwd(),
    AUTO_DISCOVER: true,
    API_BASE_URL: 'http://localhost:4201',
    API_VERSION: 'v1',
    API_DOMAIN: 'core',
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

module.exports = {
  get: (key) => config.get(key),
  set: (key, value) => config.set(key, value),
  getAll: () => config.store,
  clear: () => config.clear(),
  path: config.path
};


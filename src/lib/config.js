const Conf = require('conf');

// Default config values for a domain
const DEFAULT_DOMAIN_CONFIG = {
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
};

const DOMAIN_CONFIG_KEYS = Object.keys(DEFAULT_DOMAIN_CONFIG);

const config = new Conf({
  projectName: 'vnext-workflow-cli'
});

/**
 * Migrates old flat config to new domain-aware format.
 * Old: { API_BASE_URL: "...", DB_NAME: "..." }
 * New: { ACTIVE_DOMAIN: "default", DOMAINS: [{ DOMAIN_NAME: "default", ... }] }
 */
function migrateConfig() {
  const store = config.store;

  // Already in new format - skip
  if (store.ACTIVE_DOMAIN !== undefined && Array.isArray(store.DOMAINS)) {
    return;
  }

  // Collect existing values from old flat config
  const existingValues = {};
  for (const key of DOMAIN_CONFIG_KEYS) {
    if (store[key] !== undefined) {
      existingValues[key] = store[key];
    }
  }

  // Create default domain: defaults + any existing overrides
  const defaultDomain = {
    DOMAIN_NAME: 'default',
    ...DEFAULT_DOMAIN_CONFIG,
    ...existingValues
  };

  // Clear old keys and set new format via conf API
  for (const key of DOMAIN_CONFIG_KEYS) {
    config.delete(key);
  }
  config.set('ACTIVE_DOMAIN', 'default');
  config.set('DOMAINS', [defaultDomain]);
}

// Run migration on module load
migrateConfig();

/**
 * Returns the active domain config object.
 * @returns {Object} Active domain config
 */
function getActiveDomainConfig() {
  const activeDomain = config.get('ACTIVE_DOMAIN');
  const domains = config.get('DOMAINS') || [];
  const domain = domains.find(d => d.DOMAIN_NAME === activeDomain);

  if (!domain) {
    throw new Error(`Active domain "${activeDomain}" not found in config.`);
  }
  return domain;
}

/**
 * Gets a config value from the active domain.
 * PROJECT_ROOT always returns process.cwd().
 * @param {string} key - Config key
 * @returns {any} Config value
 */
function get(key) {
  if (key === 'PROJECT_ROOT') {
    return process.cwd();
  }
  if (key === 'ACTIVE_DOMAIN') {
    return config.get('ACTIVE_DOMAIN');
  }
  const domainConfig = getActiveDomainConfig();
  return domainConfig[key];
}

/**
 * Sets a config value on the active domain.
 * PROJECT_ROOT cannot be set (always uses cwd).
 * @param {string} key - Config key
 * @param {any} value - Config value
 */
function set(key, value) {
  const RESERVED_KEYS = {
    PROJECT_ROOT: 'PROJECT_ROOT is always the current working directory and cannot be changed.',
    DOMAIN_NAME: 'DOMAIN_NAME cannot be changed directly. Use "wf domain add/remove" instead.',
    ACTIVE_DOMAIN: 'ACTIVE_DOMAIN cannot be changed directly. Use "wf domain use <name>" instead.'
  };

  if (RESERVED_KEYS[key]) {
    throw new Error(RESERVED_KEYS[key]);
  }

  const activeDomainName = config.get('ACTIVE_DOMAIN');
  const domains = config.get('DOMAINS') || [];
  const idx = domains.findIndex(d => d.DOMAIN_NAME === activeDomainName);

  if (idx === -1) {
    throw new Error(`Active domain "${activeDomainName}" not found.`);
  }

  domains[idx][key] = value;
  config.set('DOMAINS', domains);
}

/**
 * Gets all config values from the active domain.
 * @returns {Object} All config values including PROJECT_ROOT and ACTIVE_DOMAIN
 */
function getAll() {
  const domainConfig = getActiveDomainConfig();
  return {
    PROJECT_ROOT: process.cwd(),
    ACTIVE_DOMAIN: config.get('ACTIVE_DOMAIN'),
    ...domainConfig
  };
}

/**
 * Resets config to default state.
 */
function clear() {
  config.clear();
  config.set('ACTIVE_DOMAIN', 'default');
  config.set('DOMAINS', [{
    DOMAIN_NAME: 'default',
    ...DEFAULT_DOMAIN_CONFIG
  }]);
}

/**
 * Adds a new domain. Missing values are inherited from the default domain.
 * @param {string} name - Domain name
 * @param {Object} options - Domain config overrides
 * @returns {Object} Created domain config
 */
function addDomain(name, options) {
  const domains = config.get('DOMAINS') || [];

  if (domains.find(d => d.DOMAIN_NAME === name)) {
    throw new Error(`Domain "${name}" already exists.`);
  }

  // Use default domain as base, fall back to DEFAULT_DOMAIN_CONFIG
  const defaultDomain = domains.find(d => d.DOMAIN_NAME === 'default');
  const base = defaultDomain
    ? { ...defaultDomain }
    : { ...DEFAULT_DOMAIN_CONFIG };
  delete base.DOMAIN_NAME;

  const newDomain = {
    DOMAIN_NAME: name,
    ...base,
    ...options
  };

  domains.push(newDomain);
  config.set('DOMAINS', domains);
  return newDomain;
}

/**
 * Switches the active domain.
 * @param {string} name - Domain name to activate
 */
function useDomain(name) {
  const domains = config.get('DOMAINS') || [];
  if (!domains.find(d => d.DOMAIN_NAME === name)) {
    throw new Error(`Domain "${name}" not found.`);
  }
  config.set('ACTIVE_DOMAIN', name);
}

/**
 * Lists all domains with active domain info.
 * @returns {Object} { activeDomain, domains }
 */
function listDomains() {
  return {
    activeDomain: config.get('ACTIVE_DOMAIN'),
    domains: config.get('DOMAINS') || []
  };
}

/**
 * Removes a domain. Cannot remove the default domain.
 * If the removed domain was active, switches to default.
 * @param {string} name - Domain name to remove
 */
function removeDomain(name) {
  if (name === 'default') {
    throw new Error('Cannot remove the default domain.');
  }

  const domains = config.get('DOMAINS') || [];
  const filtered = domains.filter(d => d.DOMAIN_NAME !== name);

  if (filtered.length === domains.length) {
    throw new Error(`Domain "${name}" not found.`);
  }

  config.set('DOMAINS', filtered);

  if (config.get('ACTIVE_DOMAIN') === name) {
    config.set('ACTIVE_DOMAIN', 'default');
  }
}

module.exports = {
  get,
  set,
  getAll,
  clear,
  path: config.path,
  addDomain,
  useDomain,
  listDomains,
  removeDomain,
  getActiveDomainConfig,
  DEFAULT_DOMAIN_CONFIG
};

const chalk = require('chalk');
const config = require('../lib/config');

const VALID_KEYS = [
  'API_BASE_URL', 'API_VERSION', 'DB_HOST', 'DB_PORT', 'DB_NAME',
  'DB_USER', 'DB_PASSWORD', 'AUTO_DISCOVER', 'USE_DOCKER',
  'DOCKER_POSTGRES_CONTAINER', 'DEBUG_MODE'
];

const NUMERIC_KEYS = ['DB_PORT'];
const BOOLEAN_KEYS = ['AUTO_DISCOVER', 'USE_DOCKER', 'DEBUG_MODE'];

/**
 * Coerces a string value to the correct type based on key.
 * Only known numeric keys become numbers; only known boolean keys become booleans.
 * All other values remain as strings.
 */
function coerceValue(key, value) {
  if (BOOLEAN_KEYS.includes(key)) {
    return value === 'true';
  }
  if (NUMERIC_KEYS.includes(key)) {
    const num = Number(value);
    return isNaN(num) ? value : num;
  }
  return value;
}

/**
 * Extracts and coerces valid domain config options from Commander options object.
 */
function extractOptions(options) {
  const parsed = {};
  for (const key of VALID_KEYS) {
    if (options[key] !== undefined) {
      parsed[key] = coerceValue(key, options[key]);
    }
  }
  return parsed;
}

/**
 * Main domain command handler.
 * Dispatches to add, use, list, or remove based on action argument.
 */
async function domainCommand(action, name, options) {
  // Support wf domain --list
  if (options.list || action === 'list') {
    return listDomains();
  }

  if (action === 'active') {
    return showActiveDomain();
  }

  if (action === 'add') {
    return addDomain(name, options);
  }

  if (action === 'use') {
    return useDomain(name);
  }

  if (action === 'remove') {
    return removeDomain(name);
  }

  // No valid action - show usage
  console.log(chalk.cyan.bold('\n🌐 Domain Management\n'));
  console.log('Usage:');
  console.log(chalk.white('  wf domain active                                       Show active domain'));
  console.log(chalk.white('  wf domain list                                         List all domains'));
  console.log(chalk.white('  wf domain add <name> [--API_BASE_URL ...] [--DB_NAME ...]  Add a domain'));
  console.log(chalk.white('  wf domain use <name>                                   Switch active domain'));
  console.log(chalk.white('  wf domain remove <name>                                Remove a domain'));
  console.log('');
}

function showActiveDomain() {
  console.log(config.get('ACTIVE_DOMAIN'));
}

function addDomain(name, options) {
  if (!name) {
    console.log(chalk.red('Usage: wf domain add <name> [--API_BASE_URL <url>] [--DB_NAME <name>] ...'));
    return;
  }

  try {
    const parsed = extractOptions(options);
    const domain = config.addDomain(name, parsed);

    console.log(chalk.green(`\n✓ Domain "${name}" added successfully.\n`));
    printDomainConfig(domain);
  } catch (error) {
    console.log(chalk.red(`\n✗ Error: ${error.message}\n`));
  }
}

function useDomain(name) {
  if (!name) {
    console.log(chalk.red('Usage: wf domain use <name>'));
    return;
  }

  try {
    config.useDomain(name);
    console.log(chalk.green(`\n✓ Active domain switched to "${name}".\n`));

    // Show key applied config values
    const domainConfig = config.getActiveDomainConfig();
    console.log(chalk.cyan('Applied settings:'));
    console.log(chalk.cyan('  API_BASE_URL:'), chalk.white(domainConfig.API_BASE_URL));
    console.log(chalk.cyan('  DB_NAME:     '), chalk.white(domainConfig.DB_NAME));
    console.log('');
  } catch (error) {
    console.log(chalk.red(`\n✗ Error: ${error.message}\n`));
  }
}

function listDomains() {
  const { activeDomain, domains } = config.listDomains();

  console.log(chalk.cyan.bold('\n🌐 Domains:\n'));

  for (const domain of domains) {
    const isActive = domain.DOMAIN_NAME === activeDomain;
    const marker = isActive ? chalk.green('▸ ') : '  ';
    const label = isActive
      ? chalk.green.bold(domain.DOMAIN_NAME) + chalk.green(' (active)')
      : chalk.white(domain.DOMAIN_NAME);

    console.log(`${marker}${label}`);
    console.log(chalk.dim(`    API: ${domain.API_BASE_URL}  DB: ${domain.DB_NAME}`));
  }

  console.log('');
}

function removeDomain(name) {
  if (!name) {
    console.log(chalk.red('Usage: wf domain remove <name>'));
    return;
  }

  try {
    config.removeDomain(name);
    console.log(chalk.green(`\n✓ Domain "${name}" removed.\n`));
  } catch (error) {
    console.log(chalk.red(`\n✗ Error: ${error.message}\n`));
  }
}

function printDomainConfig(domain) {
  for (const [key, value] of Object.entries(domain)) {
    console.log(chalk.cyan(`  ${key}:`), chalk.white(value));
  }
  console.log('');
}

module.exports = domainCommand;

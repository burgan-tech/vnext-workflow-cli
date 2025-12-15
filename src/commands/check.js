const chalk = require('chalk');
const ora = require('ora');
const config = require('../lib/config');
const { discoverComponents, listDiscovered } = require('../lib/discover');
const { getDomain, getComponentTypes, getComponentsRoot } = require('../lib/vnextConfig');
const { testApiConnection } = require('../lib/api');
const { testDbConnection } = require('../lib/db');

// Logging helpers
const LOG = {
  separator: () => console.log(chalk.cyan('═'.repeat(60))),
  subSeparator: () => console.log(chalk.cyan('─'.repeat(60))),
  header: (text) => {
    console.log();
    LOG.separator();
    console.log(chalk.cyan.bold(`  ${text}`));
    LOG.separator();
  },
  success: (text) => console.log(chalk.green(`  ✓ ${text}`)),
  error: (text) => console.log(chalk.red(`  ✗ ${text}`)),
  warning: (text) => console.log(chalk.yellow(`  ⚠ ${text}`)),
  info: (text) => console.log(chalk.dim(`  ○ ${text}`))
};

async function checkCommand() {
  LOG.header('SYSTEM CHECK');
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
  // vnext.config.json check
  console.log(chalk.white.bold('\n  Configuration:\n'));
  
  let domain, componentTypes, componentsRoot;
  try {
    domain = getDomain(projectRoot);
    componentTypes = getComponentTypes(projectRoot);
    componentsRoot = getComponentsRoot(projectRoot);
    
    LOG.success(`vnext.config.json found`);
    console.log(chalk.dim(`    Domain: ${domain}`));
    console.log(chalk.dim(`    Components Root: ${componentsRoot}`));
  } catch (error) {
    LOG.error(`vnext.config.json: ${error.message}`);
    componentTypes = {};
  }
  
  // API check
  console.log(chalk.white.bold('\n  Connection Status:\n'));
  
  let apiSpinner = ora('  Checking API...').start();
  try {
    const apiUrl = config.get('API_BASE_URL');
    const isApiOk = await testApiConnection(apiUrl);
    if (isApiOk) {
      apiSpinner.succeed(chalk.green(`  API: Accessible (${apiUrl})`));
    } else {
      apiSpinner.fail(chalk.red(`  API: Not accessible (${apiUrl})`));
    }
  } catch (error) {
    apiSpinner.fail(chalk.red(`  API: Error - ${error.message}`));
  }
  
  // DB check
  let dbSpinner = ora('  Checking database...').start();
  try {
    const useDockerValue = config.get('USE_DOCKER');
    const isDbOk = await testDbConnection({
      host: config.get('DB_HOST'),
      port: config.get('DB_PORT'),
      database: config.get('DB_NAME'),
      user: config.get('DB_USER'),
      password: config.get('DB_PASSWORD'),
      useDocker: useDockerValue === true || useDockerValue === 'true',
      dockerContainer: config.get('DOCKER_POSTGRES_CONTAINER')
    });
    if (isDbOk) {
      dbSpinner.succeed(chalk.green(`  DB: Connected (${config.get('DB_HOST')}:${config.get('DB_PORT')})`));
    } else {
      dbSpinner.fail(chalk.red('  DB: Cannot connect'));
    }
  } catch (error) {
    dbSpinner.fail(chalk.red(`  DB: Error - ${error.message}`));
  }
  
  // Folder scan
  if (autoDiscover && Object.keys(componentTypes).length > 0) {
    console.log(chalk.white.bold('\n  Component Folders:\n'));
    
    let discoverSpinner = ora('  Scanning folders...').start();
    try {
      const discovered = await discoverComponents(projectRoot);
      discoverSpinner.stop();
      
      const list = listDiscovered(discovered, componentTypes);
      for (const item of list) {
        if (item.found) {
          console.log(chalk.green(`  ✓ ${item.name.padEnd(12)} → ${item.folderName}/`));
        } else {
          console.log(chalk.yellow(`  ○ ${item.name.padEnd(12)} ${chalk.dim('(not found)')}`));
        }
      }
    } catch (error) {
      discoverSpinner.fail(chalk.red(`  Folder scan error: ${error.message}`));
    }
  } else if (!autoDiscover) {
    console.log(chalk.yellow('\n  ⚠ AUTO_DISCOVER is disabled'));
  }
  
  LOG.separator();
  console.log(chalk.green.bold('\n  ✓ Check completed\n'));
}

module.exports = checkCommand;

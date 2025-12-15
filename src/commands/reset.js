const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const path = require('path');
const { glob } = require('glob');
const config = require('../lib/config');
const { discoverComponents } = require('../lib/discover');
const { getDomain, getComponentTypes } = require('../lib/vnextConfig');
const { getJsonMetadata, findAllJson, detectComponentType } = require('../lib/workflow');
const { publishComponent, reinitializeSystem } = require('../lib/api');
const { getInstanceId, deleteWorkflow } = require('../lib/db');

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
  info: (text) => console.log(chalk.dim(`  ○ ${text}`)),
  component: (type, name, status, detail = '') => {
    const typeLabel = chalk.cyan(`[${type}]`);
    const nameLabel = chalk.white(name);
    if (status === 'success') {
      console.log(`  ${typeLabel} ${chalk.green('✓')} ${nameLabel} ${chalk.dim(detail)}`);
    } else if (status === 'error') {
      console.log(`  ${typeLabel} ${chalk.red('✗')} ${nameLabel}`);
      if (detail) console.log(chalk.red(`    └─ ${detail}`));
    } else if (status === 'skip') {
      console.log(`  ${typeLabel} ${chalk.dim('○')} ${nameLabel} ${chalk.dim(detail)}`);
    }
  }
};

async function resetCommand(options) {
  LOG.header('COMPONENT RESET (Force Update)');
  
  const projectRoot = config.get('PROJECT_ROOT');
  
  // Get domain from vnext.config.json
  let domain, componentTypes;
  try {
    domain = getDomain(projectRoot);
    componentTypes = getComponentTypes(projectRoot);
  } catch (error) {
    LOG.error(`Failed to read vnext.config.json: ${error.message}`);
    return;
  }
  
  // DB Config
  const useDockerValue = config.get('USE_DOCKER');
  const dbConfig = {
    host: config.get('DB_HOST'),
    port: config.get('DB_PORT'),
    database: config.get('DB_NAME'),
    user: config.get('DB_USER'),
    password: config.get('DB_PASSWORD'),
    useDocker: useDockerValue === true || useDockerValue === 'true',
    dockerContainer: config.get('DOCKER_POSTGRES_CONTAINER')
  };
  
  // API Config
  const apiConfig = {
    baseUrl: config.get('API_BASE_URL'),
    version: config.get('API_VERSION'),
    domain: domain
  };
  
  console.log(chalk.dim(`  Domain: ${domain}`));
  console.log(chalk.dim(`  API: ${apiConfig.baseUrl}`));
  console.log();
  
  // Discover folders
  const spinner = ora('  Scanning folders...').start();
  let discovered;
  try {
    discovered = await discoverComponents(projectRoot);
    spinner.succeed(chalk.green('  Folders discovered'));
  } catch (error) {
    spinner.fail(chalk.red(`  Folder scan error: ${error.message}`));
    return;
  }
  
  // Build choices dynamically
  const choices = [];
  for (const [type, folderName] of Object.entries(componentTypes)) {
    if (discovered[type]) {
      choices.push({ name: `${type} (${folderName}/)`, value: type });
    }
  }
  
  choices.push(new inquirer.Separator());
  choices.push({ name: 'ALL (All folders)', value: 'ALL' });
  
  // User selection
  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Which folder to reset?',
    choices: choices
  }]);
  
  // Find files
  let jsonFiles = [];
  
  if (selected === 'ALL') {
    const files = await findAllJson(discovered);
    jsonFiles = files.map(f => ({
      path: f,
      type: detectComponentType(f, projectRoot),
      fileName: path.basename(f)
    }));
  } else {
    const dir = discovered[selected];
    if (!dir) {
      LOG.error(`${selected} folder not found`);
      return;
    }
    
    // Find JSONs in this folder only
    const pattern = path.join(dir, '**/*.json');
    const files = await glob(pattern, {
      ignore: [
        '**/.meta/**',
        '**/.meta',
        '**/*.diagram.json',
        '**/package*.json',
        '**/*config*.json'
      ]
    });
    
    jsonFiles = files.map(f => ({
      path: f,
      type: selected,
      fileName: path.basename(f)
    }));
  }
  
  if (jsonFiles.length === 0) {
    LOG.warning('No JSON files found');
    console.log();
    return;
  }
  
  // Final confirmation
  LOG.warning(`${jsonFiles.length} components will be reset!`);
  console.log();
  
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Continue?',
    default: false
  }]);
  
  if (!confirm) {
    LOG.warning('Operation cancelled.');
    console.log();
    return;
  }
  
  // Group by component type
  const componentStats = {};
  const errors = [];
  
  console.log(chalk.blue('\n  Resetting components...\n'));
  
  for (const jsonInfo of jsonFiles) {
    const { path: jsonPath, type, fileName } = jsonInfo;
    
    // Initialize stats
    if (!componentStats[type]) {
      componentStats[type] = { success: 0, failed: 0, skipped: 0, deleted: 0 };
    }
    
    try {
      const metadata = await getJsonMetadata(jsonPath);
      
      if (!metadata.key || !metadata.version) {
        LOG.component(type, fileName, 'skip', 'no key/version');
        componentStats[type].skipped++;
        continue;
      }
      
      // Detect flow type
      const flow = metadata.flow || detectComponentType(jsonPath, projectRoot);
      
      // Check if exists in DB
      const existingId = await getInstanceId(dbConfig, flow, metadata.key, metadata.version);
      
      // If exists, delete first (force reset)
      let wasDeleted = false;
      if (existingId) {
        await deleteWorkflow(dbConfig, flow, existingId);
        wasDeleted = true;
        componentStats[type].deleted++;
      }
      
      // Publish to API
      const result = await publishComponent(apiConfig.baseUrl, metadata.data);
      
      if (result.success) {
        const action = wasDeleted ? 'reset' : 'created';
        LOG.component(type, fileName, 'success', `→ ${action}`);
        componentStats[type].success++;
      } else {
        LOG.component(type, fileName, 'error', result.error);
        componentStats[type].failed++;
        errors.push({ type, file: fileName, error: result.error });
      }
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      LOG.component(type, fileName, 'error', errorMsg);
      componentStats[type].failed++;
      errors.push({ type, file: fileName, error: errorMsg });
    }
  }
  
  // Re-initialize
  const totalSuccess = Object.values(componentStats).reduce((sum, s) => sum + s.success, 0);
  
  if (totalSuccess > 0) {
    console.log();
    const reinitSpinner = ora('  Re-initializing system...').start();
    const reinitSuccess = await reinitializeSystem(apiConfig.baseUrl, apiConfig.version);
    
    if (reinitSuccess) {
      reinitSpinner.succeed(chalk.green('  System re-initialized'));
    } else {
      reinitSpinner.warn(chalk.yellow('  System re-initialization failed (continuing)'));
    }
  }
  
  // SUMMARY REPORT
  LOG.header('RESET SUMMARY');
  
  // Component statistics
  console.log(chalk.white.bold('\n  Component Reset Results:\n'));
  
  for (const [type, stats] of Object.entries(componentStats)) {
    const successLabel = stats.success > 0 ? chalk.green(`${stats.success} reset`) : '';
    const deletedLabel = stats.deleted > 0 ? chalk.yellow(`${stats.deleted} deleted`) : '';
    const failedLabel = stats.failed > 0 ? chalk.red(`${stats.failed} failed`) : '';
    const skippedLabel = stats.skipped > 0 ? chalk.dim(`${stats.skipped} skipped`) : '';
    
    const parts = [successLabel, deletedLabel, failedLabel, skippedLabel].filter(Boolean);
    console.log(`  ${chalk.cyan(type.padEnd(12))} : ${parts.join(', ') || chalk.dim('0')}`);
  }
  
  // Errors
  if (errors.length > 0) {
    console.log();
    LOG.subSeparator();
    console.log(chalk.red.bold('\n  ERRORS:\n'));
    
    for (const err of errors) {
      console.log(chalk.red(`  [${err.type}] ${err.file}`));
      console.log(chalk.dim(`    └─ ${err.error}`));
    }
  }
  
  LOG.separator();
  
  const totalFailed = Object.values(componentStats).reduce((sum, s) => sum + s.failed, 0);
  
  if (totalSuccess > 0 && totalFailed === 0) {
    console.log(chalk.green.bold('\n  ✓ Reset completed\n'));
  } else if (totalFailed > 0) {
    console.log(chalk.yellow.bold(`\n  ⚠ Reset completed (${totalFailed} errors)\n`));
  }
}

module.exports = resetCommand;

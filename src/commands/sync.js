const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const config = require('../lib/config');
const { discoverComponents, findAllJsonFiles } = require('../lib/discover');
const { getDomain, getComponentTypes } = require('../lib/vnextConfig');
const { publishComponent, reinitializeSystem } = require('../lib/api');
const { getInstanceId, deleteWorkflow } = require('../lib/db');
const { getJsonMetadata, detectComponentType } = require('../lib/workflow');
const { processCsxFile, findAllCsx } = require('../lib/csx');

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

async function syncCommand() {
  LOG.header('SYSTEM SYNC - Add Missing Components');
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
  if (!autoDiscover) {
    LOG.warning('AUTO_DISCOVER is disabled. To enable:');
    console.log(chalk.dim('   workflow config set AUTO_DISCOVER true\n'));
    return;
  }
  
  // Get domain from vnext.config.json
  let domain;
  try {
    domain = getDomain(projectRoot);
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
  const discoverSpinner = ora('Scanning folders...').start();
  let discovered;
  try {
    discovered = await discoverComponents(projectRoot);
    discoverSpinner.succeed(chalk.green('Folders discovered'));
  } catch (error) {
    discoverSpinner.fail(chalk.red(`Folder scan error: ${error.message}`));
    return;
  }
  
  // FIRST: Update all CSX files
  const csxSpinner = ora('Finding CSX files...').start();
  let csxFiles;
  try {
    csxFiles = await findAllCsx(projectRoot);
    csxSpinner.succeed(chalk.green(`${csxFiles.length} CSX files found`));
  } catch (error) {
    csxSpinner.warn(chalk.yellow(`CSX scan error: ${error.message}`));
    csxFiles = [];
  }
  
  // Update CSX files
  const csxResults = { success: 0, failed: 0, errors: [] };
  
  if (csxFiles.length > 0) {
    console.log(chalk.blue('\n  Writing CSX files to JSONs...\n'));
    
    for (const csxFile of csxFiles) {
      const fileName = path.basename(csxFile);
      
      try {
        const result = await processCsxFile(csxFile, projectRoot);
        
        if (result.success) {
          LOG.component('CSX', fileName, 'success', `→ ${result.updatedJsonCount} JSON, ${result.totalUpdates} refs`);
          csxResults.success++;
        } else {
          LOG.component('CSX', fileName, 'skip', result.message);
        }
      } catch (error) {
        LOG.component('CSX', fileName, 'error', error.message);
        csxResults.failed++;
        csxResults.errors.push({ file: fileName, error: error.message });
      }
    }
  }
  
  // Find all JSON files
  const findSpinner = ora('Finding JSON files...').start();
  let allJsonFiles;
  try {
    allJsonFiles = await findAllJsonFiles(discovered);
    findSpinner.succeed(chalk.green(`${allJsonFiles.length} JSON files found`));
  } catch (error) {
    findSpinner.fail(chalk.red(`JSON scan error: ${error.message}`));
    return;
  }
  
  // Group by component type
  const componentStats = {};
  const errors = [];
  
  console.log(chalk.blue('\n  Publishing components...\n'));
  
  for (const jsonInfo of allJsonFiles) {
    const { path: jsonPath, type, fileName } = jsonInfo;
    
    // Initialize stats
    if (!componentStats[type]) {
      componentStats[type] = { success: 0, failed: 0, skipped: 0, existing: 0 };
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
      
      if (existingId) {
        // Already exists, skip
        LOG.component(type, fileName, 'skip', 'already exists');
        componentStats[type].existing++;
        continue;
      }
      
      // Not in DB, publish to API
      const result = await publishComponent(apiConfig.baseUrl, metadata.data);
      
      if (result.success) {
        LOG.component(type, fileName, 'success', '→ published');
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
    const reinitSpinner = ora('Re-initializing system...').start();
    const reinitSuccess = await reinitializeSystem(apiConfig.baseUrl, apiConfig.version);
    
    if (reinitSuccess) {
      reinitSpinner.succeed(chalk.green('System re-initialized'));
    } else {
      reinitSpinner.warn(chalk.yellow('System re-initialization failed'));
    }
  }
  
  // SUMMARY REPORT
  LOG.header('SYNC SUMMARY');
  
  // Component statistics
  console.log(chalk.white.bold('\n  Component Publish Results:\n'));
  
  const componentTypes = getComponentTypes(projectRoot);
  for (const [type, folderName] of Object.entries(componentTypes)) {
    const stats = componentStats[type];
    if (stats) {
      const successLabel = stats.success > 0 ? chalk.green(`${stats.success} added`) : '';
      const existingLabel = stats.existing > 0 ? chalk.dim(`${stats.existing} existing`) : '';
      const failedLabel = stats.failed > 0 ? chalk.red(`${stats.failed} failed`) : '';
      const skippedLabel = stats.skipped > 0 ? chalk.dim(`${stats.skipped} skipped`) : '';
      
      const parts = [successLabel, existingLabel, failedLabel, skippedLabel].filter(Boolean);
      console.log(`  ${chalk.cyan(type.padEnd(12))} : ${parts.join(', ') || chalk.dim('0')}`);
    }
  }
  
  // CSX summary
  if (csxFiles.length > 0) {
    console.log();
    const csxSuccessLabel = csxResults.success > 0 ? chalk.green(`${csxResults.success} success`) : chalk.dim('0 success');
    const csxFailedLabel = csxResults.failed > 0 ? chalk.red(`, ${csxResults.failed} failed`) : '';
    console.log(`  ${chalk.cyan('CSX'.padEnd(12))} : ${csxSuccessLabel}${csxFailedLabel}`);
  }
  
  // Errors
  if (errors.length > 0 || csxResults.errors.length > 0) {
    console.log();
    LOG.subSeparator();
    console.log(chalk.red.bold('\n  ERRORS:\n'));
    
    for (const err of errors) {
      console.log(chalk.red(`  [${err.type}] ${err.file}`));
      console.log(chalk.dim(`    └─ ${err.error}`));
    }
    
    for (const err of csxResults.errors) {
      console.log(chalk.red(`  [CSX] ${err.file}`));
      console.log(chalk.dim(`    └─ ${err.error}`));
    }
  }
  
  LOG.separator();
  
  const totalFailed = Object.values(componentStats).reduce((sum, s) => sum + s.failed, 0) + csxResults.failed;
  
  if (totalSuccess === 0 && totalFailed === 0) {
    console.log(chalk.green.bold('\n  ✓ System up to date - All records exist\n'));
  } else if (totalFailed === 0) {
    console.log(chalk.green.bold('\n  ✓ Sync completed\n'));
  } else {
    console.log(chalk.yellow.bold(`\n  ⚠ Sync completed (${totalFailed} errors)\n`));
  }
}

module.exports = syncCommand;

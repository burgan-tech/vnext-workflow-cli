const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const inquirer = require('inquirer');
const config = require('../lib/config');
const { discoverComponents, findAllJsonFiles } = require('../lib/discover');
const { getDomain, getComponentTypes } = require('../lib/vnextConfig');
const { publishComponent, reinitializeSystem } = require('../lib/api');
const { getInstanceId, deleteWorkflow } = require('../lib/db');
const { getJsonMetadata, getGitChangedJson, findAllJson, detectComponentType } = require('../lib/workflow');
const { processCsxFile, getGitChangedCsx, findAllCsx } = require('../lib/csx');

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

async function updateCommand(options) {
  LOG.header('COMPONENT UPDATE');
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
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
  
  // FIRST: Update changed CSX files
  let csxFiles = [];
  const csxResults = { success: 0, failed: 0, errors: [] };
  
  if (options.all) {
    // Find all CSX files
    const csxSpinner = ora('Finding all CSX files...').start();
    try {
      csxFiles = await findAllCsx(projectRoot);
      csxSpinner.succeed(chalk.green(`${csxFiles.length} CSX files found`));
    } catch (error) {
      csxSpinner.warn(chalk.yellow(`CSX scan error: ${error.message}`));
    }
  } else {
    // Find changed CSX files in Git
    const csxSpinner = ora('Finding changed CSX files in Git...').start();
    try {
      csxFiles = await getGitChangedCsx(projectRoot);
      
      if (csxFiles.length > 0) {
        csxSpinner.succeed(chalk.green(`${csxFiles.length} changed CSX files found`));
      } else {
        csxSpinner.info(chalk.dim('No changed CSX files'));
      }
    } catch (error) {
      csxSpinner.warn(chalk.yellow(`CSX scan error: ${error.message}`));
    }
  }
  
  // Update CSX files
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
  
  let jsonFiles = [];
  
  // Which JSON files to process?
  if (options.file) {
    // Specific file
    const filePath = path.isAbsolute(options.file) 
      ? options.file 
      : path.join(projectRoot, options.file);
    jsonFiles = [{ path: filePath, type: detectComponentType(filePath, projectRoot), fileName: path.basename(filePath) }];
    console.log(chalk.blue(`\n  File: ${path.basename(filePath)}\n`));
  } else if (options.all) {
    // All JSON files
    LOG.warning('ALL components will be updated!');
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
    
    const spinner = ora('Finding all JSON files...').start();
    
    if (autoDiscover) {
      const discovered = await discoverComponents(projectRoot);
      const files = await findAllJson(discovered);
      jsonFiles = files.map(f => ({
        path: f,
        type: detectComponentType(f, projectRoot),
        fileName: path.basename(f)
      }));
    }
    
    spinner.succeed(chalk.green(`${jsonFiles.length} JSON files found`));
  } else {
    // Changed files in Git (default)
    const spinner = ora('Finding changed JSON files in Git...').start();
    const changedFiles = await getGitChangedJson(projectRoot);
    
    if (changedFiles.length === 0) {
      spinner.info(chalk.yellow('No changed JSON files in Git'));
      console.log(chalk.green('\n  ✓ All components up to date\n'));
      return;
    }
    
    jsonFiles = changedFiles.map(f => ({
      path: f,
      type: detectComponentType(f, projectRoot),
      fileName: path.basename(f)
    }));
    
    spinner.succeed(chalk.green(`${jsonFiles.length} changed JSON files found`));
  }
  
  // Group by component type
  const componentStats = {};
  const errors = [];
  
  console.log(chalk.blue('\n  Publishing components...\n'));
  
  for (const jsonInfo of jsonFiles) {
    const { path: jsonPath, type, fileName } = jsonInfo;
    
    // Initialize stats
    if (!componentStats[type]) {
      componentStats[type] = { success: 0, failed: 0, skipped: 0, updated: 0, created: 0 };
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
      
      // If exists, delete first
      let wasDeleted = false;
      if (existingId) {
        await deleteWorkflow(dbConfig, flow, existingId);
        wasDeleted = true;
      }
      
      // Publish to API
      const result = await publishComponent(apiConfig.baseUrl, metadata.data);
      
      if (result.success) {
        if (wasDeleted) {
          LOG.component(type, fileName, 'success', '→ updated');
          componentStats[type].updated++;
        } else {
          LOG.component(type, fileName, 'success', '→ created');
          componentStats[type].created++;
        }
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
      reinitSpinner.warn(chalk.yellow('System re-initialization failed (continuing)'));
    }
  }
  
  // SUMMARY REPORT
  LOG.header('UPDATE SUMMARY');
  
  // Component statistics
  console.log(chalk.white.bold('\n  Component Update Results:\n'));
  
  for (const [type, stats] of Object.entries(componentStats)) {
    const updatedLabel = stats.updated > 0 ? chalk.green(`${stats.updated} updated`) : '';
    const createdLabel = stats.created > 0 ? chalk.green(`${stats.created} created`) : '';
    const failedLabel = stats.failed > 0 ? chalk.red(`${stats.failed} failed`) : '';
    const skippedLabel = stats.skipped > 0 ? chalk.dim(`${stats.skipped} skipped`) : '';
    
    const parts = [updatedLabel, createdLabel, failedLabel, skippedLabel].filter(Boolean);
    console.log(`  ${chalk.cyan(type.padEnd(12))} : ${parts.join(', ') || chalk.dim('0')}`);
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
  
  if (totalSuccess > 0 && totalFailed === 0) {
    console.log(chalk.green.bold('\n  ✓ Update completed\n'));
  } else if (totalFailed > 0) {
    console.log(chalk.yellow.bold(`\n  ⚠ Update completed (${totalFailed} errors)\n`));
  }
}

module.exports = updateCommand;

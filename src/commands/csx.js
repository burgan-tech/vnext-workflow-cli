const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const config = require('../lib/config');
const { getDomain } = require('../lib/vnextConfig');
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

async function csxCommand(options) {
  LOG.header('CSX UPDATE');
  
  const projectRoot = config.get('PROJECT_ROOT');
  
  // Check domain
  try {
    const domain = getDomain(projectRoot);
    console.log(chalk.dim(`  Domain: ${domain}`));
    console.log();
  } catch (error) {
    LOG.error(`Failed to read vnext.config.json: ${error.message}`);
    return;
  }
  
  let csxFiles = [];
  
  // Which CSX files to process?
  if (options.file) {
    // Specific file
    const filePath = path.isAbsolute(options.file) 
      ? options.file 
      : path.join(projectRoot, options.file);
    csxFiles = [filePath];
    console.log(chalk.blue(`  File: ${path.basename(filePath)}\n`));
  } else if (options.all) {
    // All CSX files
    const spinner = ora('  Finding all CSX files...').start();
    try {
      csxFiles = await findAllCsx(projectRoot);
      spinner.succeed(chalk.green(`  ${csxFiles.length} CSX files found`));
    } catch (error) {
      spinner.fail(chalk.red(`  CSX scan error: ${error.message}`));
      return;
    }
  } else {
    // Changed files in Git (default)
    const spinner = ora('  Finding changed CSX files in Git...').start();
    try {
      csxFiles = await getGitChangedCsx(projectRoot);
      
      if (csxFiles.length === 0) {
        spinner.info(chalk.yellow('  No changed CSX files in Git'));
        console.log(chalk.green('\n  ✓ All CSX files up to date\n'));
        return;
      }
      
      spinner.succeed(chalk.green(`  ${csxFiles.length} changed CSX files found`));
    } catch (error) {
      spinner.fail(chalk.red(`  CSX scan error: ${error.message}`));
      return;
    }
  }
  
  // Process each CSX file
  const results = { success: 0, failed: 0, errors: [] };
  const updatedFiles = [];
  
  console.log(chalk.blue('\n  Writing CSX files to JSONs...\n'));
  
  for (const csxFile of csxFiles) {
    const fileName = path.basename(csxFile);
    
    try {
      const result = await processCsxFile(csxFile, projectRoot);
      
      if (result.success) {
        LOG.component('CSX', fileName, 'success', `→ ${result.updatedJsonCount} JSON, ${result.totalUpdates} refs`);
        results.success++;
        updatedFiles.push({
          file: fileName,
          jsonCount: result.updatedJsonCount,
          totalUpdates: result.totalUpdates,
          jsonFiles: result.jsonFiles
        });
      } else {
        LOG.component('CSX', fileName, 'skip', result.message);
      }
    } catch (error) {
      LOG.component('CSX', fileName, 'error', error.message);
      results.failed++;
      results.errors.push({ file: fileName, error: error.message });
    }
  }
  
  // SUMMARY REPORT
  LOG.header('CSX UPDATE SUMMARY');
  
  // Results
  console.log(chalk.white.bold('\n  Results:\n'));
  
  const successLabel = results.success > 0 ? chalk.green(`${results.success} success`) : chalk.dim('0 success');
  const failedLabel = results.failed > 0 ? chalk.red(`, ${results.failed} failed`) : '';
  console.log(`  ${chalk.cyan('CSX Files'.padEnd(16))} : ${successLabel}${failedLabel}`);
  
  // Updated JSON details
  if (updatedFiles.length > 0) {
    console.log();
    LOG.subSeparator();
    console.log(chalk.white.bold('\n  Updated JSON Files:\n'));
    
    for (const item of updatedFiles) {
      console.log(chalk.green(`  ${item.file}:`));
      for (const json of item.jsonFiles) {
        console.log(chalk.dim(`    └─ ${json.file} (${json.updates} refs)`));
      }
    }
  }
  
  // Errors
  if (results.errors.length > 0) {
    console.log();
    LOG.subSeparator();
    console.log(chalk.red.bold('\n  ERRORS:\n'));
    
    for (const err of results.errors) {
      console.log(chalk.red(`  [CSX] ${err.file}`));
      console.log(chalk.dim(`    └─ ${err.error}`));
    }
  }
  
  LOG.separator();
  
  if (results.success > 0 && results.failed === 0) {
    console.log(chalk.green.bold('\n  ✓ CSX update completed\n'));
  } else if (results.failed > 0) {
    console.log(chalk.yellow.bold(`\n  ⚠ CSX update completed (${results.failed} errors)\n`));
  }
}

module.exports = csxCommand;

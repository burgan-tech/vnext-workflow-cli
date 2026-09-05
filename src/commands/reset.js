const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const path = require('path');
const { glob } = require('glob');
const { buildDbConfig, buildApiConfig } = require('../lib/config');
const { discoverComponents, toGlobPattern, JSON_IGNORE_PATTERNS } = require('../lib/discover');
const { loadWorkspace, runForEachSolution } = require('../lib/solutions');
const { getJsonMetadata, findAllJson, detectComponentType, checkComponentDomain } = require('../lib/workflow');
const { publishComponent, reinitializeSystem } = require('../lib/api');
const { getInstanceId, deleteWorkflow } = require('../lib/db');
const { LOG, printApiError, printErrorSummaryTable } = require('../lib/ui');

async function resetCommand(options) {
  LOG.header('COMPONENT RESET (Force Update)');

  const loaded = loadWorkspace(options);
  if (!loaded) return;

  // reset is interactive: with several solutions and no --domain, pick one first.
  if (loaded.solutions.length > 1) {
    const { domain } = await inquirer.prompt([{
      type: 'list',
      name: 'domain',
      message: 'Which domain to reset?',
      choices: loaded.solutions.map(s => ({
        name: `${s.domain}  (${s.fileName})${s.profile ? '' : chalk.dim('  — no CLI profile')}`,
        value: s.domain
      }))
    }]);

    loaded.solutions = loaded.solutions.filter(s => s.domain === domain);
    loaded.requestedDomain = domain;
  }

  await runForEachSolution(options, { loaded }, resetSolution);
}

async function resetSolution(solution) {
  const profile = solution.profile;
  const componentTypes = solution.componentTypes;
  const dbConfig = buildDbConfig(profile);
  const apiConfig = buildApiConfig(profile);

  // Discover folders
  const spinner = ora('  Scanning folders...').start();
  let discovered;
  try {
    discovered = await discoverComponents(solution);
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
      type: detectComponentType(f, solution),
      fileName: path.basename(f)
    }));
  } else {
    const dir = discovered[selected];
    if (!dir) {
      LOG.error(`${selected} folder not found`);
      return;
    }

    // Find JSONs in this folder only
    const pattern = toGlobPattern(dir, '**/*.json');
    const files = await glob(pattern, { ignore: JSON_IGNORE_PATTERNS });

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

      // The component must belong to this solution's domain
      const domainError = checkComponentDomain(metadata, solution);
      if (domainError) {
        LOG.component(type, fileName, 'error', domainError);
        componentStats[type].failed++;
        errors.push({ type, file: fileName, error: domainError, errorCode: 'DOMAIN_MISMATCH' });
        continue;
      }

      // Detect flow type
      const flow = metadata.flow || detectComponentType(jsonPath, solution);

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
        printApiError(result, type, fileName);
        componentStats[type].failed++;
        errors.push({ type, file: fileName, error: result.error, statusCode: result.statusCode, apiError: result.apiError });
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
    printErrorSummaryTable(errors);
  }

  LOG.separator();

  const totalFailed = Object.values(componentStats).reduce((sum, s) => sum + s.failed, 0);

  if (totalSuccess > 0 && totalFailed === 0) {
    console.log(chalk.green.bold('\n  ✓ Reset completed\n'));
  } else if (totalFailed > 0) {
    console.log(chalk.yellow.bold(`\n  ⚠ Reset completed (${totalFailed} errors)\n`));
  }

  return { success: totalSuccess, failed: totalFailed, errors };
}

module.exports = resetCommand;

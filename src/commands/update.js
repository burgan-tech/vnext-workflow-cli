const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const inquirer = require('inquirer');
const { glob } = require('glob');
const { buildDbConfig, buildApiConfig } = require('../lib/config');
const {
  discoverComponents,
  resolveFeatureFolders,
  listFeatureFolders,
  toGlobPattern,
  JSON_IGNORE_PATTERNS,
  CSX_IGNORE_PATTERNS
} = require('../lib/discover');
const { loadWorkspace, runForEachSolution } = require('../lib/solutions');
const { publishComponent, reinitializeSystem } = require('../lib/api');
const { getInstanceId, deleteWorkflow } = require('../lib/db');
const { getJsonMetadata, getGitChangedJson, findAllJson, detectComponentType, checkComponentDomain } = require('../lib/workflow');
const { processCsxFile, getGitChangedCsx, findAllCsx } = require('../lib/csx');
const { LOG, printApiError, printErrorSummaryTable } = require('../lib/ui');

async function updateCommand(options) {
  LOG.header('COMPONENT UPDATE');

  // Precedence: --file > --folder > --all > git-changed
  const useFolder = !!options.folder && !options.file;
  const useAll = !!options.all && !options.file && !useFolder;

  // --all asks ONCE for every domain that will actually run, before the loop starts.
  let loaded = null;
  if (useAll) {
    loaded = loadWorkspace(options);
    if (!loaded) return;

    const targets = loaded.solutions.filter(s => s.profile).map(s => s.domain);
    if (targets.length > 0) {
      LOG.warning(`ALL components in domain(s) ${targets.join(', ')} will be updated!`);
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
    }
  }

  await runForEachSolution(
    options,
    { forFile: options.file, loaded },
    (solution) => updateSolution(solution, options)
  );
}

async function updateSolution(solution, options) {
  const profile = solution.profile;
  const autoDiscover = profile.AUTO_DISCOVER;
  const dbConfig = buildDbConfig(profile);
  const apiConfig = buildApiConfig(profile);

  // Folder mode: resolve the feature folder name to a set of directories.
  // --file wins over --folder if both are given (most specific).
  let folderDirs = [];
  const useFolder = !!options.folder && !options.file;

  if (useFolder) {
    folderDirs = await resolveFeatureFolders(solution, options.folder);

    if (folderDirs.length === 0) {
      LOG.warning(`No folder matched "${options.folder}" in domain "${solution.domain}"`);
      const available = await listFeatureFolders(solution);
      if (available.length > 0) {
        console.log(chalk.dim(`\n  Available folders: ${available.join(', ')}\n`));
      }
      return;
    }

    console.log(chalk.blue(`\n  Folder: ${options.folder} → ${folderDirs.length} folder(s)\n`));
  }

  // FIRST: Update changed CSX files
  let csxFiles = [];
  const csxResults = { success: 0, failed: 0, errors: [] };

  if (useFolder) {
    // Find CSX files within the matched feature folders
    const csxSpinner = ora('Finding CSX files in folder...').start();
    try {
      for (const dir of folderDirs) {
        const found = await glob(toGlobPattern(dir, '**/*.csx'), { ignore: CSX_IGNORE_PATTERNS });
        csxFiles.push(...found);
      }
      if (csxFiles.length > 0) {
        csxSpinner.succeed(chalk.green(`${csxFiles.length} CSX files found`));
      } else {
        csxSpinner.info(chalk.dim('No CSX files in folder'));
      }
    } catch (error) {
      csxSpinner.warn(chalk.yellow(`CSX scan error: ${error.message}`));
    }
  } else if (options.all) {
    // Find all CSX files
    const csxSpinner = ora('Finding all CSX files...').start();
    try {
      csxFiles = await findAllCsx(solution);
      csxSpinner.succeed(chalk.green(`${csxFiles.length} CSX files found`));
    } catch (error) {
      csxSpinner.warn(chalk.yellow(`CSX scan error: ${error.message}`));
    }
  } else {
    // Find changed CSX files in Git
    const csxSpinner = ora('Finding changed CSX files in Git...').start();
    try {
      csxFiles = await getGitChangedCsx(solution);

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
        const result = await processCsxFile(csxFile, solution);

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
      : path.join(solution.projectRoot, options.file);
    jsonFiles = [{ path: filePath, type: detectComponentType(filePath, solution), fileName: path.basename(filePath) }];
    console.log(chalk.blue(`\n  File: ${path.basename(filePath)}\n`));
  } else if (useFolder) {
    // All JSON files within the matched feature folders (git-independent)
    const spinner = ora('Finding JSON files in folder...').start();

    for (const dir of folderDirs) {
      const files = await glob(toGlobPattern(dir, '**/*.json'), { ignore: JSON_IGNORE_PATTERNS });
      jsonFiles.push(...files.map(f => ({
        path: f,
        type: detectComponentType(f, solution),
        fileName: path.basename(f)
      })));
    }

    if (jsonFiles.length === 0) {
      spinner.info(chalk.yellow('No JSON files in folder'));
      console.log();
      return;
    }

    spinner.succeed(chalk.green(`${jsonFiles.length} JSON files found`));
  } else if (options.all) {
    // All JSON files (confirmation already given in updateCommand)
    const spinner = ora('Finding all JSON files...').start();

    if (autoDiscover) {
      const discovered = await discoverComponents(solution);
      const files = await findAllJson(discovered);
      jsonFiles = files.map(f => ({
        path: f,
        type: detectComponentType(f, solution),
        fileName: path.basename(f)
      }));
    }

    spinner.succeed(chalk.green(`${jsonFiles.length} JSON files found`));
  } else {
    // Changed files in Git (default)
    const spinner = ora('Finding changed JSON files in Git...').start();
    const changedFiles = await getGitChangedJson(solution);

    if (changedFiles.length === 0) {
      spinner.info(chalk.yellow('No changed JSON files in Git'));
      console.log(chalk.green('\n  ✓ All components up to date\n'));
      return { success: csxResults.success, failed: csxResults.failed, errors: csxResults.errors.map(e => ({ type: 'CSX', ...e })) };
    }

    jsonFiles = changedFiles.map(f => ({
      path: f,
      type: detectComponentType(f, solution),
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
  const allErrors = [
    ...errors,
    ...csxResults.errors.map(e => ({ type: 'CSX', file: e.file, error: e.error }))
  ];
  if (allErrors.length > 0) {
    console.log();
    LOG.subSeparator();
    printErrorSummaryTable(allErrors);
  }

  LOG.separator();

  const totalFailed = Object.values(componentStats).reduce((sum, s) => sum + s.failed, 0) + csxResults.failed;

  if (totalSuccess > 0 && totalFailed === 0) {
    console.log(chalk.green.bold('\n  ✓ Update completed\n'));
  } else if (totalFailed > 0) {
    console.log(chalk.yellow.bold(`\n  ⚠ Update completed (${totalFailed} errors)\n`));
  }

  return { success: totalSuccess + csxResults.success, failed: totalFailed, errors: allErrors };
}

module.exports = updateCommand;

const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const { runForEachSolution } = require('../lib/solutions');
const { processCsxFile, getGitChangedCsx, findAllCsx } = require('../lib/csx');
const { LOG } = require('../lib/ui');
const {
  findAgentFiles,
  findAgentsReferencing,
  findAgentsForChangedInstructions,
  runInstructionSync,
  formatInstructionSummary
} = require('../lib/agentInstructions');

async function csxCommand(options) {
  LOG.header('CSX UPDATE');

  // csx touches only local files, so no CLI domain profile is needed.
  await runForEachSolution(
    options,
    { requireProfile: false, forFile: options.file },
    (solution) => csxSolution(solution, options)
  );
}

async function csxSolution(solution, options) {
  let csxFiles = [];
  // Agent JSONs whose instructions .md is re-inlined (only .md files agents reference)
  let mdAgents = [];

  // Which CSX files to process?
  if (options.file) {
    // Specific file
    const filePath = path.isAbsolute(options.file)
      ? options.file
      : path.join(solution.projectRoot, options.file);
    console.log(chalk.blue(`  File: ${path.basename(filePath)}\n`));
    if (/\.md$/i.test(filePath)) {
      mdAgents = await findAgentsReferencing(solution, [filePath]);
      if (mdAgents.length === 0) {
        LOG.info('No agent references this file as its instructions — nothing to do');
        console.log();
        return;
      }
    } else {
      csxFiles = [filePath];
    }
  } else if (options.all) {
    // All CSX files
    const spinner = ora('  Finding all CSX files...').start();
    try {
      csxFiles = await findAllCsx(solution);
      mdAgents = await findAgentFiles(solution);
      spinner.succeed(chalk.green(`  ${csxFiles.length} CSX files found`));
    } catch (error) {
      spinner.fail(chalk.red(`  CSX scan error: ${error.message}`));
      return;
    }
  } else {
    // Changed files in Git (default)
    const spinner = ora('  Finding changed CSX files in Git...').start();
    try {
      csxFiles = await getGitChangedCsx(solution);
      mdAgents = await findAgentsForChangedInstructions(solution);

      if (csxFiles.length === 0 && mdAgents.length === 0) {
        spinner.info(chalk.yellow('  No changed CSX or agent instruction files in Git'));
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

  if (csxFiles.length > 0) {
    console.log(chalk.blue('\n  Writing CSX files to JSONs...\n'));
  }

  for (const csxFile of csxFiles) {
    const fileName = path.basename(csxFile);

    try {
      const result = await processCsxFile(csxFile, solution);

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
      results.errors.push({ type: 'CSX', file: fileName, error: error.message });
    }
  }

  // Agent instruction files (.md referenced by agents)
  let mdResults = null;
  if (mdAgents.length > 0) {
    console.log(chalk.blue('\n  Writing agent instructions to JSONs...\n'));
    mdResults = runInstructionSync(mdAgents, solution, LOG);
    results.success += mdResults.success;
    results.failed += mdResults.failed;
    results.errors.push(...mdResults.errors);
  }

  // SUMMARY REPORT
  LOG.header('CSX UPDATE SUMMARY');

  // Results
  console.log(chalk.white.bold('\n  Results:\n'));

  const csxSuccess = results.success - (mdResults ? mdResults.success : 0);
  const csxFailed = results.failed - (mdResults ? mdResults.failed : 0);
  if (csxFiles.length > 0) {
    const successLabel = csxSuccess > 0 ? chalk.green(`${csxSuccess} success`) : chalk.dim('0 success');
    const failedLabel = csxFailed > 0 ? chalk.red(`, ${csxFailed} failed`) : '';
    console.log(`  ${chalk.cyan('CSX Files'.padEnd(16))} : ${successLabel}${failedLabel}`);
  }
  const mdLine = formatInstructionSummary(mdResults, chalk);
  if (mdLine) {
    console.log(`  ${chalk.cyan('MD Files'.padEnd(16))} : ${mdLine}`);
  }

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
      console.log(chalk.red(`  [${err.type || 'CSX'}] ${err.file}`));
      console.log(chalk.dim(`    └─ ${err.error}`));
    }
  }

  LOG.separator();

  if (results.success > 0 && results.failed === 0) {
    console.log(chalk.green.bold('\n  ✓ CSX update completed\n'));
  } else if (results.failed > 0) {
    console.log(chalk.yellow.bold(`\n  ⚠ CSX update completed (${results.failed} errors)\n`));
  }

  return results;
}

module.exports = csxCommand;

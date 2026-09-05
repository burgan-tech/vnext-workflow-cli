const chalk = require('chalk');
const ora = require('ora');
const { buildDbConfig } = require('../lib/config');
const { discoverComponents, listDiscovered } = require('../lib/discover');
const { runForEachSolution } = require('../lib/solutions');
const { testApiConnection } = require('../lib/api');
const { testDbConnection } = require('../lib/db');
const { LOG } = require('../lib/ui');

async function checkCommand(options) {
  LOG.header('SYSTEM CHECK');

  // Profiles are not required: a missing profile is exactly what check should report.
  const outcomes = await runForEachSolution(options, { requireProfile: false }, checkSolution);
  if (!outcomes) return;

  LOG.separator();
  console.log(chalk.green.bold('\n  ✓ Check completed\n'));
}

async function checkSolution(solution) {
  const profile = solution.profile;

  // Solution file
  console.log(chalk.white.bold('\n  Configuration:\n'));
  LOG.success(`${solution.fileName} found`);
  console.log(chalk.dim(`    Domain: ${solution.domain}`));
  console.log(chalk.dim(`    Components Root: ${solution.componentsRoot}`));

  // Connection checks (need a CLI profile)
  console.log(chalk.white.bold('\n  Connection Status:\n'));

  if (!profile) {
    LOG.warning(`No CLI domain profile for "${solution.domain}" — API/DB checks skipped`);
    console.log(chalk.dim(`    Run: wf domain add ${solution.domain} --API_BASE_URL <url> --DB_NAME <db>`));
  } else {
    let apiSpinner = ora('  Checking API...').start();
    try {
      const apiUrl = profile.API_BASE_URL;
      const isApiOk = await testApiConnection(apiUrl);
      if (isApiOk) {
        apiSpinner.succeed(chalk.green(`  API: Accessible (${apiUrl})`));
      } else {
        apiSpinner.fail(chalk.red(`  API: Not accessible (${apiUrl})`));
      }
    } catch (error) {
      apiSpinner.fail(chalk.red(`  API: Error - ${error.message}`));
    }

    let dbSpinner = ora('  Checking database...').start();
    try {
      const isDbOk = await testDbConnection(buildDbConfig(profile));
      if (isDbOk) {
        dbSpinner.succeed(chalk.green(`  DB: Connected (${profile.DB_HOST}:${profile.DB_PORT})`));
      } else {
        dbSpinner.fail(chalk.red('  DB: Cannot connect'));
      }
    } catch (error) {
      dbSpinner.fail(chalk.red(`  DB: Error - ${error.message}`));
    }
  }

  // Folder scan
  const autoDiscover = profile ? profile.AUTO_DISCOVER : true;
  const componentTypes = solution.componentTypes;

  if (autoDiscover && Object.keys(componentTypes).length > 0) {
    console.log(chalk.white.bold('\n  Component Folders:\n'));

    let discoverSpinner = ora('  Scanning folders...').start();
    try {
      const discovered = await discoverComponents(solution);
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

  console.log();
}

module.exports = checkCommand;

#!/usr/bin/env node

const { program, Argument } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

// Config
const config = require('../src/lib/config');
const { printActiveDomainBanner } = require('../src/lib/ui');

// Commands
const checkCommand = require('../src/commands/check');
const csxCommand = require('../src/commands/csx');
const updateCommand = require('../src/commands/update');
const syncCommand = require('../src/commands/sync');
const resetCommand = require('../src/commands/reset');
const configCommand = require('../src/commands/config');
const domainCommand = require('../src/commands/domain');

program
  .name('workflow')
  .description('vNext Workflow Manager CLI')
  .version(pkg.version);

// Auto-resolve domain and show banner before each command
program.hook('preAction', (thisCommand, actionCommand) => {
  if (actionCommand.name() === 'domain') return;

  const result = config.resolveWorkspaceDomain(process.cwd());
  if (result.resolved && result.switched) {
    console.log(chalk.dim(`  [auto] Domain switched to "${result.domain}" (from vnext.config.json)`));
  }

  printActiveDomainBanner();
});

// Check command
program
  .command('check')
  .description('System check (API, DB, directories)')
  .action(checkCommand);

// CSX command
program
  .command('csx')
  .description('Update CSX files')
  .option('-a, --all', 'Update all CSX files')
  .option('-f, --file <path>', 'Update a specific CSX file')
  .action(csxCommand);

// Update command
program
  .command('update')
  .description('Update workflows')
  .option('-a, --all', 'Update all workflows')
  .option('-f, --file <path>', 'Update a specific workflow')
  .option('-d, --folder <name>', 'Update all components under a feature folder (across all component types), ignoring git')
  .addHelpText('after', `
Examples:
  wf update                          Update git-changed components (default)
  wf update --all                    Update all components
  wf update --file Views/x.json      Update a single component file
  wf update --folder person          Update every component under the "person" feature (Tasks/person, Workflows/person, Views/person, ...)
  wf update -d Workflows/person       Update only the components in that exact folder

Note: --file takes precedence over --folder, which takes precedence over --all.
`)
  .action(updateCommand);

// Sync command
program
  .command('sync')
  .description('Add missing entries to DB')
  .action(syncCommand);

// Reset command
program
  .command('reset')
  .description('Reset workflows (force update)')
  .action(resetCommand);

// Config command
program
  .command('config')
  .description('Configuration management')
  .argument('<action>', 'set or get')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Config value')
  .action(configCommand);

// Domain command
program
  .command('domain')
  .description('Domain management (multidomain support)')
  .addArgument(new Argument('[action]', 'Action to perform').choices(['active', 'add', 'use', 'list', 'remove']))
  .argument('[name]', 'Domain name')
  .option('-l, --list', 'List domains')
  .option('--API_BASE_URL <url>', 'API base URL')
  .option('--API_VERSION <version>', 'API version')
  .option('--DB_HOST <host>', 'Database host')
  .option('--DB_PORT <port>', 'Database port')
  .option('--DB_NAME <dbname>', 'Database name')
  .option('--DB_USER <user>', 'Database username')
  .option('--DB_PASSWORD <password>', 'Database password')
  .option('--AUTO_DISCOVER <value>', 'Auto discover (true/false)')
  .option('--USE_DOCKER <value>', 'Use Docker (true/false)')
  .option('--DOCKER_POSTGRES_CONTAINER <container>', 'Docker PostgreSQL container name')
  .option('--DEBUG_MODE <value>', 'Debug mode (true/false)')
  .addHelpText('after', `
Examples:
  wf domain active                                                   Show active domain name
  wf domain list                                                     List domains
  wf domain --list                                                   List domains
  wf domain add domain-a --API_BASE_URL http://localhost:4201 --DB_NAME myDb   Add a new domain
  wf domain use domain-a                                             Switch active domain
  wf domain remove domain-a                                          Remove a domain

Notes:
  - When adding a domain, unspecified settings are inherited from the default domain.
  - The default domain cannot be deleted.
  - If the active domain is deleted, it automatically switches back to default.
`)
  .action(domainCommand);

// Parse arguments
program.parse(process.argv);

// No command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

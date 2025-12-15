#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

// Commands
const checkCommand = require('../src/commands/check');
const csxCommand = require('../src/commands/csx');
const updateCommand = require('../src/commands/update');
const syncCommand = require('../src/commands/sync');
const resetCommand = require('../src/commands/reset');
const configCommand = require('../src/commands/config');

program
  .name('workflow')
  .description('vNext Workflow Manager CLI')
  .version(pkg.version);

// Check command
program
  .command('check')
  .description('Sistem kontrolü (API, DB, klasörler)')
  .action(checkCommand);

// CSX command
program
  .command('csx')
  .description('CSX dosyalarını güncelle')
  .option('-a, --all', 'Tüm CSX dosyalarını güncelle')
  .option('-f, --file <path>', 'Belirli bir CSX dosyasını güncelle')
  .action(csxCommand);

// Update command
program
  .command('update')
  .description('Workflow\'ları güncelle')
  .option('-a, --all', 'Tüm workflow\'ları güncelle')
  .option('-f, --file <path>', 'Belirli bir workflow\'u güncelle')
  .action(updateCommand);

// Sync command
program
  .command('sync')
  .description('DB\'de eksik olanları ekle')
  .action(syncCommand);

// Reset command
program
  .command('reset')
  .description('Workflow\'ları resetle (force update)')
  .action(resetCommand);

// Config command
program
  .command('config')
  .description('Konfigürasyon yönetimi')
  .argument('<action>', 'set veya get')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Config value')
  .action(configCommand);

// Parse arguments
program.parse(process.argv);

// No command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}


#!/usr/bin/env node

const { program, Argument } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

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

// Domain command
program
  .command('domain')
  .description('Domain yönetimi (multidomain desteği)')
  .addArgument(new Argument('[action]', 'Yapılacak işlem').choices(['active', 'add', 'use', 'list', 'remove']))
  .argument('[name]', 'Domain adı')
  .option('-l, --list', 'Domainleri listele')
  .option('--API_BASE_URL <url>', 'API base URL')
  .option('--API_VERSION <version>', 'API version')
  .option('--DB_HOST <host>', 'Veritabanı host')
  .option('--DB_PORT <port>', 'Veritabanı port')
  .option('--DB_NAME <dbname>', 'Veritabanı adı')
  .option('--DB_USER <user>', 'Veritabanı kullanıcı adı')
  .option('--DB_PASSWORD <password>', 'Veritabanı şifresi')
  .option('--AUTO_DISCOVER <value>', 'Otomatik keşif (true/false)')
  .option('--USE_DOCKER <value>', 'Docker kullan (true/false)')
  .option('--DOCKER_POSTGRES_CONTAINER <container>', 'Docker PostgreSQL container adı')
  .option('--DEBUG_MODE <value>', 'Debug modu (true/false)')
  .addHelpText('after', `
Örnekler:
  wf domain active                                                   Aktif domain adını göster
  wf domain list                                                     Domainleri listele
  wf domain --list                                                   Domainleri listele
  wf domain add domain-a --API_BASE_URL http://localhost:4201 --DB_NAME myDb   Yeni domain ekle
  wf domain use domain-a                                             Aktif domain değiştir
  wf domain remove domain-a                                          Domain sil

Notlar:
  - Domain eklerken belirtilmeyen ayarlar default domain'den alınır.
  - Default domain silinemez.
  - Aktif domain silinirse otomatik olarak default'a geçilir.
`)
  .action(domainCommand);

// Parse arguments
program.parse(process.argv);

// No command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

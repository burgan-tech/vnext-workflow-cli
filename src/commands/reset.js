const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const config = require('../lib/config');
const { discoverComponents } = require('../lib/discover');
const { processWorkflow, findAllJson } = require('../lib/workflow');
const { reinitializeSystem } = require('../lib/api');

async function resetCommand(options) {
  console.log(chalk.cyan.bold('\n🔄 Workflow Reset (Force Update)\n'));
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
  // DB Config
  const dbConfig = {
    host: config.get('DB_HOST'),
    port: config.get('DB_PORT'),
    database: config.get('DB_NAME'),
    user: config.get('DB_USER'),
    password: config.get('DB_PASSWORD'),
    useDocker: config.get('USE_DOCKER'),
    dockerContainer: config.get('DOCKER_POSTGRES_CONTAINER')
  };
  
  // API Config
  const apiConfig = {
    baseUrl: config.get('API_BASE_URL'),
    version: config.get('API_VERSION')
  };
  
  // Klasörleri keşfet
  const spinner = ora('Klasörler taranıyor...').start();
  const discovered = await discoverComponents(projectRoot);
  spinner.succeed(chalk.green('Klasörler bulundu'));
  
  // Seçenekler
  const choices = [
    { name: '🔵 Workflows (sys-flows)', value: 'Workflows' },
    { name: '📋 Tasks (sys-tasks)', value: 'Tasks' },
    { name: '📊 Schemas (sys-schemas)', value: 'Schemas' },
    { name: '👁️  Views (sys-views)', value: 'Views' },
    { name: '⚙️  Functions (sys-functions)', value: 'Functions' },
    { name: '🔌 Extensions (sys-extensions)', value: 'Extensions' },
    new inquirer.Separator(),
    { name: '🔴 TÜMÜ (Tüm klasörler)', value: 'ALL' }
  ];
  
  // Kullanıcıdan seç
  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Hangi klasör resetlensin?',
    choices: choices
  }]);
  
  // Dosyaları bul
  let jsonFiles = [];
  
  if (selected === 'ALL') {
    jsonFiles = await findAllJson(discovered);
  } else {
    const dir = discovered[selected];
    if (!dir) {
      console.log(chalk.red(`\n✗ ${selected} klasörü bulunamadı\n`));
      return;
    }
    
    // Sadece bu klasördeki JSON'ları bul
    const fs = require('fs').promises;
    const path = require('path');
    const { glob } = require('glob');
    
    const pattern = path.join(dir, '**/*.json');
    jsonFiles = await glob(pattern);
  }
  
  if (jsonFiles.length === 0) {
    console.log(chalk.yellow('\n⚠ JSON dosyası bulunamadı\n'));
    return;
  }
  
  // Son onay
  console.log(chalk.yellow(`\n⚠️  ${jsonFiles.length} workflow resetlenecek (DB'den silinip tekrar eklenecek)!\n`));
  
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Devam edilsin mi?',
    default: false
  }]);
  
  if (!confirm) {
    console.log(chalk.yellow('\nİşlem iptal edildi.\n'));
    return;
  }
  
  // İşle
  let successCount = 0;
  let failCount = 0;
  
  console.log();
  for (const jsonFile of jsonFiles) {
    const fileName = require('path').basename(jsonFile);
    const spinner = ora(`İşleniyor: ${fileName}`).start();
    
    try {
      const result = await processWorkflow(jsonFile, dbConfig, apiConfig);
      
      const status = result.wasDeleted ? 'resetlendi' : 'oluşturuldu';
      spinner.succeed(chalk.green(`✓ ${fileName} → ${status}`));
      successCount++;
    } catch (error) {
      let errorMsg = error.message;
      if (error.response?.data) {
        if (typeof error.response.data === 'string') {
          errorMsg = error.response.data;
        } else if (error.response.data.error?.message) {
          errorMsg = error.response.data.error.message;
        } else if (error.response.data.message) {
          errorMsg = error.response.data.message;
        } else {
          errorMsg = JSON.stringify(error.response.data);
        }
      }
      spinner.fail(chalk.red(`✗ ${fileName} → ${errorMsg}`));
      failCount++;
    }
  }
  
  // Re-initialize
  if (successCount > 0) {
    console.log();
    const reinitSpinner = ora('Sistem yeniden başlatılıyor...').start();
    const reinitSuccess = await reinitializeSystem(apiConfig.baseUrl, apiConfig.version);
    
    if (reinitSuccess) {
      reinitSpinner.succeed(chalk.green('✓ Sistem yenilendi'));
    } else {
      reinitSpinner.warn(chalk.yellow('⚠ Sistem yenilenemedi (devam edildi)'));
    }
  }
  
  // Özet
  console.log();
  console.log(chalk.cyan('═'.repeat(50)));
  console.log(chalk.white(`Toplam: ${jsonFiles.length} dosya`));
  console.log(chalk.green(`✓ Başarılı: ${successCount}`));
  if (failCount > 0) {
    console.log(chalk.red(`✗ Başarısız: ${failCount}`));
  }
  console.log(chalk.cyan('═'.repeat(50)));
  console.log();
  
  if (successCount > 0) {
    console.log(chalk.green.bold('✓ Reset tamamlandı\n'));
  }
}

module.exports = resetCommand;


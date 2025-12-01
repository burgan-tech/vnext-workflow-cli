const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const inquirer = require('inquirer');
const config = require('../lib/config');
const { discoverComponents } = require('../lib/discover');
const { reinitializeSystem } = require('../lib/api');
const {
  processWorkflow,
  getGitChangedJson,
  findAllJson
} = require('../lib/workflow');
const {
  processCsxFile,
  getGitChangedCsx,
  findAllCsx
} = require('../lib/csx');

async function updateCommand(options) {
  console.log(chalk.cyan.bold('\n🔄 Workflow Güncelleme\n'));
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
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
    domain: config.get('API_DOMAIN')
  };
  
  // ÖNCELİKLE: Değişen CSX dosyalarını güncelle
  let csxFiles = [];
  
  if (options.all) {
    // Tüm CSX'leri bul
    const csxSpinner = ora('Tüm CSX dosyaları bulunuyor...').start();
    csxFiles = await findAllCsx(projectRoot);
    csxSpinner.succeed(chalk.green(`${csxFiles.length} CSX dosyası bulundu`));
  } else {
    // Git'te değişen CSX'leri bul
    const csxSpinner = ora('Git\'te değişen CSX dosyaları aranıyor...').start();
    csxFiles = await getGitChangedCsx(projectRoot);
    
    if (csxFiles.length > 0) {
      csxSpinner.succeed(chalk.green(`${csxFiles.length} değişen CSX dosyası bulundu`));
    } else {
      csxSpinner.info(chalk.dim('Değişen CSX dosyası yok'));
    }
  }
  
  // CSX dosyalarını güncelle
  if (csxFiles.length > 0) {
    console.log(chalk.blue('\n📝 CSX dosyaları JSON\'lara yazılıyor...\n'));
    
    let csxSuccessCount = 0;
    for (const csxFile of csxFiles) {
      const fileName = path.basename(csxFile);
      const csxSpinner = ora(`Base64 encode: ${fileName}`).start();
      
      try {
        const result = await processCsxFile(csxFile, projectRoot);
        
        if (result.success) {
          csxSpinner.succeed(chalk.green(`✓ ${fileName} → ${result.updatedCount} JSON`));
          csxSuccessCount++;
        } else {
          csxSpinner.warn(chalk.yellow(`○ ${fileName} → ${result.message}`));
        }
      } catch (error) {
        csxSpinner.fail(chalk.red(`✗ ${fileName} → ${error.message}`));
      }
    }
    
    if (csxSuccessCount > 0) {
      console.log(chalk.green(`\n✓ ${csxSuccessCount} CSX dosyası güncellendi\n`));
    }
  }
  
  let jsonFiles = [];
  
  // Hangi JSON dosyalarını işleyeceğiz?
  if (options.file) {
    // Belirli dosya
    const filePath = path.isAbsolute(options.file) 
      ? options.file 
      : path.join(projectRoot, options.file);
    jsonFiles = [filePath];
    console.log(chalk.blue(`Dosya: ${path.basename(filePath)}\n`));
  } else if (options.all) {
    // Tüm JSON dosyaları
    console.log(chalk.yellow('⚠️  TÜM workflow\'lar güncellenecek!\n'));
    
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
    
    const spinner = ora('Tüm JSON dosyaları bulunuyor...').start();
    
    if (autoDiscover) {
      const discovered = await discoverComponents(projectRoot);
      jsonFiles = await findAllJson(discovered);
    } else {
      // Fallback
      jsonFiles = [];
    }
    
    spinner.succeed(chalk.green(`${jsonFiles.length} JSON dosyası bulundu`));
  } else {
    // Git'te değişenler (default)
    const spinner = ora('Git\'te değişen JSON dosyaları aranıyor...').start();
    jsonFiles = await getGitChangedJson(projectRoot);
    
    if (jsonFiles.length === 0) {
      spinner.info(chalk.yellow('Git\'te değişen JSON dosyası bulunamadı'));
      console.log(chalk.green('\n✓ Tüm workflow\'lar güncel\n'));
      return;
    }
    
    spinner.succeed(chalk.green(`${jsonFiles.length} değişen JSON dosyası bulundu`));
  }
  
  // Her JSON dosyasını işle
  let successCount = 0;
  let failCount = 0;
  
  console.log();
  for (const jsonFile of jsonFiles) {
    const fileName = path.basename(jsonFile);
    const spinner = ora(`İşleniyor: ${fileName}`).start();
    
    try {
      const result = await processWorkflow(jsonFile, dbConfig, apiConfig);
      
      const status = result.wasDeleted ? 'güncellendi' : 'oluşturuldu';
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
    console.log(chalk.green.bold('✓ Workflow güncelleme tamamlandı\n'));
  }
}

module.exports = updateCommand;

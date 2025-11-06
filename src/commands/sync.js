const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const config = require('../lib/config');
const { discoverComponents } = require('../lib/discover');
const { getInstanceId } = require('../lib/db');
const { postWorkflow, activateWorkflow, reinitializeSystem } = require('../lib/api');
const {
  getJsonMetadata,
  detectFlowFromPath,
  findAllJson
} = require('../lib/workflow');
const {
  processCsxFile,
  getGitChangedCsx,
  findAllCsx
} = require('../lib/csx');

async function syncCommand() {
  console.log(chalk.cyan.bold('\n🔄 Sistem Sync - Eksik Olanları Ekle\n'));
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
  if (!autoDiscover) {
    console.log(chalk.yellow('⚠️  AUTO_DISCOVER kapalı. Açmak için:'));
    console.log(chalk.dim('   workflow config set AUTO_DISCOVER true\n'));
    return;
  }
  
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
  
  // Klasörleri bul
  const discoverSpinner = ora('Klasörler taranıyor...').start();
  const discovered = await discoverComponents(projectRoot);
  discoverSpinner.succeed(chalk.green('Klasörler bulundu'));
  
  // ÖNCELİKLE: Tüm CSX dosyalarını güncelle
  const csxSpinner = ora('Tüm CSX dosyaları bulunuyor...').start();
  const csxFiles = await findAllCsx(projectRoot);
  csxSpinner.succeed(chalk.green(`${csxFiles.length} CSX dosyası bulundu`));
  
  // CSX dosyalarını güncelle
  if (csxFiles.length > 0) {
    console.log(chalk.blue('\n📝 CSX dosyaları JSON\'lara yazılıyor...\n'));
    
    let csxSuccessCount = 0;
    for (const csxFile of csxFiles) {
      const fileName = path.basename(csxFile);
      const csxFileSpinner = ora(`Base64 encode: ${fileName}`).start();
      
      try {
        const result = await processCsxFile(csxFile, projectRoot);
        
        if (result.success) {
          csxFileSpinner.succeed(chalk.green(`✓ ${fileName} → ${result.updatedCount} JSON`));
          csxSuccessCount++;
        } else {
          csxFileSpinner.warn(chalk.yellow(`○ ${fileName} → ${result.message}`));
        }
      } catch (error) {
        csxFileSpinner.fail(chalk.red(`✗ ${fileName} → ${error.message}`));
      }
    }
    
    if (csxSuccessCount > 0) {
      console.log(chalk.green(`\n✓ ${csxSuccessCount} CSX dosyası güncellendi\n`));
    }
  }
  
  // Tüm JSON dosyalarını bul
  const findSpinner = ora('JSON dosyaları bulunuyor...').start();
  const allJsons = await findAllJson(discovered);
  findSpinner.succeed(chalk.green(`${allJsons.length} JSON dosyası bulundu`));
  
  // Her dosyayı kontrol et
  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  
  console.log();
  for (const jsonFile of allJsons) {
    const fileName = require('path').basename(jsonFile);
    const spinner = ora(`Kontrol ediliyor: ${fileName}`).start();
    
    try {
      const metadata = await getJsonMetadata(jsonFile);
      
      if (!metadata.key || !metadata.version) {
        spinner.warn(chalk.yellow(`○ ${fileName} → key/version yok`));
        skippedCount++;
        continue;
      }
      
      const flow = metadata.flow || detectFlowFromPath(jsonFile);
      
      // DB'de var mı?
      const existingId = await getInstanceId(dbConfig, flow, metadata.key, metadata.version);
      
      if (existingId) {
        spinner.info(chalk.dim(`○ ${fileName} → zaten var`));
        skippedCount++;
      } else {
        // Yok, ekle
        const postResult = await postWorkflow(
          apiConfig.baseUrl,
          apiConfig.version,
          flow,
          metadata.data
        );
        
        const newId = postResult.id || postResult.Id;
        
        // Aktif et
        await activateWorkflow(
          apiConfig.baseUrl,
          apiConfig.version,
          flow,
          newId,
          metadata.version
        );
        
        spinner.succeed(chalk.green(`✓ ${fileName} → eklendi`));
        addedCount++;
      }
    } catch (error) {
      let errorMsg = error.message;
      if (error.response?.data) {
        if (typeof error.response.data === 'string') {
          errorMsg = error.response.data;
        } else if (error.response.data.message) {
          errorMsg = error.response.data.message;
        } else {
          errorMsg = JSON.stringify(error.response.data);
        }
      }
      spinner.fail(chalk.red(`✗ ${fileName} → ${errorMsg}`));
      failedCount++;
    }
  }
  
  // Re-initialize
  if (addedCount > 0) {
    console.log();
    const reinitSpinner = ora('Sistem yeniden başlatılıyor...').start();
    const reinitSuccess = await reinitializeSystem(apiConfig.baseUrl, apiConfig.version);
    
    if (reinitSuccess) {
      reinitSpinner.succeed(chalk.green('✓ Sistem yenilendi'));
    } else {
      reinitSpinner.warn(chalk.yellow('⚠ Sistem yenilenemedi'));
    }
  }
  
  // Özet
  console.log();
  console.log(chalk.cyan('═'.repeat(50)));
  console.log(chalk.white(`Toplam: ${allJsons.length} dosya`));
  console.log(chalk.green(`✓ Eklendi: ${addedCount}`));
  console.log(chalk.dim(`○ Zaten var: ${skippedCount}`));
  if (failedCount > 0) {
    console.log(chalk.red(`✗ Başarısız: ${failedCount}`));
  }
  console.log(chalk.cyan('═'.repeat(50)));
  console.log();
  
  if (addedCount === 0 && failedCount === 0) {
    console.log(chalk.green.bold('✓ Sistem güncel - Tüm kayıtlar mevcut\n'));
  } else if (addedCount > 0) {
    console.log(chalk.green.bold('✓ Sync tamamlandı\n'));
  }
}

module.exports = syncCommand;

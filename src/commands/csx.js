const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const config = require('../lib/config');
const {
  processCsxFile,
  getGitChangedCsx,
  findAllCsx
} = require('../lib/csx');

async function csxCommand(options) {
  console.log(chalk.cyan.bold('\n🔄 CSX Güncelleme\n'));
  
  const projectRoot = config.get('PROJECT_ROOT');
  let csxFiles = [];
  
  // Hangi CSX dosyalarını işleyeceğiz?
  if (options.file) {
    // Belirli dosya
    const filePath = path.isAbsolute(options.file) 
      ? options.file 
      : path.join(projectRoot, options.file);
    csxFiles = [filePath];
    console.log(chalk.blue(`Dosya: ${path.basename(filePath)}\n`));
  } else if (options.all) {
    // Tüm CSX dosyaları
    const spinner = ora('Tüm CSX dosyaları bulunuyor...').start();
    csxFiles = await findAllCsx(projectRoot);
    spinner.succeed(chalk.green(`${csxFiles.length} CSX dosyası bulundu`));
  } else {
    // Git'te değişenler (default)
    const spinner = ora('Git\'te değişen CSX dosyaları aranıyor...').start();
    csxFiles = await getGitChangedCsx(projectRoot);
    
    if (csxFiles.length === 0) {
      spinner.info(chalk.yellow('Git\'te değişen CSX dosyası bulunamadı'));
      console.log(chalk.green('\n✓ Tüm CSX dosyaları güncel\n'));
      return;
    }
    
    spinner.succeed(chalk.green(`${csxFiles.length} değişen CSX dosyası bulundu`));
  }
  
  // Her CSX dosyasını işle
  let successCount = 0;
  let failCount = 0;
  
  console.log();
  for (const csxFile of csxFiles) {
    const fileName = path.basename(csxFile);
    const spinner = ora(`İşleniyor: ${fileName}`).start();
    
    try {
      const result = await processCsxFile(csxFile, projectRoot);
      
      if (result.success) {
        spinner.succeed(chalk.green(`✓ ${fileName} → ${result.updatedCount} JSON güncellendi`));
        successCount++;
      } else {
        spinner.fail(chalk.red(`✗ ${fileName} → ${result.message}`));
        failCount++;
      }
    } catch (error) {
      spinner.fail(chalk.red(`✗ ${fileName} → Hata: ${error.message}`));
      failCount++;
    }
  }
  
  // Özet
  console.log();
  console.log(chalk.cyan('─'.repeat(50)));
  console.log(chalk.white(`Toplam: ${csxFiles.length} dosya`));
  console.log(chalk.green(`✓ Başarılı: ${successCount}`));
  if (failCount > 0) {
    console.log(chalk.red(`✗ Başarısız: ${failCount}`));
  }
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();
  
  if (successCount > 0) {
    console.log(chalk.green.bold('✓ CSX güncelleme tamamlandı\n'));
  }
}

module.exports = csxCommand;

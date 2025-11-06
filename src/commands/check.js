const chalk = require('chalk');
const ora = require('ora');
const config = require('../lib/config');
const { discoverComponents, listDiscovered } = require('../lib/discover');
const { testApiConnection } = require('../lib/api');
const { testDbConnection } = require('../lib/db');

async function checkCommand() {
  console.log(chalk.cyan.bold('\n🔄 Workflow Yönetim Sistemi - Sistem Kontrolü\n'));
  
  const projectRoot = config.get('PROJECT_ROOT');
  const autoDiscover = config.get('AUTO_DISCOVER');
  
  // API kontrolü
  let apiSpinner = ora('API kontrolü...').start();
  try {
    const apiUrl = config.get('API_BASE_URL');
    const isApiOk = await testApiConnection(apiUrl);
    if (isApiOk) {
      apiSpinner.succeed(chalk.green('API: ✓ Erişilebilir'));
    } else {
      apiSpinner.fail(chalk.red('API: ✗ Erişilemiyor'));
    }
  } catch (error) {
    apiSpinner.fail(chalk.red(`API: ✗ Hata - ${error.message}`));
  }
  
  // DB kontrolü
  let dbSpinner = ora('Veritabanı kontrolü...').start();
  try {
    const isDbOk = await testDbConnection({
      host: config.get('DB_HOST'),
      port: config.get('DB_PORT'),
      database: config.get('DB_NAME'),
      user: config.get('DB_USER'),
      password: config.get('DB_PASSWORD'),
      useDocker: config.get('USE_DOCKER'),
      dockerContainer: config.get('DOCKER_POSTGRES_CONTAINER')
    });
    if (isDbOk) {
      dbSpinner.succeed(chalk.green('DB: ✓ Bağlı'));
    } else {
      dbSpinner.fail(chalk.red('DB: ✗ Bağlanamıyor'));
    }
  } catch (error) {
    dbSpinner.fail(chalk.red(`DB: ✗ Hata - ${error.message}`));
  }
  
  // Klasör tarama
  if (autoDiscover) {
    console.log(chalk.cyan('\n📁 Bulunan Klasörler:\n'));
    let discoverSpinner = ora('Klasörler taranıyor...').start();
    try {
      const discovered = await discoverComponents(projectRoot);
      discoverSpinner.stop();
      
      const list = listDiscovered(discovered);
      for (const item of list) {
        if (item.found) {
          console.log(chalk.green(`  ✓ ${item.name}`));
        } else {
          console.log(chalk.yellow(`  ○ ${item.name} ${chalk.dim('(bulunamadı)')}`));
        }
      }
    } catch (error) {
      discoverSpinner.fail(chalk.red(`Klasör tarama hatası: ${error.message}`));
    }
  }
  
  console.log(chalk.green.bold('\n✓ Kontrol tamamlandı\n'));
}

module.exports = checkCommand;


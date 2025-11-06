const chalk = require('chalk');
const config = require('../lib/config');

async function configCommand(action, key, value) {
  if (action === 'get') {
    if (key) {
      const val = config.get(key);
      console.log(chalk.cyan(`${key}:`), val);
    } else {
      // Tüm config'i göster
      console.log(chalk.cyan.bold('\n📝 Mevcut Konfigürasyon:\n'));
      const all = config.getAll();
      for (const [k, v] of Object.entries(all)) {
        console.log(chalk.cyan(`${k}:`), chalk.white(v));
      }
      console.log(chalk.dim(`\nKonfig dosyası: ${config.path}\n`));
    }
  } else if (action === 'set') {
    if (!key || value === undefined) {
      console.log(chalk.red('Kullanım: workflow config set <key> <value>'));
      return;
    }
    config.set(key, value);
    console.log(chalk.green(`✓ ${key} = ${value}`));
  } else {
    console.log(chalk.red('Geçersiz action. Kullanın: get veya set'));
  }
}

module.exports = configCommand;


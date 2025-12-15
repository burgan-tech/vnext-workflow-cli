const chalk = require('chalk');
const config = require('../lib/config');

async function configCommand(action, key, value) {
  if (action === 'get') {
    if (key) {
      const val = config.get(key);
      console.log(chalk.cyan(`${key}:`), val);
    } else {
      // Show all config
      console.log(chalk.cyan.bold('\n📝 Current Configuration:\n'));
      const all = config.getAll();
      for (const [k, v] of Object.entries(all)) {
        console.log(chalk.cyan(`${k}:`), chalk.white(v));
      }
      console.log(chalk.dim(`\nConfig file: ${config.path}\n`));
    }
  } else if (action === 'set') {
    if (!key || value === undefined) {
      console.log(chalk.red('Usage: workflow config set <key> <value>'));
      return;
    }
    config.set(key, value);
    console.log(chalk.green(`✓ ${key} = ${value}`));
  } else {
    console.log(chalk.red('Invalid action. Use: get or set'));
  }
}

module.exports = configCommand;

const chalk = require('chalk');
const config = require('./config');

const LOG = {
  separator: () => console.log(chalk.cyan('═'.repeat(60))),
  subSeparator: () => console.log(chalk.cyan('─'.repeat(60))),
  header: (text) => {
    console.log();
    LOG.separator();
    console.log(chalk.cyan.bold(`  ${text}`));
    LOG.separator();
  },
  success: (text) => console.log(chalk.green(`  ✓ ${text}`)),
  error: (text) => console.log(chalk.red(`  ✗ ${text}`)),
  warning: (text) => console.log(chalk.yellow(`  ⚠ ${text}`)),
  info: (text) => console.log(chalk.dim(`  ○ ${text}`)),
  component: (type, name, status, detail = '') => {
    const typeLabel = chalk.cyan(`[${type}]`);
    const nameLabel = chalk.white(name);
    if (status === 'success') {
      console.log(`  ${typeLabel} ${chalk.green('✓')} ${nameLabel} ${chalk.dim(detail)}`);
    } else if (status === 'error') {
      console.log(`  ${typeLabel} ${chalk.red('✗')} ${nameLabel}`);
      if (detail) console.log(chalk.red(`    └─ ${detail}`));
    } else if (status === 'skip') {
      console.log(`  ${typeLabel} ${chalk.dim('○')} ${nameLabel} ${chalk.dim(detail)}`);
    }
  }
};

/**
 * Prints a structured, colored error block for a failed publish result.
 * Handles both RFC 7807 (apiError) and plain error strings.
 */
function printApiError(result, componentType, fileName) {
  const typeLabel = chalk.cyan(`[${componentType}]`);
  console.log(`  ${typeLabel} ${chalk.red('✗')} ${chalk.white(fileName)}`);

  const api = result.apiError;
  if (api) {
    const statusLine = result.statusCode
      ? `HTTP ${result.statusCode} ${api.title || ''}`
      : api.title || 'Error';
    console.log(chalk.red(`    ├─ ${chalk.red.bold(statusLine.trim())}`));

    if (api.detail) {
      console.log(chalk.red(`    ├─ Detail: ${api.detail}`));
    }
    if (api.errorCode) {
      console.log(chalk.red(`    ├─ Code: ${chalk.yellow(api.errorCode)}`));
    }

    if (api.errors && typeof api.errors === 'object' && Object.keys(api.errors).length > 0) {
      console.log(chalk.red('    ├─ Errors:'));
      const fields = Object.entries(api.errors);
      for (const [fieldPath, messages] of fields) {
        console.log(chalk.yellow(`    │   ${fieldPath}`));
        const msgs = Array.isArray(messages) ? messages : [messages];
        for (const msg of msgs) {
          console.log(chalk.white(`    │     - ${msg}`));
        }
      }
    }

    if (api.traceId) {
      console.log(chalk.dim(`    └─ TraceId: ${api.traceId}`));
    } else {
      // close the tree
      console.log(chalk.red('    └─'));
    }
  } else {
    if (result.statusCode) {
      console.log(chalk.red(`    ├─ ${chalk.red.bold(`HTTP ${result.statusCode}`)}`));
    }
    if (result.error) {
      console.log(chalk.red(`    └─ ${result.error}`));
    }
  }
}

/**
 * Prints a two-layer summary table for batch operation errors.
 * Each row shows component/file/HTTP/errorCode/detail, and if validation
 * errors exist they are expanded below the row.
 */
function printErrorSummaryTable(errors) {
  if (!errors || errors.length === 0) return;

  const COL = { idx: 3, type: 16, file: 26, http: 5, code: 16, detail: 36 };
  const totalWidth = COL.idx + COL.type + COL.file + COL.http + COL.code + COL.detail + 15;

  const pad = (str, len) => String(str || '').padEnd(len);
  const divider = () => console.log(chalk.dim(`  ${'─'.repeat(totalWidth)}`));

  console.log(chalk.red.bold(`\n  ERRORS (${errors.length})\n`));

  // Header
  console.log(
    chalk.dim('  ') +
    chalk.white.bold(pad('#', COL.idx)) + chalk.dim(' │ ') +
    chalk.white.bold(pad('Component', COL.type)) + chalk.dim(' │ ') +
    chalk.white.bold(pad('File', COL.file)) + chalk.dim(' │ ') +
    chalk.white.bold(pad('HTTP', COL.http)) + chalk.dim(' │ ') +
    chalk.white.bold(pad('Error Code', COL.code)) + chalk.dim(' │ ') +
    chalk.white.bold('Detail')
  );
  divider();

  for (let i = 0; i < errors.length; i++) {
    const err = errors[i];
    const api = err.apiError;
    const statusCode = err.statusCode || '';
    const errorCode = api?.errorCode || '';
    const detail = (api?.detail || err.error || '').substring(0, COL.detail);

    console.log(
      chalk.dim('  ') +
      chalk.dim(pad(i + 1, COL.idx)) + chalk.dim(' │ ') +
      chalk.cyan(pad(err.type, COL.type)) + chalk.dim(' │ ') +
      chalk.white(pad(err.file, COL.file)) + chalk.dim(' │ ') +
      chalk.red.bold(pad(statusCode, COL.http)) + chalk.dim(' │ ') +
      chalk.yellow(pad(errorCode, COL.code)) + chalk.dim(' │ ') +
      chalk.red(detail)
    );

    // Expand validation errors below the row
    if (api?.errors && typeof api.errors === 'object') {
      const fields = Object.entries(api.errors);
      if (fields.length > 0) {
        console.log(
          chalk.dim('  ') +
          pad('', COL.idx) + chalk.dim(' │ ') +
          chalk.white.bold('  Validation Errors:')
        );
        for (const [fieldPath, messages] of fields) {
          console.log(
            chalk.dim('  ') +
            pad('', COL.idx) + chalk.dim(' │ ') +
            chalk.yellow(`    ${fieldPath}`)
          );
          const msgs = Array.isArray(messages) ? messages : [messages];
          for (const msg of msgs) {
            console.log(
              chalk.dim('  ') +
              pad('', COL.idx) + chalk.dim(' │ ') +
              chalk.white(`      - ${msg}`)
            );
          }
        }
      }
    }

    divider();
  }
}

/**
 * Prints a boxed banner showing the active domain and API URL.
 * Called from the preAction hook before every command.
 */
function printActiveDomainBanner() {
  const domain = config.get('ACTIVE_DOMAIN') || 'default';
  const apiUrl = config.get('API_BASE_URL') || '-';

  const domainLine = `Domain: ${domain}`;
  const apiLine = `API:    ${apiUrl}`;
  const innerWidth = Math.max(domainLine.length, apiLine.length) + 4;

  console.log();
  console.log(chalk.cyan(`  ┌${'─'.repeat(innerWidth)}┐`));
  console.log(chalk.cyan('  │') + `  ${chalk.white.bold(domainLine)}${' '.repeat(innerWidth - domainLine.length - 2)}` + chalk.cyan('│'));
  console.log(chalk.cyan('  │') + `  ${chalk.dim(apiLine)}${' '.repeat(innerWidth - apiLine.length - 2)}` + chalk.cyan('│'));
  console.log(chalk.cyan(`  └${'─'.repeat(innerWidth)}┘`));
}

module.exports = {
  LOG,
  printApiError,
  printErrorSummaryTable,
  printActiveDomainBanner
};

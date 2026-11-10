const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const config = require('../lib/config');
const { buildAgentDryRunRequest, dryRunAgent } = require('../lib/api');
const { LOG, printApiError, printAgentDryRunResult } = require('../lib/ui');

/**
 * Reads and parses a JSON file given on the command line.
 * @param {string} file - Path, relative to cwd or absolute
 * @param {string} option - Option name for error messages
 * @returns {any} Parsed JSON
 */
function readJsonOption(file, option) {
  const filePath = path.resolve(file);
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${option}: cannot read ${filePath} (${error.code || error.message})`);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${option}: ${filePath} is not valid JSON (${error.message})`);
  }
}

/**
 * Turns the command-line options into the dry-run request input. Pure apart
 * from reading the files the options name.
 * @param {string} key - Agent key
 * @param {Object} options - Commander options
 * @param {Object} profile - CLI domain profile (API settings)
 * @param {string} domain - Domain the agent lives in
 * @returns {Object} Input for buildAgentDryRunRequest
 */
function buildDryRunInput(key, options, profile, domain) {
  if (options.prompt !== undefined && options.promptFile) {
    throw new Error('use either --prompt or --prompt-file, not both');
  }

  const data = readJsonOption(options.data, '--data');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('--data must hold a JSON object (the sample instance data)');
  }

  let candidates;
  if (options.candidates) {
    candidates = readJsonOption(options.candidates, '--candidates');
    if (!Array.isArray(candidates)) {
      throw new Error('--candidates must hold a JSON array of { key, when, whenSource }');
    }
  }

  const prompt = options.promptFile
    ? fs.readFileSync(path.resolve(options.promptFile), 'utf8')
    : options.prompt;

  return {
    baseUrl: profile.API_BASE_URL,
    apiVersion: profile.API_VERSION,
    domain,
    key,
    agentVersion: options.agentVersion,
    prompt,
    data,
    candidates,
    role: options.role
  };
}

/**
 * `wf agent dry-run <key>`: runs an agent once on the runtime against sample
 * data, without an instance. Uses the --domain profile, else the active one.
 */
async function agentDryRunCommand(key, options) {
  const domain = options.domain || config.get('ACTIVE_DOMAIN');
  const profile = config.getDomainConfig(domain);

  LOG.header(`AGENT DRY-RUN - ${key}`);

  if (!profile) {
    LOG.error(`No CLI domain profile for "${domain}"`);
    console.log(chalk.dim(`    Run: wf domain add ${domain} --API_BASE_URL <url>\n`));
    process.exitCode = 1;
    return;
  }

  let request;
  try {
    request = buildAgentDryRunRequest(buildDryRunInput(key, options, profile, domain));
  } catch (error) {
    LOG.error(error.message);
    console.log();
    process.exitCode = 1;
    return;
  }

  console.log(chalk.dim(`  Domain: ${domain}  ·  POST ${request.url}${options.role ? `  ·  role: ${options.role}` : ''}`));

  const spinner = ora('Running agent...').start();
  const result = await dryRunAgent(request);

  if (!result.success) {
    spinner.stop();
    console.log();
    printApiError(result, 'agent', key);
    if (result.statusCode === 403) {
      const hint = options.role
        ? `role "${options.role}" is not in the runtime's AiAgent:DryRun:Roles (an empty list disables dry-runs)`
        : 'the runtime allows dry-runs only for the roles in AiAgent:DryRun:Roles; pass one with --role <role>';
      console.log(chalk.dim(`\n  Hint: ${hint}.`));
    }
    console.log();
    process.exitCode = 1;
    return;
  }

  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  printAgentDryRunResult(result.data);
  console.log();
}

module.exports = {
  agentDryRunCommand,
  buildDryRunInput
};

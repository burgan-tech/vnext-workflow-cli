const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const config = require('./config');
const {
  DEFAULT_SOLUTION_FILE,
  SOLUTION_FILE_PATTERN,
  loadVnextConfig,
  getDomainFromConfig,
  getComponentsRootFromConfig,
  getComponentTypesFromConfig
} = require('./vnextConfig');
const { LOG, printSolutionBanner, printErrorSummaryTable } = require('./ui');

/**
 * A "solution" is one solution file (vnext.config.json or
 * vnext.{domain}.config.json) in the workspace root, resolved into everything
 * a command needs to operate on that domain:
 *
 * {
 *   domain,          // authoritative: the `domain` field inside the file
 *   fileName,        // e.g. 'vnext.partner.config.json'
 *   configPath,      // absolute path of the solution file
 *   fileNameDomain,  // domain part of the file name, or null for the default file
 *   projectRoot,     // workspace root (process.cwd())
 *   config,          // full parsed solution file
 *   componentsRoot,  // absolute path of paths.componentsRoot
 *   componentTypes,  // { workflows: 'Workflows', tasks: 'Tasks', ... }
 *   profile,         // CLI domain profile (API/DB settings) or null if none exists
 *   warnings         // non-fatal notes, printed under the banner
 * }
 */

/**
 * Lists the solution file names in a workspace root. The default file (if
 * present) always comes first, the rest alphabetically.
 * @param {string} projectRoot - Workspace root
 * @returns {string[]} Solution file names
 */
function discoverSolutionFiles(projectRoot) {
  let entries;
  try {
    entries = fs.readdirSync(projectRoot);
  } catch (error) {
    return [];
  }

  const files = [];
  if (entries.includes(DEFAULT_SOLUTION_FILE)) {
    files.push(DEFAULT_SOLUTION_FILE);
  }

  const extra = entries
    .filter(name => name !== DEFAULT_SOLUTION_FILE)
    .filter(name => SOLUTION_FILE_PATTERN.test(name))
    .filter(name => !name.includes('.diagram.'))
    .sort();

  return files.concat(extra);
}

/**
 * Loads a single solution file into a solution object (without profile).
 * @param {string} projectRoot - Workspace root
 * @param {string} fileName - Solution file name
 * @returns {Object} Solution object
 */
function loadSolution(projectRoot, fileName) {
  const parsed = loadVnextConfig(projectRoot, fileName);
  const domain = getDomainFromConfig(parsed, fileName);
  const componentsRoot = getComponentsRootFromConfig(projectRoot, parsed, fileName);
  const componentTypes = getComponentTypesFromConfig(parsed, fileName);

  const match = fileName.match(SOLUTION_FILE_PATTERN);
  const fileNameDomain = match ? match[1] : null;

  const warnings = [];
  if (fileNameDomain && fileNameDomain !== domain) {
    warnings.push(`${fileName}: file name says "${fileNameDomain}" but the domain field is "${domain}" — using "${domain}"`);
  }

  return {
    domain,
    fileName,
    configPath: path.join(projectRoot, fileName),
    fileNameDomain,
    projectRoot,
    config: parsed,
    componentsRoot: path.resolve(componentsRoot),
    componentTypes,
    profile: null,
    warnings
  };
}

/**
 * Loads every solution file in the workspace and attaches CLI profiles.
 * @param {string} projectRoot - Workspace root
 * @param {Object} [opts]
 * @param {string} [opts.domain] - Only keep the solution with this domain
 * @returns {Object} { solutions, allSolutions, loadErrors, requestedDomain, projectRoot }
 *   - solutions:    filtered by opts.domain (all if not given)
 *   - allSolutions: every successfully loaded solution (unfiltered)
 *   - loadErrors:   [{ fileName, error }] for files that could not be used
 * @throws {Error} when the workspace has no solution file at all
 */
function loadSolutions(projectRoot, { domain } = {}) {
  const files = discoverSolutionFiles(projectRoot);
  if (files.length === 0) {
    throw new Error(`${DEFAULT_SOLUTION_FILE} not found: ${path.join(projectRoot, DEFAULT_SOLUTION_FILE)}`);
  }

  const loadErrors = [];
  let all = [];
  for (const fileName of files) {
    try {
      all.push(loadSolution(projectRoot, fileName));
    } catch (error) {
      loadErrors.push({ fileName, error: error.message });
    }
  }

  // Two files declaring the same domain is ambiguous — drop both.
  const byDomain = {};
  for (const s of all) {
    (byDomain[s.domain] = byDomain[s.domain] || []).push(s);
  }
  const duplicated = Object.keys(byDomain).filter(d => byDomain[d].length > 1);
  for (const d of duplicated) {
    for (const s of byDomain[d]) {
      const others = byDomain[d].filter(o => o !== s).map(o => o.fileName).join(', ');
      loadErrors.push({ fileName: s.fileName, error: `duplicate domain "${d}" (also declared in ${others}) — skipped` });
    }
  }
  all = all.filter(s => !duplicated.includes(s.domain));

  for (const s of all) {
    s.profile = config.getDomainConfig(s.domain);
  }

  const solutions = domain ? all.filter(s => s.domain === domain) : all;

  return {
    solutions,
    allSolutions: all,
    loadErrors,
    requestedDomain: domain || null,
    projectRoot
  };
}

/**
 * Finds the solution whose componentsRoot contains the given path.
 * With nested roots the deepest (longest) componentsRoot wins.
 * @param {Object[]} solutions - Candidate solutions
 * @param {string} filePath - Absolute or cwd-relative path
 * @returns {Object|null} Owning solution, or null
 */
function findSolutionForPath(solutions, filePath) {
  const abs = path.normalize(path.resolve(filePath));
  let best = null;

  for (const s of solutions) {
    const root = path.normalize(s.componentsRoot);
    if (abs === root || abs.startsWith(root + path.sep)) {
      if (!best || root.length > path.normalize(best.componentsRoot).length) {
        best = s;
      }
    }
  }

  return best;
}

/**
 * Loads the workspace for a command, printing errors and setting the exit
 * code on fatal problems. Non-fatal load errors (one broken file among
 * several) are printed and the rest continues.
 * @param {Object} options - Command options (uses options.domain)
 * @returns {Object|null} loadSolutions() result, or null when nothing can run
 */
function loadWorkspace(options = {}) {
  const projectRoot = config.get('PROJECT_ROOT');

  let loaded;
  try {
    loaded = loadSolutions(projectRoot, { domain: options.domain });
  } catch (error) {
    LOG.error(`Failed to read ${DEFAULT_SOLUTION_FILE}: ${error.message}`);
    process.exitCode = 1;
    return null;
  }

  for (const e of loaded.loadErrors) {
    LOG.error(`${e.fileName}: ${e.error}`);
  }

  if (loaded.solutions.length === 0) {
    if (loaded.requestedDomain) {
      const available = loaded.allSolutions.map(s => s.domain);
      const hint = available.length > 0 ? ` Available: ${available.join(', ')}` : '';
      LOG.error(`Domain "${loaded.requestedDomain}" not found in this workspace.${hint}`);
    } else {
      LOG.error('No usable solution file found in this workspace.');
    }
    process.exitCode = 1;
    return null;
  }

  return loaded;
}

/**
 * Narrows the solutions to the one owning `filePath` (for --file modes).
 * @returns {Object[]|null} One-element array, or null after printing an error
 */
function resolveSolutionsForFile(loaded, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(loaded.projectRoot, filePath);
  const owner = findSolutionForPath(loaded.allSolutions, abs);

  if (owner) {
    if (!loaded.solutions.includes(owner)) {
      LOG.error(`"${filePath}" belongs to domain "${owner.domain}" (${owner.fileName}), not "${loaded.requestedDomain}".`);
      process.exitCode = 1;
      return null;
    }
    return [owner];
  }

  if (loaded.solutions.length === 1) {
    const only = loaded.solutions[0];
    LOG.warning(`"${filePath}" is outside the components root of "${only.domain}" — processing with that domain anyway.`);
    return [only];
  }

  LOG.error(`Cannot tell which domain owns "${filePath}": it is outside every solution's components root. Use --domain <name>.`);
  process.exitCode = 1;
  return null;
}

/**
 * Prints the cross-domain summary shown after a multi-solution run.
 */
function printWorkspaceSummary(outcomes) {
  LOG.header('WORKSPACE SUMMARY');
  console.log();

  const width = Math.max(...outcomes.map(o => o.solution.domain.length), 8);
  for (const o of outcomes) {
    const name = chalk.cyan(o.solution.domain.padEnd(width));
    if (o.status === 'skipped') {
      console.log(`  ${name} : ${chalk.yellow(`skipped (${o.reason})`)}`);
    } else if (o.status === 'failed') {
      console.log(`  ${name} : ${chalk.red(`failed (${o.reason})`)}`);
    } else if (o.hasCounts) {
      const ok = o.success > 0 ? chalk.green(`${o.success} ok`) : chalk.dim('0 ok');
      const failed = o.failed > 0 ? chalk.red(`, ${o.failed} failed`) : '';
      console.log(`  ${name} : ${ok}${failed}`);
    } else {
      console.log(`  ${name} : ${chalk.green('done')}`);
    }
  }

  const allErrors = outcomes.flatMap(o => o.errors || []);
  if (allErrors.length > 0) {
    console.log();
    LOG.subSeparator();
    printErrorSummaryTable(allErrors);
  }

  console.log();
}

/**
 * Runs `fn(solution)` for every solution in the workspace, sequentially, with
 * a banner per solution. This is the shared loop behind check/csx/sync/update/reset.
 *
 * @param {Object} options - Command options (uses options.domain)
 * @param {Object} [runOpts]
 * @param {boolean} [runOpts.requireProfile=true] - Skip solutions without a CLI profile
 * @param {string}  [runOpts.forFile] - A --file argument; narrows to the owning solution
 * @param {Object}  [runOpts.loaded] - A pre-loaded loadWorkspace() result (e.g. after a prompt)
 * @param {Function} fn - async (solution) => { success, failed, errors } | void
 * @returns {Promise<Object[]|null>} Per-solution outcomes, or null on a fatal error
 */
async function runForEachSolution(options, runOpts, fn) {
  const { requireProfile = true, forFile = null, loaded: preloaded = null } = runOpts || {};

  const loaded = preloaded || loadWorkspace(options);
  if (!loaded) return null;

  let solutions = loaded.solutions;
  if (forFile) {
    solutions = resolveSolutionsForFile(loaded, forFile);
    if (!solutions) return null;
  }

  const outcomes = [];

  for (const solution of solutions) {
    printSolutionBanner(solution);
    for (const w of solution.warnings) {
      LOG.warning(w);
    }

    if (requireProfile && !solution.profile) {
      LOG.warning(`No CLI domain profile for "${solution.domain}" — skipped.`);
      console.log(chalk.dim(`    Run: wf domain add ${solution.domain} --API_BASE_URL <url> --DB_NAME <db>`));
      console.log();
      outcomes.push({ solution, status: 'skipped', reason: 'no CLI profile', errors: [] });
      continue;
    }

    try {
      const result = await fn(solution);
      const hasCounts = !!result && (result.success !== undefined || result.failed !== undefined);
      const errors = ((result && result.errors) || []).map(e => ({ ...e, domain: solution.domain }));
      outcomes.push({
        solution,
        status: 'done',
        hasCounts,
        success: (result && result.success) || 0,
        failed: (result && result.failed) || 0,
        errors
      });
    } catch (error) {
      LOG.error(`[${solution.domain}] ${error.message}`);
      outcomes.push({ solution, status: 'failed', reason: error.message, errors: [] });
      process.exitCode = 1;
    }
  }

  if (solutions.length > 1) {
    printWorkspaceSummary(outcomes);
  }

  return outcomes;
}

module.exports = {
  discoverSolutionFiles,
  loadSolution,
  loadSolutions,
  findSolutionForPath,
  loadWorkspace,
  runForEachSolution
};

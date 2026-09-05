const { glob } = require('glob');
const path = require('path');
const fs = require('fs');

/**
 * Glob ignore rules for component JSON files. Shared by every place that
 * scans a component folder so the rules cannot drift apart.
 */
const JSON_IGNORE_PATTERNS = [
  '**/.meta/**',
  '**/.meta',
  '**/*.diagram.json',
  '**/package*.json',
  '**/*config*.json'
];

/**
 * Glob ignore rules for CSX files.
 */
const CSX_IGNORE_PATTERNS = [
  '**/.meta/**',
  '**/.meta',
  '**/node_modules/**',
  '**/dist/**'
];

/**
 * Builds a glob pattern with forward slashes.
 * glob treats backslashes as escape characters, so on Windows a pattern built
 * with path.join (which uses "\") breaks "**" recursion and nested files are
 * never matched. Always feed glob forward-slash separators.
 * @param {string} dir - Base directory
 * @param {string} suffix - Glob suffix, e.g. "**\/*.json"
 * @returns {string} Forward-slash glob pattern
 */
function toGlobPattern(dir, suffix) {
  return path.join(dir, suffix).split(path.sep).join('/');
}

/**
 * Discovers component folders of one solution based on its paths.
 * Only scans folders defined in paths, ignores everything else.
 * @param {Object} solution - Solution object (see lib/solutions.js)
 * @returns {Object} Discovered component folders { type: absoluteDir }
 */
async function discoverComponents(solution) {
  const { componentsRoot, componentTypes } = solution;

  const discovered = {};

  // Only look for folders defined in paths
  for (const [type, folderName] of Object.entries(componentTypes)) {
    const componentDir = path.join(componentsRoot, folderName);

    if (fs.existsSync(componentDir) && fs.statSync(componentDir).isDirectory()) {
      discovered[type] = componentDir;
    }
  }

  return discovered;
}

/**
 * Finds all JSON files in a specific component folder
 * Scans subfolders recursively
 * Ignores .meta folders and *.diagram.json files
 * @param {string} componentDir - Component folder
 * @returns {Promise<string[]>} JSON file paths
 */
async function findJsonInComponent(componentDir) {
  const pattern = toGlobPattern(componentDir, '**/*.json');

  const files = await glob(pattern, {
    ignore: JSON_IGNORE_PATTERNS
  });

  return files;
}

/**
 * Finds all JSON files in discovered components ONLY
 * Does NOT scan folders outside of paths definition
 * @param {Object} discovered - Discovered component folders
 * @returns {Promise<Object[]>} JSON file info (path, type, fileName)
 */
async function findAllJsonFiles(discovered) {
  const allFiles = [];

  // Only scan folders that were discovered from paths
  for (const [type, componentDir] of Object.entries(discovered)) {
    if (componentDir) {
      const files = await findJsonInComponent(componentDir);

      for (const file of files) {
        allFiles.push({
          path: file,
          type: type,
          fileName: path.basename(file)
        });
      }
    }
  }

  return allFiles;
}

/**
 * Finds all CSX files in discovered components ONLY
 * Does NOT scan folders outside of paths definition
 * @param {Object} solution - Solution object
 * @returns {Promise<string[]>} CSX file paths
 */
async function findAllCsxInComponents(solution) {
  const discovered = await discoverComponents(solution);
  const allCsxFiles = [];

  // Only scan folders that were discovered from paths
  for (const [type, componentDir] of Object.entries(discovered)) {
    if (componentDir) {
      const pattern = toGlobPattern(componentDir, '**/*.csx');
      const files = await glob(pattern, {
        ignore: CSX_IGNORE_PATTERNS
      });
      allCsxFiles.push(...files);
    }
  }

  return allCsxFiles;
}

/**
 * Gets a specific component folder
 * @param {Object} discovered - Discovered component folders
 * @param {string} component - Component type
 * @returns {string|null} Folder path
 */
function getComponentDir(discovered, component) {
  return discovered[component] || null;
}

/**
 * Lists discovered folders
 * @param {Object} discovered - Discovered component folders
 * @param {Object} componentTypes - All component types from paths
 * @returns {Object[]} Folder list
 */
function listDiscovered(discovered, componentTypes) {
  const results = [];

  for (const [type, folderName] of Object.entries(componentTypes)) {
    results.push({
      name: type,
      folderName: folderName,
      path: discovered[type] || null,
      found: !!discovered[type]
    });
  }

  return results;
}

/**
 * Resolves a folder name to a list of directories to update, within ONE solution.
 *
 * Two resolution modes (in order):
 *   a) Exact path: if `name` resolves to an existing directory (absolute, or
 *      relative to projectRoot, or relative to componentsRoot) AND that
 *      directory lies under this solution's componentsRoot, that single
 *      directory is returned. A directory outside the componentsRoot belongs
 *      to another solution and is not accepted here.
 *   b) Feature name: otherwise, `name` is treated as a feature folder name and
 *      matched against every discovered component-type root. Every
 *      `<componentRoot>/<name>` that exists as a directory is collected, so a
 *      feature spread across Workflows/, Views/, Schemas/, … is gathered.
 *
 * @param {Object} solution - Solution object
 * @param {string} name - Folder name or relative/absolute path
 * @returns {Promise<string[]>} Absolute directory paths (empty if nothing matched)
 */
async function resolveFeatureFolders(solution, name) {
  const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  const root = path.normalize(solution.componentsRoot);
  const isInsideRoot = (p) => {
    const abs = path.normalize(path.resolve(p));
    return abs === root || abs.startsWith(root + path.sep);
  };

  // a) Exact-path resolution (only accepted inside this solution's componentsRoot)
  const candidates = [];
  if (path.isAbsolute(name)) {
    candidates.push(name);
  } else {
    candidates.push(path.join(solution.projectRoot, name));
    candidates.push(path.join(solution.componentsRoot, name));
  }

  for (const candidate of candidates) {
    if (isDir(candidate) && isInsideRoot(candidate)) {
      return [path.resolve(candidate)];
    }
  }

  // b) Feature-name match across discovered component roots
  const discovered = await discoverComponents(solution);
  const dirs = [];
  for (const componentDir of Object.values(discovered)) {
    const featureDir = path.join(componentDir, name);
    if (isDir(featureDir)) {
      dirs.push(path.resolve(featureDir));
    }
  }

  return dirs;
}

/**
 * Lists available feature folder names — the union of immediate subdirectory
 * names across all discovered component-type roots. Used for error messages
 * when a requested folder name does not match anything.
 *
 * @param {Object} solution - Solution object
 * @returns {Promise<string[]>} Sorted unique feature folder names
 */
async function listFeatureFolders(solution) {
  const discovered = await discoverComponents(solution);
  const names = new Set();

  for (const componentDir of Object.values(discovered)) {
    let entries = [];
    try {
      entries = fs.readdirSync(componentDir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        names.add(entry.name);
      }
    }
  }

  return Array.from(names).sort();
}

/**
 * Detects component type from file path
 * @param {string} filePath - File path
 * @param {Object} componentTypes - Component type -> folder name mapping
 * @returns {string} Component type
 */
function detectComponentTypeFromPath(filePath, componentTypes) {
  const normalizedPath = filePath.toLowerCase();

  for (const [type, folderName] of Object.entries(componentTypes)) {
    const folderPattern = `/${folderName.toLowerCase()}/`;
    if (normalizedPath.includes(folderPattern)) {
      return type;
    }
  }

  return 'unknown';
}

module.exports = {
  JSON_IGNORE_PATTERNS,
  CSX_IGNORE_PATTERNS,
  toGlobPattern,
  discoverComponents,
  findJsonInComponent,
  findAllJsonFiles,
  findAllCsxInComponents,
  getComponentDir,
  listDiscovered,
  resolveFeatureFolders,
  listFeatureFolders,
  detectComponentTypeFromPath
};

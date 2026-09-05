const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const { toGlobPattern, JSON_IGNORE_PATTERNS } = require('./discover');

/**
 * Gets key, version, flow and domain values from a component JSON file
 * @param {string} jsonPath - JSON file path
 * @returns {Promise<Object>} Metadata object
 */
async function getJsonMetadata(jsonPath) {
  const content = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(content);

  return {
    key: data.key || null,
    version: data.version || null,
    flow: data.flow || null,
    domain: data.domain || null,
    data: data
  };
}

/**
 * Checks that a component belongs to the solution it was found in.
 * A component must declare `domain` and it must equal the solution's domain;
 * otherwise it would be published with another domain's API/DB settings.
 * @param {Object} metadata - Result of getJsonMetadata
 * @param {Object} solution - Solution object (see lib/solutions.js)
 * @returns {string|null} Error message, or null when the component is fine
 */
function checkComponentDomain(metadata, solution) {
  if (!metadata.domain) {
    return `component has no "domain" field (solution domain "${solution.domain}")`;
  }
  if (metadata.domain !== solution.domain) {
    return `component domain "${metadata.domain}" does not match solution domain "${solution.domain}"`;
  }
  return null;
}

/**
 * Detects component type from file path based on the solution's paths
 * @param {string} jsonPath - JSON file path
 * @param {Object} solution - Solution object
 * @returns {string} Component type (sys-flows, sys-tasks, etc.)
 */
function detectComponentType(jsonPath, solution) {
  const pathLower = jsonPath.toLowerCase();
  const componentTypes = (solution && solution.componentTypes) || {};

  // Check each component type folder
  for (const [type, folderName] of Object.entries(componentTypes)) {
    const folderPattern = `/${folderName.toLowerCase()}/`;
    if (pathLower.includes(folderPattern)) {
      // Map to flow type
      switch (type.toLowerCase()) {
        case 'workflows': return 'sys-flows';
        case 'tasks': return 'sys-tasks';
        case 'schemas': return 'sys-schemas';
        case 'views': return 'sys-views';
        case 'functions': return 'sys-functions';
        case 'extensions': return 'sys-extensions';
        case 'mappings': return 'sys-mappings';
        default: return `sys-${type.toLowerCase()}`;
      }
    }
  }

  // Fallback: detect from path directly
  if (pathLower.includes('/workflows/')) return 'sys-flows';
  if (pathLower.includes('/tasks/')) return 'sys-tasks';
  if (pathLower.includes('/schemas/')) return 'sys-schemas';
  if (pathLower.includes('/views/')) return 'sys-views';
  if (pathLower.includes('/functions/')) return 'sys-functions';
  if (pathLower.includes('/extensions/')) return 'sys-extensions';
  if (pathLower.includes('/mappings/')) return 'sys-mappings';

  return 'sys-flows'; // default
}

/**
 * Finds changed JSON files in Git that belong to ONE solution.
 * `git status` runs from the git root (which may be above the project root);
 * results are filtered down to the solution's componentsRoot.
 * @param {Object} solution - Solution object
 * @returns {Promise<string[]>} Changed JSON file paths
 */
async function getGitChangedJson(solution) {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  const fsSync = require('fs');

  const rootPrefix = path.normalize(solution.componentsRoot) + path.sep;

  try {
    // Find git root
    const { stdout: gitRoot } = await execPromise('git rev-parse --show-toplevel', { cwd: solution.projectRoot });
    const gitRootDir = gitRoot.trim();

    // Run git status from git root
    const { stdout } = await execPromise('git status --porcelain', { cwd: gitRootDir });
    const lines = stdout.split('\n').filter(Boolean);

    const jsonFiles = lines
      .filter(line => line.includes('.json'))
      .map(line => {
        // Git status output format: "XY filename"
        const file = line.substring(3).trim();

        // Git output is relative to git root
        const fullPath = path.join(gitRootDir, file);

        return path.normalize(fullPath);
      })
      .filter(file => {
        // Filter component JSONs and only those inside this solution's componentsRoot
        const fileName = path.basename(file);
        return file.endsWith('.json') &&
               !fileName.includes('package') &&
               !fileName.includes('config') &&
               !fileName.includes('.diagram.') &&
               fsSync.existsSync(file) &&
               file.startsWith(rootPrefix);
      });

    return jsonFiles;
  } catch (error) {
    return [];
  }
}

/**
 * Finds all JSON files in a component folder
 * @param {string} componentDir - Component folder
 * @returns {Promise<string[]>} JSON file paths
 */
async function findAllJsonInComponent(componentDir) {
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
 * @returns {Promise<string[]>} JSON file paths
 */
async function findAllJson(discovered) {
  const allJsons = [];

  // Only scan folders that were discovered from paths
  for (const component in discovered) {
    const componentDir = discovered[component];
    if (componentDir) {
      const jsons = await findAllJsonInComponent(componentDir);
      allJsons.push(...jsons);
    }
  }

  return allJsons;
}

module.exports = {
  getJsonMetadata,
  checkComponentDomain,
  detectComponentType,
  getGitChangedJson,
  findAllJsonInComponent,
  findAllJson
};

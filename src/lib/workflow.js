const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const { publishComponent } = require('./api');
const { getInstanceId, deleteWorkflow } = require('./db');
const { getComponentTypes } = require('./vnextConfig');
const { discoverComponents, findJsonInComponent } = require('./discover');

/**
 * Gets key and version values from JSON file
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
    data: data
  };
}

/**
 * Detects component type from file path based on vnext.config.json paths
 * @param {string} jsonPath - JSON file path
 * @param {string} projectRoot - Project root folder
 * @returns {string} Component type (sys-flows, sys-tasks, etc.)
 */
function detectComponentType(jsonPath, projectRoot) {
  const pathLower = jsonPath.toLowerCase();
  
  try {
    const componentTypes = getComponentTypes(projectRoot);
    
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
          default: return `sys-${type.toLowerCase()}`;
        }
      }
    }
  } catch (error) {
    // Fallback to path-based detection
  }
  
  // Fallback: detect from path directly
  if (pathLower.includes('/workflows/')) return 'sys-flows';
  if (pathLower.includes('/tasks/')) return 'sys-tasks';
  if (pathLower.includes('/schemas/')) return 'sys-schemas';
  if (pathLower.includes('/views/')) return 'sys-views';
  if (pathLower.includes('/functions/')) return 'sys-functions';
  if (pathLower.includes('/extensions/')) return 'sys-extensions';
  
  return 'sys-flows'; // default
}

/**
 * Processes a single component (DB check → delete if exists → publish)
 * @param {string} jsonPath - JSON file path
 * @param {Object} dbConfig - Database configuration
 * @param {string} baseUrl - API base URL
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<Object>} Process result
 */
async function processComponent(jsonPath, dbConfig, baseUrl, projectRoot) {
  const metadata = await getJsonMetadata(jsonPath);
  
  if (!metadata.key || !metadata.version) {
    throw new Error('No key or version found in JSON');
  }
  
  const componentType = detectComponentType(jsonPath, projectRoot);
  const flow = metadata.flow || componentType;
  
  // 1. Check if exists in DB
  const existingId = await getInstanceId(dbConfig, flow, metadata.key, metadata.version);
  
  // 2. If exists, delete first
  let wasDeleted = false;
  if (existingId) {
    await deleteWorkflow(dbConfig, flow, existingId);
    wasDeleted = true;
  }
  
  // 3. Publish to API
  const result = await publishComponent(baseUrl, metadata.data);
  
  if (!result.success) {
    throw new Error(result.error);
  }
  
  return {
    key: metadata.key,
    version: metadata.version,
    componentType: componentType,
    wasDeleted: wasDeleted,
    success: true
  };
}

/**
 * Finds changed JSON files in Git
 * Only returns files within PROJECT_ROOT
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<string[]>} Changed JSON file paths
 */
async function getGitChangedJson(projectRoot) {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  const fsSync = require('fs');
  
  try {
    // Find git root
    const { stdout: gitRoot } = await execPromise('git rev-parse --show-toplevel', { cwd: projectRoot });
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
        // Filter workflow JSONs and only those in project
        const fileName = path.basename(file);
        return file.endsWith('.json') && 
               !fileName.includes('package') && 
               !fileName.includes('config') &&
               !fileName.includes('.diagram.') &&
               fsSync.existsSync(file) &&
               file.startsWith(path.normalize(projectRoot));
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
  const pattern = path.join(componentDir, '**/*.json');
  const files = await glob(pattern, {
    ignore: [
      '**/.meta/**',
      '**/.meta',
      '**/*.diagram.json',
      '**/package*.json',
      '**/*config*.json'
    ]
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
  detectComponentType,
  processComponent,
  getGitChangedJson,
  findAllJsonInComponent,
  findAllJson
};

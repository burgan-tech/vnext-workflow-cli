const { glob } = require('glob');
const path = require('path');
const fs = require('fs');
const { getComponentsRoot, getComponentTypes } = require('./vnextConfig');

/**
 * Discovers component folders based on vnext.config.json paths
 * Only scans folders defined in paths, ignores everything else
 * @param {string} projectRoot - Project root folder (PROJECT_ROOT)
 * @returns {Object} Discovered component folders
 */
async function discoverComponents(projectRoot) {
  const componentsRoot = getComponentsRoot(projectRoot);
  const componentTypes = getComponentTypes(projectRoot);
  
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
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<string[]>} CSX file paths
 */
async function findAllCsxInComponents(projectRoot) {
  const discovered = await discoverComponents(projectRoot);
  const allCsxFiles = [];
  
  // Only scan folders that were discovered from paths
  for (const [type, componentDir] of Object.entries(discovered)) {
    if (componentDir) {
      const pattern = path.join(componentDir, '**/*.csx');
      const files = await glob(pattern, {
        ignore: [
          '**/.meta/**',
          '**/.meta',
          '**/node_modules/**',
          '**/dist/**'
        ]
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
  discoverComponents,
  findJsonInComponent,
  findAllJsonFiles,
  findAllCsxInComponents,
  getComponentDir,
  listDiscovered,
  detectComponentTypeFromPath
};

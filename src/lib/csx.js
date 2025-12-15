const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const { discoverComponents, findAllJsonFiles } = require('./discover');

/**
 * Encodes CSX file to Base64
 * @param {string} csxPath - CSX file path
 * @returns {Promise<string>} Base64 encoded content
 */
async function encodeToBase64(csxPath) {
  const content = await fs.readFile(csxPath, 'utf8');
  return Buffer.from(content).toString('base64');
}

/**
 * Finds JSON files that reference the CSX file
 * Only searches in paths defined in vnext.config.json
 * @param {string} csxPath - CSX file path
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<string[]>} Matching JSON file paths
 */
async function findJsonFilesForCsx(csxPath, projectRoot) {
  const csxBaseName = path.basename(csxPath);
  
  // Get discovered components (only paths defined in vnext.config.json)
  const discovered = await discoverComponents(projectRoot);
  
  // Get all JSON files from discovered components only
  const jsonFileInfos = await findAllJsonFiles(discovered);
  
  // Filter JSONs that reference the CSX
  const matchingJsons = [];
  
  for (const jsonInfo of jsonFileInfos) {
    try {
      const content = await fs.readFile(jsonInfo.path, 'utf8');
      if (content.includes(csxBaseName)) {
        matchingJsons.push(jsonInfo.path);
      }
    } catch (error) {
      // Skip unreadable files
    }
  }
  
  return matchingJsons;
}

/**
 * Calculates CSX location path
 * @param {string} csxPath - CSX file path
 * @param {string} projectRoot - Project root folder
 * @returns {string} Location path
 */
function getCsxLocation(csxPath, projectRoot) {
  // Convert to ./src/Rules/MyRule.csx format
  const parts = csxPath.split(path.sep);
  const srcIndex = parts.lastIndexOf('src');
  
  if (srcIndex !== -1) {
    const relevantParts = parts.slice(srcIndex);
    return './' + relevantParts.join('/');
  }
  
  return './' + path.basename(csxPath);
}

/**
 * Updates ALL CSX codes in a JSON file
 * Updates all references with the same location
 * Supports encoding types: NAT (native/plain text), B64 (Base64, default)
 * @param {string} jsonPath - JSON file path
 * @param {string} csxLocation - CSX location path
 * @param {string} base64Code - Base64 encoded CSX content
 * @param {string} nativeCode - Native (plain text) CSX content
 * @returns {Promise<number>} Number of updated references
 */
async function updateCodeInJson(jsonPath, csxLocation, base64Code, nativeCode) {
  const content = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(content);
  
  let updateCount = 0;
  
  // Recursively find and update ALL location matches
  function updateRecursive(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    
    // Skip if location is missing
    if (!obj.location) {
      // Continue scanning children
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          updateRecursive(obj[key]);
        }
      }
      return;
    }
    
    if (obj.location === csxLocation && 'code' in obj) {
      // Check encoding type: NAT = Native (plain text), B64 or empty = Base64 (default)
      const encoding = obj.encoding ? obj.encoding.toUpperCase() : 'B64';
      
      if (encoding === 'NAT') {
        // Native encoding - write plain text content
        obj.code = nativeCode;
      } else {
        // B64 or default - write Base64 encoded content
        obj.code = base64Code;
      }
      updateCount++;
    }
    
    // Scan all elements in array or object
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        updateRecursive(obj[key]);
      }
    }
  }
  
  updateRecursive(data);
  
  if (updateCount > 0) {
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  }
  
  return updateCount;
}

/**
 * Reads CSX file content as plain text (native)
 * @param {string} csxPath - CSX file path
 * @returns {Promise<string>} Plain text content
 */
async function readNativeContent(csxPath) {
  return await fs.readFile(csxPath, 'utf8');
}

/**
 * Processes a single CSX file
 * Updates ALL referencing JSON files
 * Supports both NAT (native) and B64 (Base64) encoding
 * @param {string} csxPath - CSX file path
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<Object>} Process result
 */
async function processCsxFile(csxPath, projectRoot) {
  // Read native content
  const nativeCode = await readNativeContent(csxPath);
  
  // Convert to Base64
  const base64Code = Buffer.from(nativeCode).toString('base64');
  
  // Find ALL related JSONs (only in paths defined in vnext.config.json)
  const jsonFiles = await findJsonFilesForCsx(csxPath, projectRoot);
  
  if (jsonFiles.length === 0) {
    return { 
      success: false, 
      message: 'No related JSON found',
      updatedJsonCount: 0,
      totalUpdates: 0,
      jsonFiles: []
    };
  }
  
  // Calculate CSX location
  const csxLocation = getCsxLocation(csxPath, projectRoot);
  
  // Update each JSON
  let updatedJsonCount = 0;
  let totalUpdates = 0;
  const updatedFiles = [];
  
  for (const jsonFile of jsonFiles) {
    try {
      const updates = await updateCodeInJson(jsonFile, csxLocation, base64Code, nativeCode);
      if (updates > 0) {
        updatedJsonCount++;
        totalUpdates += updates;
        updatedFiles.push({
          file: path.basename(jsonFile),
          updates: updates
        });
      }
    } catch (error) {
      // Continue with next file on error
    }
  }
  
  return {
    success: updatedJsonCount > 0,
    message: updatedJsonCount > 0 ? 'Updated' : 'No references to update',
    updatedJsonCount,
    totalUpdates,
    jsonFiles: updatedFiles
  };
}

/**
 * Finds changed CSX files in Git
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<string[]>} Changed CSX file paths
 */
async function getGitChangedCsx(projectRoot) {
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
    
    const csxFiles = lines
      .filter(line => line.includes('.csx'))
      .map(line => {
        // Git status output format: "XY filename"
        const file = line.substring(3).trim();
        
        // Git output is relative to git root, not project root
        const fullPath = path.join(gitRootDir, file);
        
        return path.normalize(fullPath);
      })
      .filter(file => {
        // Only .csx files that exist and are in our project
        return file.endsWith('.csx') && 
               fsSync.existsSync(file) &&
               file.startsWith(path.normalize(projectRoot));
      });
    
    return csxFiles;
  } catch (error) {
    return [];
  }
}

/**
 * Finds all CSX files in discovered components ONLY
 * Does NOT scan folders outside of paths definition
 * @param {string} projectRoot - Project root folder
 * @returns {Promise<string[]>} CSX file paths
 */
async function findAllCsx(projectRoot) {
  const { findAllCsxInComponents } = require('./discover');
  return findAllCsxInComponents(projectRoot);
}

module.exports = {
  encodeToBase64,
  readNativeContent,
  findJsonFilesForCsx,
  getCsxLocation,
  updateCodeInJson,
  processCsxFile,
  getGitChangedCsx,
  findAllCsx
};

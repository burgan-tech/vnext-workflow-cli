const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

/**
 * CSX dosyasını Base64'e çevirir
 */
async function encodeToBase64(csxPath) {
  const content = await fs.readFile(csxPath, 'utf8');
  return Buffer.from(content).toString('base64');
}

/**
 * CSX dosyası için ilgili JSON dosyalarını bulur
 */
async function findJsonFilesForCsx(csxPath, projectRoot) {
  const csxBaseName = path.basename(csxPath);
  
  // Tüm JSON dosyalarını bul
  const pattern = path.join(projectRoot, '**', '*.json');
  const jsonFiles = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/package*.json', '**/*config*.json']
  });
  
  // CSX referansı olan JSON'ları filtrele
  const matchingJsons = [];
  
  for (const jsonFile of jsonFiles) {
    try {
      const content = await fs.readFile(jsonFile, 'utf8');
      if (content.includes(csxBaseName)) {
        matchingJsons.push(jsonFile);
      }
    } catch (error) {
      // Ignore
    }
  }
  
  return matchingJsons;
}

/**
 * CSX location path'ini hesaplar
 */
function getCsxLocation(csxPath) {
  // ./src/Rules/MyRule.csx formatına çevir
  const parts = csxPath.split('/');
  const srcIndex = parts.lastIndexOf('src');
  
  if (srcIndex !== -1) {
    const relevantParts = parts.slice(srcIndex);
    return './' + relevantParts.join('/');
  }
  
  return './' + path.basename(csxPath);
}

/**
 * JSON dosyasında CSX code'unu günceller
 */
async function updateCodeInJson(jsonPath, csxLocation, base64Code) {
  const content = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(content);
  
  // Recursive olarak location'ı bul ve güncelle
  function updateRecursive(obj) {
    if (typeof obj !== 'object' || obj === null) return false;
    
    if (obj.location === csxLocation && 'code' in obj) {
      obj.code = base64Code;
      return true;
    }
    
    for (const key in obj) {
      if (updateRecursive(obj[key])) {
        return true;
      }
    }
    
    return false;
  }
  
  const updated = updateRecursive(data);
  
  if (updated) {
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  }
  
  return false;
}

/**
 * Tek bir CSX dosyasını işler
 */
async function processCsxFile(csxPath, projectRoot) {
  // Base64'e çevir
  const base64Code = await encodeToBase64(csxPath);
  
  // İlgili JSON'ları bul
  const jsonFiles = await findJsonFilesForCsx(csxPath, projectRoot);
  
  if (jsonFiles.length === 0) {
    return { success: false, message: 'İlgili JSON bulunamadı' };
  }
  
  // CSX location'ı hesapla
  const csxLocation = getCsxLocation(csxPath);
  
  // Her JSON'u güncelle
  let updatedCount = 0;
  for (const jsonFile of jsonFiles) {
    try {
      const updated = await updateCodeInJson(jsonFile, csxLocation, base64Code);
      if (updated) {
        updatedCount++;
      }
    } catch (error) {
      // Continue with next file
    }
  }
  
  return {
    success: updatedCount > 0,
    updatedCount,
    jsonFiles: jsonFiles.map(f => path.basename(f))
  };
}

/**
 * Git'te değişen CSX dosyalarını bulur
 */
async function getGitChangedCsx(projectRoot) {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  try {
    // Git root'u bul
    const { stdout: gitRoot } = await execPromise('git rev-parse --show-toplevel', { cwd: projectRoot });
    const gitRootDir = gitRoot.trim();
    
    // Git status'u git root'tan çalıştır
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
               require('fs').existsSync(file) &&
               file.startsWith(path.normalize(projectRoot));
      });
    
    return csxFiles;
  } catch (error) {
    return [];
  }
}

/**
 * Tüm CSX dosyalarını bulur
 */
async function findAllCsx(projectRoot) {
  const pattern = path.join(projectRoot, '**', 'src', '**', '*.csx');
  const files = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/dist/**']
  });
  return files;
}

module.exports = {
  encodeToBase64,
  findJsonFilesForCsx,
  getCsxLocation,
  updateCodeInJson,
  processCsxFile,
  getGitChangedCsx,
  findAllCsx
};


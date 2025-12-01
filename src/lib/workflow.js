const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const { getInstanceId, deleteWorkflow } = require('./db');
const { postWorkflow, activateWorkflow, reinitializeSystem } = require('./api');

/**
 * JSON dosyasından key ve version değerlerini alır
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
 * Dosya yolundan flow tipini belirler
 */
function detectFlowFromPath(jsonPath) {
  const pathLower = jsonPath.toLowerCase();
  
  if (pathLower.includes('/workflows/')) return 'sys-flows';
  if (pathLower.includes('/tasks/')) return 'sys-tasks';
  if (pathLower.includes('/schemas/')) return 'sys-schemas';
  if (pathLower.includes('/views/')) return 'sys-views';
  if (pathLower.includes('/functions/')) return 'sys-functions';
  if (pathLower.includes('/extensions/')) return 'sys-extensions';
  
  return 'sys-flows'; // default
}

/**
 * Tek bir workflow'u işler (DB'den sil, POST, Activate)
 */
async function processWorkflow(jsonPath, dbConfig, apiConfig) {
  const metadata = await getJsonMetadata(jsonPath);
  
  if (!metadata.key || !metadata.version) {
    throw new Error('JSON\'da key veya version bulunamadı');
  }
  
  const flow = metadata.flow || detectFlowFromPath(jsonPath);
  
  // 1. DB'de var mı kontrol et
  const instanceId = await getInstanceId(dbConfig, flow, metadata.key, metadata.version);
  
  // 2. Varsa sil
  if (instanceId) {
    await deleteWorkflow(dbConfig, flow, instanceId);
  }
  
  // 3. API'ye POST et
  const apiUrl = apiConfig.baseUrl;
  const apiVersion = apiConfig.version;
  const apiDomain = apiConfig.domain;
  
  const postResult = await postWorkflow(apiUrl, apiVersion, apiDomain, flow, metadata.data);
  const newInstanceId = postResult.id || postResult.Id;
  
  if (!newInstanceId) {
    throw new Error('API POST başarılı ama instance ID alınamadı');
  }
  
  // 4. Aktif et
  await activateWorkflow(apiUrl, apiVersion, apiDomain, flow, newInstanceId, metadata.version);
  
  return {
    key: metadata.key,
    version: metadata.version,
    flow: flow,
    instanceId: newInstanceId,
    wasDeleted: !!instanceId
  };
}

/**
 * Git'te değişen JSON dosyalarını bulur
 */
async function getGitChangedJson(projectRoot) {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  const fs = require('fs');
  
  try {
    // Git root'u bul
    const { stdout: gitRoot } = await execPromise('git rev-parse --show-toplevel', { cwd: projectRoot });
    const gitRootDir = gitRoot.trim();
    
    // Git status'u git root'tan çalıştır
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
        // Workflow JSON'larını filtrele ve sadece project içindekileri al
        const fileName = path.basename(file);
        return file.endsWith('.json') && 
               !fileName.includes('package') && 
               !fileName.includes('config') &&
               fs.existsSync(file) &&
               file.startsWith(path.normalize(projectRoot));
      });
    
    return jsonFiles;
  } catch (error) {
    return [];
  }
}

/**
 * Belirli bir component klasöründeki tüm JSON dosyalarını bulur
 */
async function findAllJsonInComponent(componentDir) {
  const pattern = path.join(componentDir, '**/*.json');
  const files = await glob(pattern, {
    ignore: ['**/package*.json', '**/*config*.json', '**/*.diagram.json']
  });
  return files;
}

/**
 * Tüm component'lerdeki JSON dosyalarını bulur
 */
async function findAllJson(discovered) {
  const allJsons = [];
  
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
  detectFlowFromPath,
  processWorkflow,
  getGitChangedJson,
  findAllJsonInComponent,
  findAllJson
};


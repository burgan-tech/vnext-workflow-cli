const { glob } = require('glob');
const path = require('path');
const fs = require('fs');

const COMPONENTS = ['Workflows', 'Tasks', 'Schemas', 'Views', 'Functions', 'Extensions'];

/**
 * Proje içinde component klasörlerini otomatik bulur
 */
async function discoverComponents(projectRoot) {
  const discovered = {};
  
  for (const component of COMPONENTS) {
    try {
      // 3 seviye derinlikte ara
      const pattern = path.join(projectRoot, '**', component);
      const matches = await glob(pattern, {
        maxDepth: 3,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**']
      });
      
      if (matches.length > 0) {
        // İlk bulunanı al
        const dir = matches[0];
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          discovered[component] = dir;
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }
  
  return discovered;
}

/**
 * Belirli bir component klasörünü getirir
 */
function getComponentDir(discovered, component) {
  return discovered[component] || null;
}

/**
 * Bulunan klasörleri listeler
 */
function listDiscovered(discovered) {
  const results = [];
  for (const component of COMPONENTS) {
    results.push({
      name: component,
      path: discovered[component] || null,
      found: !!discovered[component]
    });
  }
  return results;
}

module.exports = {
  discoverComponents,
  getComponentDir,
  listDiscovered,
  COMPONENTS
};


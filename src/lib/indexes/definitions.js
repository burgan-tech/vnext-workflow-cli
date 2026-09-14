const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { discoverComponents, findJsonInComponent } = require('../discover');
const { loadVnextConfig, getComponentsRootFromConfig, getComponentTypesFromConfig } = require('../vnextConfig');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identifier = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
function physicalSchema(flow) {
  if (typeof flow !== 'string' || !identifier.test(flow) || flow.length > 63)
    throw new Error(`Invalid flow key for index generation: ${flow}`);
  return flow.toLowerCase().replace(/-/g, '_');
}

const { parse: parseVersion, bestMatch } = require('./versions');
function resolveMaster(schemas, reference, domain) {
  if (!reference || reference.domain !== domain || reference.flow !== 'sys-schemas')
    throw new Error('Master reference must identify a local sys-schemas component (domain, flow, key).');
  const selected = bestMatch(schemas.filter(s => s.domain === domain && s.key === reference.key), reference.version);
  if (!selected) throw new Error(`Master ${reference.key}/${reference.version || 'latest'} is missing locally; include the referenced schema version before generating SQL.`);
  return selected;
}

function fieldsFromSchema(root, schemaType) {
  const fields = [];
  function visit(node, fieldPath, supported) {
    if (Array.isArray(node)) { node.forEach(n => visit(n, fieldPath, false)); return; }
    if (!node || typeof node !== 'object') return;
    supported = supported && !['$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas'].some(key => key in node);
    if ('x-indexed' in node && schemaType !== 'master')
      throw new Error(`Field '${fieldPath}': x-indexed is only allowed when root.type is 'master'.`);
    if ('x-indexed' in node && typeof node['x-indexed'] !== 'boolean')
      throw new Error(`Field '${fieldPath}': x-indexed must be boolean.`);
    if (node['x-indexed'] === true) {
      if (!supported || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/.test(fieldPath) ||
        !['string', 'number', 'integer', 'boolean'].includes(node.type) || '$ref' in node)
        throw new Error(`Field '${fieldPath}': x-indexed requires an explicit scalar under object properties; arrays, references and conditional schemas are unsupported.`);
      if ('x-sortable' in node && typeof node['x-sortable'] !== 'boolean') throw new Error(`Field '${fieldPath}': x-sortable must be boolean.`);
      if ('x-filterOperators' in node && (!Array.isArray(node['x-filterOperators']) || node['x-filterOperators'].some(op => typeof op !== 'string')))
        throw new Error(`Field '${fieldPath}': x-filterOperators must be an array of strings.`);
      fields.push({
        path: fieldPath, type: node.type, format: node.format,
        sortable: node['x-sortable'] === true, operators: node['x-filterOperators'] || []
      });
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [name, value] of Object.entries(child))
          visit(value, fieldPath ? `${fieldPath}.${name}` : name, supported && (!node.type || node.type === 'object') && !name.includes('.'));
      } else if (['$defs', 'definitions', 'patternProperties', 'dependentSchemas'].includes(key)) {
        Object.values(child || {}).forEach(value => visit(value, fieldPath, false));
      } else if (['items', 'prefixItems', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'not', 'additionalProperties', 'contains', 'propertyNames', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems'].includes(key)) {
        visit(child, fieldPath, false);
      }
    }
  }
  visit(root, '', true);
  return fields;
}
function projectionDefinitions(fields) {
  const merged = new Map();
  for (const field of fields) {
    const storage = ['number', 'integer'].includes(field.type) ? 'numeric' : field.type === 'string' && field.format === 'date-time' ? 'timestamptz' : 'text';
    const old = merged.get(field.path);
    if (old && old.storage !== storage) throw new Error(`Incompatible indexed types across workflow versions: ${field.path}`);
    merged.set(field.path, {
      ...field, storage, sortable: field.sortable || (old && old.sortable) || false,
      operators: [...new Set([...(old ? old.operators : []), ...field.operators])].sort(compare)
    });
  }
  return [...merged.values()].sort((a, b) => compare(a.path, b.path)).flatMap(field =>
    [...new Set(['text', field.storage])].map(storage => {
      const key = hash(`v1:latest:${field.path}:${storage}`).slice(0, 24);
      return {
        key, column: `q_${key}`, path: field.path, storage,
        sortable: storage === 'text' && field.sortable,
        trigram: storage === 'text' && field.operators.some(op => ['contains', 'like', 'startswith', 'endswith'].includes(op.toLowerCase()))
      };
    }));
}
async function loadPlans(projectRoot, flow) {
  const config = loadVnextConfig(projectRoot);
  if (!config.domain || !identifier.test(config.domain)) throw new Error('vnext.config.json requires a valid domain.');
  const dirs = await discoverComponents({
    projectRoot,
    componentsRoot: getComponentsRootFromConfig(projectRoot, config),
    componentTypes: getComponentTypesFromConfig(config)
  });
  if (!dirs.workflows || !dirs.schemas) throw new Error('Configured workflows and schemas directories are required.');
  async function read(dir, type) {
    const files = (await findJsonInComponent(dir)).sort(compare);
    const seen = new Set();
    return files.map(file => {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.flow !== type || !data.key || !data.domain) throw new Error(`Invalid ${type} component: ${file}`);
      if (type === 'sys-schemas') {
        const schemaType = data.type;
        if (schemaType != null && !(typeof schemaType === 'string' && schemaType.trim() === '') &&
          !['master', 'transition', 'view', 'function'].includes(schemaType))
          throw new Error(`Schema type must be one of: master, transition, view, function (${file}).`);
        if (schemaType !== 'master') fieldsFromSchema(data.attributes && data.attributes.schema, schemaType);
      }
      const version = parseVersion(data.version);
      const key = JSON.stringify([data.domain, data.key, version.canonical]);
      if (seen.has(key)) throw new Error(`Duplicate component identity ${key}: ${file}`);
      seen.add(key);
      return { ...data, source: path.relative(projectRoot, file), digest: hash(fs.readFileSync(file)) };
    });
  }
  const [workflows, schemas] = await Promise.all([read(dirs.workflows, 'sys-flows'), read(dirs.schemas, 'sys-schemas')]);
  const schemaOwners = new Map();
  for (const w of workflows.filter(w => w.domain === config.domain)) {
    const name = physicalSchema(w.key);
    if (schemaOwners.has(name) && schemaOwners.get(name) !== w.key)
      throw new Error(`Workflow keys collide in PostgreSQL schema '${name}'.`);
    schemaOwners.set(name, w.key);
  }
  const grouped = new Map();
  for (const w of workflows.filter(w => w.domain === config.domain && (!flow || w.key === flow))) {
    if (!grouped.has(w.key)) grouped.set(w.key, []);
    grouped.get(w.key).push(w);
  }
  if (!grouped.size) throw new Error(`No local workflows found${flow ? ` for '${flow}'` : ''}.`);
  const physical = new Set();
  return [...grouped.entries()].sort(([a], [b]) => compare(a, b)).map(([key, versions]) => {
    const schema = physicalSchema(key);
    if (physical.has(schema)) throw new Error(`Workflow keys collide in PostgreSQL schema '${schema}'.`);
    physical.add(schema);
    const sources = new Map(), fields = [];
    let hasMaster = false;
    for (const w of versions) {
      sources.set(w.source, { file: w.source, sha256: w.digest, key: w.key, version: w.version });
      if (!w.attributes || !w.attributes.schema) continue;
      const master = resolveMaster(schemas, w.attributes.schema, config.domain);
      if (master.type !== 'master') continue;
      hasMaster = true;
      if (!master.attributes || !master.attributes.schema) throw new Error(`Master JSON schema is missing in ${master.source}`);
      fields.push(...fieldsFromSchema(master.attributes.schema, master.type));
      sources.set(master.source, { file: master.source, sha256: master.digest, key: master.key, version: master.version });
    }
    if (!hasMaster) return null;
    return { domain: config.domain, flow: key, schema, projections: projectionDefinitions(fields), sources: [...sources.values()] };
  }).filter(Boolean);
}
module.exports = { hash, physicalSchema, resolveMaster, fieldsFromSchema, projectionDefinitions, loadPlans };

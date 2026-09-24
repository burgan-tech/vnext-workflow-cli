const { hash, physicalSchema } = require('./definitions');
const quote = value => '"' + value.replace(/"/g, '""') + '"';
const literal = value => "'" + value.replace(/'/g, "''") + "'";
const array = values => `ARRAY[${values.map(literal).join(', ')}]::text[]`;
function expression(p, schema) {
  const parts = p.path.split('.');
  const text = parts.length === 1 ? `("Data" ->> ${literal(p.path)})` : `("Data" #>> ${array(parts)})`;
  return p.storage === 'numeric' ? `${text}::numeric` : p.storage === 'timestamptz' ? `${quote(schema)}.q_iso_timestamp_v1(${text})` : text;
}
function indexes(p) {
  const column = quote(p.column);
  const specifications = [{ kind: 'btree', legacy: `ix_${p.key}_btree_v2`, definition: p.storage === 'text'
    ? `USING btree (${column}, "InstanceId") WHERE "IsLatest" = true`
    : `USING btree (${column}) INCLUDE ("InstanceId") WHERE "IsLatest" = true` }];
  if (p.sortable) specifications.push({ kind: 'desc', legacy: `ix_${p.key}_desc_v2`, definition: `USING btree (${column} DESC, "InstanceId" ASC) WHERE "IsLatest" = true` });
  if (p.trigram) specifications.push({ kind: 'trgm', legacy: `ix_${p.key}_trgm`, definition: `USING gin (${column} COLLATE "tr-TR-x-icu" public.gin_trgm_ops) WHERE "IsLatest" = true` });
  return specifications.map(s => ({ ...s, name: `ix_${p.path.replace(/\./g, '_').toLowerCase().slice(0, 20)}_${s.kind}_${hash(`v1:${p.key}:${s.definition}`).slice(0, 20)}` }));
}

// The same explicit ISO conversion as runtime physical contract v1:latest. Never wrap a general cast as IMMUTABLE.
const timestampBody = String.raw`
DECLARE m text[]; local_value timestamp; offset_minutes integer := 0;
BEGIN
  m := regexp_match(value, '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2}(\.[0-9]+)?)(Z|([+-])([0-9]{2}):([0-9]{2}))$');
  IF m IS NULL THEN RAISE EXCEPTION 'Expected ISO-8601 date-time with explicit offset' USING ERRCODE = '22007'; END IF;
  IF m[4]::int > 23 OR m[5]::int > 59 OR m[6]::numeric >= 60
     OR COALESCE(m[10]::int, 0) > 15 OR COALESCE(m[11]::int, 0) > 59 THEN
    RAISE EXCEPTION 'Invalid ISO-8601 time or offset' USING ERRCODE = '22007';
  END IF;
  local_value := make_timestamp(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, m[6]::double precision);
  IF m[8] <> 'Z' THEN
    offset_minutes := (m[10]::int * 60 + m[11]::int) * CASE WHEN m[9] = '-' THEN -1 ELSE 1 END;
  END IF;
  RETURN (local_value - make_interval(mins => offset_minutes)) AT TIME ZONE 'UTC';
END;
`;

// Canonicalized by PostgreSQL on an empty temporary prototype. Covers includes, collation,
// operator classes, ordering, predicate and access method; names alone never prove readiness.
const helpers = `
CREATE FUNCTION pg_temp.vnext_index_signature(index_oid oid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $signature$
 SELECT jsonb_build_object('method', am.amname, 'unique', i.indisunique,
   'keys', i.indnkeyatts, 'attributes', i.indnatts,
   'classes', i.indclass::text, 'collations', i.indcollation::text, 'options', i.indoption::text,
   'definition', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, n, false) ORDER BY n)
                  FROM generate_series(1, i.indnatts) n),
   'predicate', pg_get_expr(i.indpred, i.indrelid), 'reloptions', c.reloptions)
 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam
 WHERE i.indexrelid = index_oid AND i.indisvalid AND i.indisready AND NOT i.indisexclusion
$signature$;
`;

function generateSql(plan, { retireObsolete = false } = {}) {
  if (physicalSchema(plan.flow) !== plan.schema) throw new Error('Unexpected physical schema.');
  const schema = quote(plan.schema), table = `${schema}."InstancesData"`, catalog = `${schema}."AttributeIndexCatalog"`;
  const projections = plan.projections;
  const lines = [
    `-- vNext attribute indexes: ${plan.domain}/${plan.flow}`,
    '-- Generated offline. Review and execute only in a DBA-approved maintenance window.',
    '-- ACCESS EXCLUSIVE lock; stored columns rewrite the table. Transactional, not CONCURRENTLY.',
    '-- On any error ROLLBACK the connection. With psql use: psql -X -v ON_ERROR_STOP=1 -f <this-file>.',
    '-- Existing application catalog caches may live for 30s: drain readers/writers before retirement.',
    '-- This file never publishes schemas. Confirm the source manifest matches deployed workflow versions.',
    'BEGIN;', "SET LOCAL search_path = pg_catalog, public;", "SET LOCAL standard_conforming_strings = on;", "SET LOCAL lock_timeout = '5s';",
    `DO $guard$ BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended(${literal('attribute-indexes:' + plan.schema)}, 0)) THEN
   RAISE EXCEPTION 'Another attribute-index maintenance transaction is running'; END IF;
 IF to_regclass(${literal(table)}) IS NULL THEN RAISE EXCEPTION 'Publish the workflow first: table % does not exist', ${literal(table)}; END IF;
END $guard$;`,
    `LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE;`,
    `CREATE TABLE IF NOT EXISTS ${catalog} (
 "Key" text PRIMARY KEY, "ColumnName" text NOT NULL, "PgType" text NOT NULL,
 "Indexes" text[] NOT NULL, "Ready" boolean NOT NULL DEFAULT false);`
  ];
  if (projections.some(p => p.trigram)) lines.push('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;');
  if (projections.some(p => p.storage === 'timestamptz')) {
    const fn = `${schema}.q_iso_timestamp_v1`;
    // Existing v1 functions must match exactly (whitespace aside); changing the implementation
    // in place would silently invalidate stored values, so collisions require a new physical version.
    lines.push(`DO $timestamp$ DECLARE existing oid := to_regprocedure(${literal(fn + '(text)')}); BEGIN
 IF existing IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=existing AND p.provolatile='i' AND p.proisstrict AND p.proparallel='s'
     AND NOT p.prosecdef AND p.prorettype='timestamptz'::regtype AND l.lanname='plpgsql'
     AND regexp_replace(p.prosrc, '\\s+', '', 'g') = regexp_replace(${literal(timestampBody)}, '\\s+', '', 'g'))
 THEN RAISE EXCEPTION 'Timestamp conversion v1 differs; use a new physical conversion version'; END IF;
 IF existing IS NULL THEN EXECUTE ${literal(`CREATE FUNCTION ${fn}(value text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS ${literal(timestampBody)}`)}; END IF;
END $timestamp$;`);
  }
  lines.push('CREATE TEMP TABLE vnext_index_state (changed boolean) ON COMMIT DROP; INSERT INTO pg_temp.vnext_index_state VALUES (false);', 'CREATE TEMP TABLE vnext_index_prototype ("Data" jsonb, "IsLatest" boolean, "InstanceId" uuid) ON COMMIT DROP;', helpers);
  const additionSql = [];
  for (const p of projections) {
    const expr = expression(p, plan.schema);
    const ddl = `${quote(p.column)} ${p.storage} GENERATED ALWAYS AS (CASE WHEN "IsLatest" THEN ${expr} END) STORED`;
    lines.push(`ALTER TABLE pg_temp.vnext_index_prototype ADD COLUMN ${ddl};`);
    additionSql.push(`
 -- ${p.path} (${p.storage}): validate all versions before activating a new projection.
 SELECT a.attgenerated, format_type(a.atttypid, a.atttypmod), col_description(a.attrelid,a.attnum),
        pg_get_expr(d.adbin,d.adrelid) INTO existing
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=${literal(table)}::regclass AND a.attname=${literal(p.column)} AND NOT a.attisdropped;
 IF FOUND THEN
   IF existing.col_description IS DISTINCT FROM ${literal(`vnext-attribute-index:v1:latest:${p.path}:${p.storage}`)} OR
      existing.format_type <> ${literal(p.storage === 'timestamptz' ? 'timestamp with time zone' : p.storage)} THEN
     RAISE EXCEPTION 'Unrecognized projection collision: %', ${literal(p.path)};
   END IF;
   SELECT pg_get_expr(d.adbin,d.adrelid) INTO expected FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
     WHERE d.adrelid='pg_temp.vnext_index_prototype'::regclass AND a.attname=${literal(p.column)};
   IF existing.attgenerated = 's' AND existing.pg_get_expr IS DISTINCT FROM expected THEN
     RAISE EXCEPTION 'Projection expression changed under a v1 name: %', ${literal(p.path)};
   END IF;
 END IF;
 IF existing.attgenerated IS DISTINCT FROM 's' THEN
   BEGIN PERFORM COUNT(${expr}) FROM ${table};
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Cannot index field % as %: % (SQLSTATE %); no changes committed', ${literal(p.path)}, ${literal(p.storage)}, SQLERRM, SQLSTATE; END;
   IF existing.format_type IS NOT NULL THEN
     -- DROP COLUMN implicitly removes indexes/checks too: reject unexpected dependencies.
     IF EXISTS (SELECT 1 FROM pg_depend dep JOIN pg_attribute a
       ON a.attrelid=dep.refobjid AND a.attnum=dep.refobjsubid
       WHERE a.attrelid=${literal(table)}::regclass AND a.attname=${literal(p.column)}
         AND dep.classid IN ('pg_class'::regclass, 'pg_constraint'::regclass)) THEN
       RAISE EXCEPTION 'Retired projection % has dependent objects; DBA review is required before reactivation', ${literal(p.path)};
     END IF;
     EXECUTE ${literal(`ALTER TABLE ${table} DROP COLUMN ${quote(p.column)}`)};
   END IF;
   additions := array_append(additions, ${literal('ADD COLUMN ' + ddl)});
 END IF;`);
  }
  lines.push(`DO $columns$ DECLARE existing record; expected text; additions text[] := ARRAY[]::text[]; BEGIN
${additionSql.join('\n')}
 IF cardinality(additions)>0 THEN UPDATE pg_temp.vnext_index_state SET changed=true; EXECUTE ${literal(`ALTER TABLE ${table} `)} || array_to_string(additions, ', '); END IF;
END $columns$;`);
  for (const p of projections) {
    lines.push(`COMMENT ON COLUMN ${table}.${quote(p.column)} IS ${literal(`vnext-attribute-index:v1:latest:${p.path}:${p.storage}`)};`);
    lines.push(`DO $indexes$ DECLARE desired jsonb; existing_oid oid; existing_name text; selected_names text[] := ARRAY[]::text[]; old_names text[]; old_name text; affected integer; BEGIN
 SELECT "Indexes" INTO old_names FROM ${catalog} WHERE "Key"=${literal(p.key)};`);
    for (const ix of indexes(p)) {
      const marker = `vnext-attribute-index:cli:v1:${p.key}:${ix.kind}`;
      lines.push(`
 CREATE INDEX ${quote(ix.name)} ON pg_temp.vnext_index_prototype ${ix.definition};
 desired := pg_temp.vnext_index_signature(${literal('pg_temp.' + quote(ix.name))}::regclass);
 existing_oid := to_regclass(${literal(schema + '.' + quote(ix.name))});
 IF existing_oid IS NOT NULL AND pg_temp.vnext_index_signature(existing_oid) IS DISTINCT FROM desired THEN
   IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=existing_oid AND indrelid=${literal(table)}::regclass)
      OR obj_description(existing_oid,'pg_class') IS DISTINCT FROM ${literal(marker)} THEN
     RAISE EXCEPTION 'Unmanaged index name collision: %', ${literal(ix.name)}; END IF;
   EXECUTE ${literal('DROP INDEX ' + schema + '.' + quote(ix.name))};
   RAISE NOTICE 'Rebuilding changed index %', ${literal(ix.name)};
 END IF;
 -- Adopt an equivalent existing index (including old ix_<key> names), avoiding duplicates.
 SELECT c.relname INTO existing_name FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE i.indrelid=${literal(table)}::regclass AND pg_temp.vnext_index_signature(i.indexrelid)=desired
 ORDER BY (c.relname=${literal(ix.name)}) DESC, c.relname LIMIT 1;
 IF existing_name IS NULL THEN
   -- Old runtime-created names are owned only when the catalog also references them.
   existing_oid := to_regclass(${literal(schema + '.' + quote(ix.legacy))});
   IF existing_oid IS NOT NULL AND EXISTS (SELECT 1 FROM ${catalog} WHERE "Key"=${literal(p.key)} AND ${literal(ix.legacy)}=ANY("Indexes"))
      AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=existing_oid AND indrelid=${literal(table)}::regclass) THEN
     EXECUTE ${literal('DROP INDEX ' + schema + '.' + quote(ix.legacy))};
   END IF;
   EXECUTE ${literal(`CREATE INDEX ${quote(ix.name)} ON ${table} ${ix.definition}`)};
   EXECUTE ${literal(`COMMENT ON INDEX ${schema}.${quote(ix.name)} IS ${literal(marker)}`)};
   UPDATE pg_temp.vnext_index_state SET changed=true;
   existing_name := ${literal(ix.name)};
   RAISE NOTICE 'Created index %', existing_name;
 ELSE RAISE NOTICE 'Reusing index %', existing_name;
 END IF;
 selected_names := array_append(selected_names, existing_name);
 DROP INDEX pg_temp.${quote(ix.name)};
`);
    }
    lines.push(`
 -- Remove obsolete indexes only when this tool (or the legacy runtime catalog) owns them.
 FOREACH old_name IN ARRAY COALESCE(old_names, ARRAY[]::text[]) LOOP
   IF NOT (old_name=ANY(selected_names)) THEN
     existing_oid := to_regclass(format('%I.%I', ${literal(plan.schema)}, old_name));
     IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=existing_oid AND indrelid=${literal(table)}::regclass)
        AND (obj_description(existing_oid,'pg_class') LIKE ${literal(`vnext-attribute-index:cli:v1:${p.key}:%`)}
             OR old_name=ANY(${array([`ix_${p.key}_btree_v2`, `ix_${p.key}_desc_v2`, `ix_${p.key}_trgm`])})) THEN
       EXECUTE format('DROP INDEX %I.%I',${literal(plan.schema)},old_name);
       UPDATE pg_temp.vnext_index_state SET changed=true;
       RAISE NOTICE 'Removed obsolete managed index %',old_name;
     END IF;
   END IF;
 END LOOP;
INSERT INTO ${catalog} ("Key","ColumnName","PgType","Indexes","Ready")
 VALUES (${literal(p.key)},${literal(p.column)},${literal(p.storage === 'timestamptz' ? 'timestamp with time zone' : p.storage)},selected_names,true)
 ON CONFLICT ("Key") DO UPDATE SET "ColumnName"=EXCLUDED."ColumnName", "PgType"=EXCLUDED."PgType", "Indexes"=EXCLUDED."Indexes", "Ready"=true
 WHERE (${catalog}."ColumnName",${catalog}."PgType",${catalog}."Indexes",${catalog}."Ready")
 IS DISTINCT FROM (EXCLUDED."ColumnName",EXCLUDED."PgType",EXCLUDED."Indexes",EXCLUDED."Ready");
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected > 0 THEN UPDATE pg_temp.vnext_index_state SET changed=true; END IF;
 END $indexes$;`);
  }
  if (retireObsolete) lines.push(`
-- Explicit retirement: local definitions must include EVERY still-active workflow version.
DO $retire$ DECLARE r record; old_name text; existing_oid oid; BEGIN
 FOR r IN SELECT c.* FROM ${catalog} c WHERE NOT (c."Key"=ANY(${array(projections.map(p => p.key))})) AND c."Ready" LOOP
   IF r."ColumnName" <> 'q_' || r."Key" OR r."Key" !~ '^[a-f0-9]{24}$' OR NOT EXISTS (
     SELECT 1 FROM pg_attribute a WHERE a.attrelid=${literal(table)}::regclass AND a.attname=r."ColumnName" AND NOT a.attisdropped
       AND col_description(a.attrelid,a.attnum) LIKE 'vnext-attribute-index:v1:latest:%')
   THEN RAISE EXCEPTION 'Unrecognized retired projection: %',r."ColumnName"; END IF;
   EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP EXPRESSION IF EXISTS',${literal(table)},r."ColumnName");
   UPDATE ${catalog} SET "Ready"=false WHERE "Key"=r."Key";
   FOREACH old_name IN ARRAY r."Indexes" LOOP
     existing_oid := to_regclass(format('%I.%I',${literal(plan.schema)},old_name));
     IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=existing_oid AND indrelid=${literal(table)}::regclass)
       AND (obj_description(existing_oid,'pg_class') LIKE 'vnext-attribute-index:cli:v1:' || r."Key" || ':%'
            OR old_name=ANY(ARRAY['ix_' || r."Key" || '_btree_v2','ix_' || r."Key" || '_desc_v2','ix_' || r."Key" || '_trgm'])) THEN
       EXECUTE format('DROP INDEX %I.%I',${literal(plan.schema)},old_name);
     END IF;
   END LOOP;
   UPDATE pg_temp.vnext_index_state SET changed=true;
   RAISE NOTICE 'Retired projection %, retained stored values',r."ColumnName";
 END LOOP;
END $retire$;`);
  lines.push(`DO $analyze$ BEGIN IF (SELECT changed FROM pg_temp.vnext_index_state) THEN ANALYZE ${table}; END IF; END $analyze$;`, 'DROP FUNCTION pg_temp.vnext_index_signature(oid);', 'COMMIT;', '');
  return lines.join('\n');
}
module.exports = { generateSql, indexes, expression, timestampBody };

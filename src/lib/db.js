const { Client } = require('pg');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

/**
 * Tests the DB connection
 */
async function testDbConnection(dbConfig) {
  if (dbConfig.useDocker) {
    // Test via Docker
    try {
      const cmd = `docker exec ${dbConfig.dockerContainer} psql -U ${dbConfig.user} -d ${dbConfig.database} -c "SELECT 1;"`;
      await execPromise(cmd);
      return true;
    } catch (error) {
      return false;
    }
  } else {
    // Direct connection
    const client = new Client({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password
    });
    
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Finds the workflow's ID in the DB
 * NOTE: We don't check version, only the Key (like the bash script)
 */
async function getInstanceId(dbConfig, schema, key, version) {
  const dbSchema = schema.replace(/-/g, '_');
  const query = `SELECT "Id" FROM "${dbSchema}"."Instances" WHERE "Key" = $1 ORDER BY "CreatedAt" DESC LIMIT 1`;
  
  if (dbConfig.useDocker) {
    // Via Docker - escape double quotes in SQL with backslash
    const cmd = `docker exec ${dbConfig.dockerContainer} psql -U ${dbConfig.user} -d ${dbConfig.database} -t -c "SELECT \\"Id\\" FROM \\"${dbSchema}\\".\\"Instances\\" WHERE \\"Key\\" = '${key}' ORDER BY \\"CreatedAt\\" DESC LIMIT 1"`;
    try {
      const { stdout } = await execPromise(cmd);
      const id = stdout.trim();
      return id || null;
    } catch (error) {
      return null;
    }
  } else {
    // Direct connection
    const client = new Client({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password
    });
    
    try {
      await client.connect();
      const result = await client.query(query, [key]);
      await client.end();
      return result.rows.length > 0 ? result.rows[0].Id : null;
    } catch (error) {
      return null;
    }
  }
}

/**
 * Deletes a workflow from the DB
 */
async function deleteWorkflow(dbConfig, schema, instanceId) {
  const dbSchema = schema.replace(/-/g, '_');
  
  if (dbConfig.useDocker) {
    // Via Docker - escape double quotes
    const cmd = `docker exec ${dbConfig.dockerContainer} psql -U ${dbConfig.user} -d ${dbConfig.database} -c "DELETE FROM \\"${dbSchema}\\".\\"Instances\\" WHERE \\"Id\\" = '${instanceId}'"`;
    try {
      await execPromise(cmd);
      return true;
    } catch (error) {
      return false;
    }
  } else {
    // Direct connection
    const query = `DELETE FROM "${dbSchema}"."Instances" WHERE "Id" = $1`;
    const client = new Client({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password
    });
    
    try {
      await client.connect();
      await client.query(query, [instanceId]);
      await client.end();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = {
  testDbConnection,
  getInstanceId,
  deleteWorkflow
};


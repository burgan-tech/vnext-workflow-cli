const axios = require('axios');

/**
 * API bağlantısını test eder
 */
async function testApiConnection(baseUrl) {
  try {
    const response = await axios.get(`${baseUrl}/health`, {
      timeout: 5000
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

/**
 * Workflow'u API'ye post eder
 */
async function postWorkflow(baseUrl, version, domain, flow, data) {
  const workflowVersion = data.version || '1.0.0';
  const syncMode = 'true';
  
  const url = `${baseUrl}/api/${version}/${domain}/workflows/${flow}/instances/start?version=${workflowVersion}&sync=${syncMode}`;
  
  const response = await axios.post(url, data, {
    headers: {
      'accept': '*/*',
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

/**
 * Workflow'u aktif eder
 */
async function activateWorkflow(baseUrl, version, domain, flow, instanceId, workflowVersion) {
  const syncMode = 'true';
  
  const url = `${baseUrl}/api/${version}/${domain}/workflows/${flow}/instances/${instanceId}/transitions/activate?version=${workflowVersion}&sync=${syncMode}`;
  
  const response = await axios.patch(url, null, {
    headers: {
      'accept': '*/*'
    }
  });
  return response.data;
}

/**
 * Sistemi yeniden başlatır
 */
async function reinitializeSystem(baseUrl, version) {
  const url = `${baseUrl}/api/${version}/admin/re-initialize`;
  try {
    await axios.get(url, { timeout: 10000 });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  testApiConnection,
  postWorkflow,
  activateWorkflow,
  reinitializeSystem
};


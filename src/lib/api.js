const axios = require('axios');
const https = require('node:https');
const http = require('node:http');

// Create axios instance with custom agents for both HTTP and HTTPS
const apiClient = axios.create({
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ 
    rejectUnauthorized: false // Allow self-signed certificates
  })
});

/**
 * Tests the API connection
 * @param {string} baseUrl - API base URL
 * @returns {Promise<boolean>} Connection status
 */
async function testApiConnection(baseUrl) {
  try {
    const response = await apiClient.get(`${baseUrl}/health`, {
      timeout: 5000,
      headers: { 'User-Agent': USER_AGENT }
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

/**
 * Publishes a component to the API
 * @param {string} baseUrl - API base URL
 * @param {Object} componentData - Component JSON data
 * @returns {Promise<Object>} API response
 */
async function publishComponent(baseUrl, componentData) {
  const url = `${baseUrl}/api/v1/definitions/publish`;
  
  try {
    const response = await apiClient.post(url, componentData, {
      headers: {
        'accept': '*/*',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    let errorMessage = error.message;
    let apiError = null;

    if (error.response) {
      const responseData = error.response.data;

      if (typeof responseData === 'string') {
        errorMessage = responseData;
      } else if (responseData && typeof responseData === 'object') {
        // RFC 7807 Problem Details (detail + status fields)
        if (responseData.detail) {
          errorMessage = responseData.detail;
          apiError = {
            title: responseData.title,
            detail: responseData.detail,
            errors: responseData.errors || null,
            errorCode: responseData.errorCode || null,
            traceId: responseData.traceId || null,
            type: responseData.type || null
          };
        } else if (responseData.error?.message) {
          errorMessage = responseData.error.message;
        } else if (responseData.message) {
          errorMessage = responseData.message;
        } else {
          errorMessage = JSON.stringify(responseData);
        }
      }
    }

    return {
      success: false,
      error: errorMessage,
      statusCode: error.response?.status,
      apiError
    };
  }
}

/**
 * Reinitializes the system
 * @param {string} baseUrl - API base URL
 * @param {string} version - API version
 * @returns {Promise<boolean>} Success status
 */
async function reinitializeSystem(baseUrl, version) {
  const url = `${baseUrl}/api/${version}/definitions/re-initialize`;
  try {
    await apiClient.get(url, { timeout: 10000 });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  testApiConnection,
  publishComponent,
  reinitializeSystem
};

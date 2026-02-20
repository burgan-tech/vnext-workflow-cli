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
      timeout: 5000
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
    // Extract API error details
    let errorMessage = error.message;
    let errorDetails = null;
    
    if (error.response) {
      const responseData = error.response.data;
      
      if (typeof responseData === 'string') {
        errorMessage = responseData;
      } else if (responseData?.error?.message) {
        errorMessage = responseData.error.message;
        errorDetails = responseData.error;
      } else if (responseData?.message) {
        errorMessage = responseData.message;
      } else if (responseData) {
        errorMessage = JSON.stringify(responseData);
      }
    }
    
    return {
      success: false,
      error: errorMessage,
      errorDetails: errorDetails,
      statusCode: error.response?.status
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

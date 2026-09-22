const axios = require('axios');
const https = require('node:https');
const http = require('node:http');
const pkg = require('../../package.json');

// Identifies requests as coming from the CLI (e.g. "vnext-workflow-cli/1.0.0")
const USER_AGENT = `vnext-workflow-cli/${pkg.version}`;

// Create axios instance with custom agents for both HTTP and HTTPS
const apiClient = axios.create({
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({
    rejectUnauthorized: false // Allow self-signed certificates
  }),
  headers: { 'User-Agent': USER_AGENT }
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
 * Signals the runtime that this deployment has finished publishing every component, and returns what
 * its post-deployment hooks did.
 *
 * Called ONCE per command, after the publish loop. Replaces the former
 * `definitions/re-initialize`, which the runtime had reduced to a no-op and has now removed.
 *
 * This is not cosmetic: the runtime's discovery endpoint cache has no TTL, so this call is its only
 * automatic invalidation. A sync that does not make it leaves the runtime resolving cross-domain
 * calls by whatever it learned at startup.
 *
 * The status code is always 200 — a failed hook is reported in the body — so `success` is read from
 * there and the per-hook outcomes are returned for printing.
 *
 * @param {string} baseUrl - API base URL
 * @param {string} version - API version
 * @param {{ packageName?: string, version?: string, domain?: string }} [details] - identification for the runtime's logs
 * @returns {Promise<{success: boolean, hooks: Array<{name: string, outcome: string, message?: string}>, error: string|null}>}
 */
async function publishCompleted(baseUrl, version, details = {}) {
  const url = `${baseUrl}/api/${version}/definitions/publish/completed`;
  try {
    const response = await apiClient.post(url, details, { timeout: 30000 });
    const body = response.data ?? {};
    const hooks = Array.isArray(body.hooks) ? body.hooks : [];

    return {
      success: body.success !== false,
      hooks,
      error: body.success === false ? 'one or more hooks failed' : null
    };
  } catch (error) {
    return {
      success: false,
      hooks: [],
      error: error.response ? `HTTP ${error.response.status}` : error.message
    };
  }
}

module.exports = {
  testApiConnection,
  publishComponent,
  publishCompleted
};

const axios = require('axios');

/**
 * API bağlantısını test eder
 * @param {string} baseUrl - API base URL
 * @returns {Promise<boolean>} Bağlantı durumu
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
 * Komponenti API'ye publish eder
 * @param {string} baseUrl - API base URL
 * @param {Object} componentData - Komponent JSON verisi
 * @returns {Promise<Object>} API response
 */
async function publishComponent(baseUrl, componentData) {
  const url = `${baseUrl}/api/v1/definitions/publish`;
  
  try {
    const response = await axios.post(url, componentData, {
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
    // API hata detaylarını çıkar
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
 * Sistemi yeniden başlatır
 * @param {string} baseUrl - API base URL
 * @param {string} version - API version
 * @returns {Promise<boolean>} Başarı durumu
 */
async function reinitializeSystem(baseUrl, version) {
  const url = `${baseUrl}/api/${version}/definitions/re-initialize`;
  try {
    await axios.get(url, { timeout: 10000 });
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

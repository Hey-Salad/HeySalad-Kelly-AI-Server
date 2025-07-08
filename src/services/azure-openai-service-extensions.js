// src/services/azure-openai-service-extensions.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { logger } = require('../config/logger');

/**
 * Extension methods for the existing AzureOpenAIService
 * These methods can be added to the existing service implementation
 */

/**
 * Analyze an image with vision capabilities (GPT-4 Vision)
 * @param {string} imageUrl - URL of the image to analyze
 * @param {string} prompt - Prompt for image analysis
 * @returns {Promise<string>} Analysis result
 */
async function analyzeVisionContent(imageUrl, prompt) {
  try {
    logger.info('Analyzing image with Azure OpenAI Vision', { 
      imageUrlLength: imageUrl.length, 
      promptLength: prompt.length
    });

    // Get image content as base64 - either from URL or local file
    let imageContent;
    if (imageUrl.startsWith('http')) {
      // Fetch from URL
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      imageContent = Buffer.from(response.data).toString('base64');
    } else if (fs.existsSync(imageUrl)) {
      // Read from file
      imageContent = fs.readFileSync(imageUrl).toString('base64');
    } else {
      throw new Error('Invalid image URL or file path');
    }

    // Prepare request body for GPT-4 Vision API
    const requestBody = {
      messages: [
        { 
          role: "system", 
          content: "You are a helpful kitchen assistant that specializes in identifying ingredients and suggesting recipes." 
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageContent}`
              }
            }
          ]
        }
      ],
      max_tokens: 800,
      temperature: 0.5,
      model: process.env.AZURE_OPENAI_VISION_MODEL || "gpt-4-vision"
    };

    // Make API call
    const response = await axios.post(
      `${this.config.endpoint}/openai/deployments/${process.env.AZURE_OPENAI_VISION_DEPLOYMENT}/chat/completions?api-version=${this.config.apiVersion}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        }
      }
    );

    const analysisText = response.data.choices[0].message.content;
    logger.info('Image analysis completed successfully', { 
      responseLength: analysisText.length 
    });
    
    return analysisText;
  } catch (error) {
    logger.error('Image analysis failed', { 
      error: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data
    });
    throw error;
  }
}

/**
 * Extract structured recipe data from analyzed image
 * @param {string} analysisText - Text from image analysis
 * @returns {Promise<Object>} Structured recipe data
 */
async function extractRecipeFromAnalysis(analysisText) {
  try {
    // Use OpenAI to extract structured data from the analysis
    const extractionPrompt = `
    Extract structured recipe information from this image analysis:
    
    ${analysisText}
    
    Return a JSON object with these fields:
    - ingredients: Array of identified ingredients with estimated quantities
    - possibleRecipes: Array of suggested recipes
    - kitchenTools: Array of identified kitchen tools
    - foodSafetyConcerns: Array of any food safety issues
    - freshness: Object with freshness assessment of ingredients
    
    Format as valid JSON with no explanation.
    `;
    
    const response = await this.chatCompletion(extractionPrompt, {
      systemPrompt: "You are a helpful assistant that extracts structured data from text.",
      temperature: 0.1,
      maxTokens: 500
    });
    
    // Parse JSON from the response
    try {
      const recipeData = JSON.parse(response);
      logger.info('Recipe data extraction successful');
      return recipeData;
    } catch (jsonError) {
      logger.error('Failed to parse extracted recipe data', { 
        error: jsonError.message,
        response
      });
      
      // Fall back to unstructured data
      return {
        ingredients: [],
        possibleRecipes: [],
        rawAnalysis: analysisText
      };
    }
  } catch (error) {
    logger.error('Recipe extraction failed', { error: error.message });
    throw error;
  }
}

/**
 * Upload an image to temporary Azure Blob storage for processing
 * @param {Buffer|string} imageData - Image data or path
 * @returns {Promise<string>} Image URL
 */
async function uploadImageForProcessing(imageData) {
  try {
    // Determine if we're dealing with a file path or buffer
    let imageBuffer;
    if (typeof imageData === 'string' && fs.existsSync(imageData)) {
      imageBuffer = fs.readFileSync(imageData);
    } else if (Buffer.isBuffer(imageData)) {
      imageBuffer = imageData;
    } else if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
      // Handle base64 image string
      const matches = imageData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.*)$/);
      if (matches) {
        imageBuffer = Buffer.from(matches[2], 'base64');
      } else {
        throw new Error('Invalid base64 image format');
      }
    } else {
      throw new Error('Invalid image data format');
    }

    // Create form data
    const formData = new FormData();
    formData.append('image', imageBuffer, {
      filename: `kitchen-image-${Date.now()}.jpg`,
      contentType: 'image/jpeg'
    });

    // Upload to Azure Function temporary storage
    // (This assumes you have an Azure Function set up for temporary image storage)
    const response = await axios.post(
      process.env.AZURE_IMAGE_UPLOAD_URL || 'https://api.kelly.ai.heysalad.app/api/uploadImage',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'x-api-key': process.env.AZURE_IMAGE_UPLOAD_KEY
        }
      }
    );

    logger.info('Image uploaded for processing');
    return response.data.url;
  } catch (error) {
    logger.error('Image upload failed', { error: error.message });
    throw error;
  }
}

/**
 * Get food database information for a specific ingredient
 * @param {string} ingredient - Ingredient name
 * @returns {Promise<Object>} Ingredient information
 */
async function getIngredientInfo(ingredient) {
  try {
    // Use nutrition API to get information
    const response = await axios.get(
      `https://api.edamam.com/api/food-database/v2/parser`,
      {
        params: {
          app_id: process.env.EDAMAM_APP_ID,
          app_key: process.env.EDAMAM_APP_KEY,
          ingr: ingredient,
          nutrition-type: 'cooking'
        }
      }
    );

    if (response.data.hints && response.data.hints.length > 0) {
      // Extract useful information
      const ingredientData = response.data.hints[0].food;
      
      return {
        name: ingredientData.label,
        category: ingredientData.category,
        nutrients: ingredientData.nutrients,
        image: ingredientData.image
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to get ingredient information', { 
      error: error.message,
      ingredient
    });
    
    // Return minimal information
    return {
      name: ingredient,
      error: 'Information not available'
    };
  }
}

/**
 * Generate a voice message for kitchen assistant
 * @param {string} text - Text for speech
 * @param {string} voice - Voice to use (default: en-GB-SoniaNeural)
 * @returns {Promise<string>} Path to audio file
 */
async function generateKitchenVoice(text, voice = 'en-GB-SoniaNeural') {
  try {
    // Add personality to the text
    const enhancedText = addKitchenPersonality(text);
    
    // Use existing TTS function
    return await this.textToSpeech(enhancedText, voice);
  } catch (error) {
    logger.error('Kitchen voice generation failed', { error: error.message });
    throw error;
  }
}

/**
 * Add kitchen personality to text
 * @param {string} text - Original text
 * @returns {string} Enhanced text
 */
function addKitchenPersonality(text) {
  // Check if text already has personality markers
  if (text.includes('💡') || text.includes('🍽️') || text.includes('🧑‍🍳')) {
    return text;
  }
  
  // Random kitchen tips
  const kitchenTips = [
    "💡 Pro tip: Always taste as you go!",
    "💡 Kitchen hack: Keep your knife sharp for safer, more efficient cutting.",
    "💡 Quick tip: Salt your pasta water until it tastes like the sea.",
    "💡 Remember: Let meat rest after cooking to redistribute juices.",
    "💡 Time saver: Prep ingredients before turning on the heat."
  ];
  
  // Add random tip with 30% probability if text is long enough
  if (text.length > 100 && Math.random() < 0.3) {
    const randomTip = kitchenTips[Math.floor(Math.random() * kitchenTips.length)];
    return `${text}\n\n${randomTip}`;
  }
  
  return text;
}

module.exports = {
  analyzeVisionContent,
  extractRecipeFromAnalysis,
  uploadImageForProcessing,
  getIngredientInfo,
  generateKitchenVoice,
  addKitchenPersonality
};

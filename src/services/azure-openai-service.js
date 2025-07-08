// src/services/azure-openai-service.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { 
  SpeechConfig, 
  SpeechSynthesizer, 
  AudioConfig, 
  ResultReason 
} = require('microsoft-cognitiveservices-speech-sdk');

class AzureOpenAIService {
  constructor() {
    // Validate Azure OpenAI credentials
    if (!process.env.AZURE_OPENAI_ENDPOINT || 
        !process.env.AZURE_OPENAI_API_KEY || 
        !process.env.AZURE_SPEECH_KEY ||
        !process.env.AZURE_SPEECH_REGION) {
      throw new Error('Missing Azure configuration');
    }

    // OpenAI configuration
    this.config = {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview',
      assistantId: process.env.AZURE_ASSISTANT_ID
    };

    // Speech configuration
    this.speechConfig = SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY, 
      process.env.AZURE_SPEECH_REGION
    );
  }

  /**
   * Make a direct Azure OpenAI API request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @param {string} [method='POST'] - HTTP method
   * @returns {Promise} API response
   */
  async makeRequest(endpoint, data, method = 'POST') {
    try {
      const response = await axios({
        method,
        url: `${this.config.endpoint}${endpoint}?api-version=${this.config.apiVersion}`,
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        data
      });
      return response.data;
    } catch (error) {
      console.error('Azure OpenAI API request failed:', 
        error.response ? error.response.data : error.message);
      throw error;
    }
  }

  /**
   * Analyze an image
   * @param {string} imageUrl - URL of the image to analyze
   * @returns {Promise} Image analysis result
   */
  async analyzeImage(imageUrl) {
    // Check if image analysis is enabled
    if (process.env.FEATURE_IMAGE_ANALYSIS_ENABLED !== 'true') {
      throw new Error('Image analysis feature is currently disabled');
    }

    try {
      // Fetch image as base64
      const imageResponse = await axios.get(imageUrl, { 
        responseType: 'arraybuffer' 
      });
      const base64Image = Buffer.from(imageResponse.data).toString('base64');

      // Call Azure OpenAI Vision model
      const result = await this.makeRequest('/vision/analyze', {
        image: base64Image,
        features: ['caption', 'objects', 'tags']
      });

      return {
        captions: result.captions || [],
        objects: result.objects || [],
        tags: result.tags || []
      };
    } catch (error) {
      console.error('Image analysis failed:', error);
      throw error;
    }
  }

  /**
   * Convert text to speech
   * @param {string} text - Text to convert
   * @param {string} [voice='en-US-JennyNeural'] - Voice to use
   * @returns {Promise} Path to audio file
   */
  async textToSpeech(text, voice = 'en-US-JennyNeural') {
    // Check if text-to-speech is enabled
    if (process.env.FEATURE_TEXT_TO_SPEECH_ENABLED !== 'true') {
      throw new Error('Text-to-speech feature is currently disabled');
    }

    return new Promise((resolve, reject) => {
      try {
        // Ensure outputs directory exists
        const outputDir = path.join(__dirname, '..', '..', 'outputs');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate unique filename
        const audioFilePath = path.join(outputDir, `speech-${Date.now()}.wav`);

        // Configure speech synthesizer
        this.speechConfig.setSpeechSynthesisVoiceName(voice);
        const audioConfig = AudioConfig.fromAudioFileOutput(audioFilePath);
        const synthesizer = new SpeechSynthesizer(this.speechConfig, audioConfig);

        synthesizer.synthesizeTextAsync(
          text,
          result => {
            if (result.reason === ResultReason.SynthesizingAudioCompleted) {
              console.log('Speech synthesis completed');
              synthesizer.close();
              resolve(audioFilePath);
            } else {
              console.error('Speech synthesis failed:', result.errorDetails);
              synthesizer.close();
              reject(new Error('Speech synthesis failed'));
            }
          },
          error => {
            console.error('Error during speech synthesis:', error);
            synthesizer.close();
            reject(error);
          }
        );
      } catch (error) {
        console.error('Text-to-speech conversion failed:', error);
        reject(error);
      }
    });
  }

  /**
   * Chat with OpenAI Assistant
   * @param {string} message - User message
   * @returns {Promise} Assistant's response
   */
  async chatWithAssistant(message) {
    // Check if AI chat is enabled
    if (process.env.FEATURE_AI_CHAT_ENABLED !== 'true') {
      throw new Error('AI chat feature is currently disabled');
    }

    try {
      // Create a new thread
      const threadResponse = await this.makeRequest('/threads', {});
      
      // Add message to the thread
      const messageResponse = await this.makeRequest(
        `/threads/${threadResponse.id}/messages`, 
        { 
          role: "user", 
          content: message 
        }
      );

      // Create a run with the assistant
      const runResponse = await this.makeRequest(
        `/threads/${threadResponse.id}/runs`, 
        { 
          assistant_id: this.config.assistantId 
        }
      );

      // Poll for run completion
      let run = runResponse;
      let maxAttempts = 10;
      let attempts = 0;

      while (run.status !== 'completed' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        run = await this.makeRequest(
          `/threads/${threadResponse.id}/runs/${run.id}`,
          {},
          'GET'
        );

        attempts++;
      }

      // Retrieve messages
      const messagesResponse = await this.makeRequest(
        `/threads/${threadResponse.id}/messages`,
        {},
        'GET'
      );

      // Find the last assistant message
      const assistantMessages = messagesResponse.data.filter(
        msg => msg.role === 'assistant'
      );

      if (assistantMessages.length > 0) {
        return assistantMessages[0].content[0].text.value;
      }

      throw new Error('No assistant response found');
    } catch (error) {
      console.error('Assistant chat failed:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for a given text
   * @param {string} text - Text to generate embeddings for
   * @returns {Promise} Embeddings
   */
  async generateEmbeddings(text) {
    try {
      const response = await this.makeRequest('/embeddings', {
        input: text,
        model: 'text-embedding-ada-002' // Adjust as needed
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Embedding generation failed:', error);
      throw error;
    }
  }

  /**
   * Perform general chat completion
   * @param {string} message - User message
   * @param {Object} [options={}] - Additional options
   * @returns {Promise} Chat completion response
   */
  async chatCompletion(message, options = {}) {
    try {
      const response = await this.makeRequest('/chat/completions', {
        messages: [
          { role: 'system', content: options.systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: message }
        ],
        max_tokens: options.maxTokens || 300,
        temperature: options.temperature || 0.7
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Chat completion failed:', error);
      throw error;
    }
  }
}

module.exports = new AzureOpenAIService();

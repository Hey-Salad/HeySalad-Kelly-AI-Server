// src/routes/twilio-voice-routes.js
const express = require('express');
const WebSocket = require('ws');
const { logger } = require('../config/logger');
const twilioService = require('../services/twilio-service');
const ghostKitchenService = require('../services/ghost-kitchen-service');

/**
 * Configure routes for Twilio Voice integration
 * @param {Express} app - Express application
 * @param {http.Server} server - HTTP server instance
 */
module.exports = function(app, server) {
  // Route for Twilio incoming calls
  app.all('/incoming-call', (req, res) => {
    try {
      logger.info('Received incoming call request', {
        from: req.body.From,
        to: req.body.To,
        callSid: req.body.CallSid
      });
      
      // Generate TwiML for the call
      const baseUrl = process.env.SERVER_URL || `https://${req.headers.host}`;
      const twiml = ghostKitchenService.generateTwiML(baseUrl);
      
      res.type('text/xml').send(twiml);
    } catch (error) {
      logger.error('Error processing incoming call', { error: error.message });
      
      // Return simple TwiML in case of error
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>We're sorry, but there was an error connecting to the kitchen assistant. Please try your call again later.</Say>
        <Hangup />
      </Response>`;
      
      res.type('text/xml').send(errorTwiml);
    }
  });
  
  // Set up WebSocket server for Twilio Media Streams
  const wss = new WebSocket.Server({ 
    server,
    path: '/media-stream'
  });

  // Track active connections
  const activeConnections = new Map();
  
  wss.on('connection', (ws, req) => {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('New WebSocket connection for media streaming', { connectionId });
    
    // Initialize connection state
    const connectionState = {
      id: connectionId,
      connected: true,
      streamSid: null,
      audioBuffers: [],
      textBuffer: ''
    };
    
    activeConnections.set(connectionId, connectionState);
    
    // Set up integration with OpenAI Realtime API for voice processing
    setupOpenAIRealtimeClient(ws, connectionState);
    
    // Handle WebSocket connection close
    ws.on('close', () => {
      logger.info('WebSocket connection closed', { connectionId });
      
      // Clean up and close any open connections
      const connection = activeConnections.get(connectionId);
      if (connection && connection.openaiWs) {
        if (connection.openaiWs.readyState === WebSocket.OPEN) {
          connection.openaiWs.close();
        }
      }
      
      activeConnections.delete(connectionId);
    });
    
    // Handle WebSocket errors
    ws.on('error', (error) => {
      logger.error('WebSocket error', { 
        connectionId, 
        error: error.message 
      });
    });
    
    // Start stream after connection
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle different message types
        switch (data.event) {
          case 'start':
            // Stream has started
            connectionState.streamSid = data.start.streamSid;
            logger.info('Media stream started', { 
              connectionId, 
              streamSid: connectionState.streamSid 
            });
            break;
            
          case 'media':
            // Forward media to OpenAI Realtime
            if (connectionState.openaiWs && 
                connectionState.openaiWs.readyState === WebSocket.OPEN) {
              // Send audio to OpenAI
              forwardAudioToOpenAI(connectionState, data.media.payload);
            }
            break;
            
          case 'stop':
            // Stream has stopped
            logger.info('Media stream stopped', { 
              connectionId, 
              streamSid: connectionState.streamSid 
            });
            break;
            
          default:
            logger.info('Received unknown event type', { 
              connectionId, 
              event: data.event 
            });
        }
      } catch (error) {
        logger.error('Error processing WebSocket message', { 
          connectionId, 
          error: error.message 
        });
      }
    });
  });
  
  /**
   * Set up the OpenAI Realtime WebSocket client
   * @param {WebSocket} twilioWs - Twilio WebSocket connection
   * @param {Object} connectionState - Connection state object
   */
  function setupOpenAIRealtimeClient(twilioWs, connectionState) {
    try {
      // Create OpenAI Realtime WebSocket connection
      const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });
      
      // Store reference in connection state
      connectionState.openaiWs = openaiWs;
      
      // OpenAI connection opened
      openaiWs.on('open', () => {
        logger.info('Connected to OpenAI Realtime API', { connectionId: connectionState.id });
        
        // Send session update to initialize the conversation
        setTimeout(() => {
          const sessionUpdate = {
            type: 'session.update',
            session: {
              turn_detection: { type: 'server_vad' },
              input_audio_format: 'g711_ulaw',
              output_audio_format: 'g711_ulaw',
              voice: 'shimmer',
              instructions: ghostKitchenService.systemPrompt,
              modalities: ["text", "audio"],
              temperature: 0.8,
            }
          };
          
          openaiWs.send(JSON.stringify(sessionUpdate));
          logger.info('Sent session update to OpenAI', { connectionId: connectionState.id });
        }, 250);
      });
      
      // Handle messages from OpenAI
      openaiWs.on('message', (data) => {
        try {
          const response = JSON.parse(data);
          
          // Log important events
          if (['response.content.done', 'rate_limits.updated', 'response.done',
               'input_audio_buffer.committed', 'input_audio_buffer.speech_stopped',
               'input_audio_buffer.speech_started', 'session.created'].includes(response.type)) {
            logger.info(`Received event: ${response.type}`, { connectionId: connectionState.id });
          }
          
          // Handle session update response
          if (response.type === 'session.updated') {
            logger.info('Session updated successfully', { connectionId: connectionState.id });
          }
          
          // Handle audio response
          if (response.type === 'response.audio.delta' && response.delta) {
            // Forward audio to Twilio
            const audioDelta = {
              event: 'media',
              streamSid: connectionState.streamSid,
              media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
            };
            
            twilioWs.send(JSON.stringify(audioDelta));
          }
          
          // Handle text response for logging
          if (response.type === 'response.content.delta' && response.delta && response.delta.value) {
            // Accumulate text content
            connectionState.textBuffer += response.delta.value;
            
            // Log complete responses when we detect end of sentence
            if (response.delta.value.match(/[.!?]\s*$/)) {
              logger.info('AI response', { 
                connectionId: connectionState.id,
                text: connectionState.textBuffer.trim()
              });
            }
          }
        } catch (error) {
          logger.error('Error processing OpenAI message', { 
            connectionId: connectionState.id,
            error: error.message
          });
        }
      });
      
      // Handle WebSocket close
      openaiWs.on('close', () => {
        logger.info('Disconnected from OpenAI Realtime API', { 
          connectionId: connectionState.id
        });
      });
      
      // Handle WebSocket errors
      openaiWs.on('error', (error) => {
        logger.error('Error in OpenAI WebSocket', { 
          connectionId: connectionState.id,
          error: error.message
        });
      });
    } catch (error) {
      logger.error('Failed to set up OpenAI Realtime client', { 
        connectionId: connectionState.id,
        error: error.message
      });
    }
  }
  
  /**
   * Forward audio data to OpenAI
   * @param {Object} connectionState - Connection state
   * @param {string} audioBase64 - Base64 encoded audio data
   */
  function forwardAudioToOpenAI(connectionState, audioBase64) {
    try {
      if (connectionState.openaiWs && 
          connectionState.openaiWs.readyState === WebSocket.OPEN) {
        
        // Create append message
        const audioAppend = {
          type: 'input_audio_buffer.append',
          audio: audioBase64
        };
        
        // Send to OpenAI
        connectionState.openaiWs.send(JSON.stringify(audioAppend));
      }
    } catch (error) {
      logger.error('Error forwarding audio to OpenAI', { 
        connectionId: connectionState.id,
        error: error.message
      });
    }
  }
  
  // Additional endpoint for Twilio SMS webhook
  app.post('/twilio/sms-webhook', async (req, res) => {
    try {
      const { Body, From, To, MessageSid } = req.body;
      
      logger.info('Received SMS webhook', { 
        from: From, 
        to: To, 
        body: Body, 
        messageSid: MessageSid 
      });
      
      // Process message with ghost kitchen service
      let responseMessage = 'Thank you for your message! I\'ll help you with your kitchen request.';
      
      if (Body.toLowerCase().includes('recipe')) {
        // Parse ingredients from message
        const ingredients = parseIngredientsFromMessage(Body);
        
        if (ingredients.length > 0) {
          // Generate recipe
          const recipe = await ghostKitchenService.generateRecipe(ingredients);
          
          responseMessage = `I've created a recipe for ${recipe.title} using your ingredients! Check it out at: ${process.env.SERVER_URL}/recipe/${recipe.id}`;
        } else {
          responseMessage = 'I\'d be happy to create a recipe for you! Please list the ingredients you have available.';
        }
      } else if (Body.toLowerCase().includes('help')) {
        responseMessage = 'HeySalad Kitchen Assistant Commands:\n' +
                         '- "recipe [ingredients]" - Generate a recipe with your ingredients\n' +
                         '- "tip" - Get a random cooking tip\n' +
                         '- "call me" - Request a phone call from our kitchen assistant';
      } else if (Body.toLowerCase().includes('tip')) {
        const tips = [
          "Always taste as you go! Seasoning gradually builds better flavor.",
          "Keep your knife sharp - it's actually safer than a dull one.",
          "Pat meat dry before searing for better browning.",
          "Rest your meat after cooking to redistribute the juices.",
          "Save vegetable scraps in the freezer for homemade stock."
        ];
        responseMessage = tips[Math.floor(Math.random() * tips.length)];
      } else if (Body.toLowerCase().includes('call me')) {
        // Initiate a call to the user
        await twilioService.makeCall(
          From,
          `${process.env.SERVER_URL}/outgoing-call-twiml`
        );
        
        responseMessage = "I'm calling you now to help with your kitchen questions.";
      }
      
      // Send response via Twilio
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMessage}</Message></Response>`;
      res.type('text/xml').send(twiml);
      
    } catch (error) {
      logger.error('Error processing SMS webhook', { error: error.message });
      
      // Send generic response
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>I'm sorry, there was an error processing your message. Please try again later.</Message></Response>`;
      res.type('text/xml').send(twiml);
    }
  });
  
  // TwiML for outgoing calls
  app.get('/outgoing-call-twiml', (req, res) => {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Hello! This is Kelly, your HeySalad kitchen assistant. How can I help you with your cooking today?</Say>
      <Gather input="speech" timeout="5" action="${process.env.SERVER_URL}/gather-response">
        <Say>Please tell me what you're looking to make, or what ingredients you have available.</Say>
      </Gather>
    </Response>`;
    
    res.type('text/xml').send(twiml);
  });
  
  // Handle gathered speech input
  app.post('/gather-response', async (req, res) => {
    try {
      const speechResult = req.body.SpeechResult;
      
      logger.info('Received speech input', { speechResult });
      
      // Process with ghost kitchen service
      let responseText = "I'm sorry, I didn't catch that. Let me know what ingredients you have, and I can suggest a recipe.";
      
      if (speechResult) {
        if (speechResult.toLowerCase().includes('recipe') || 
            speechResult.toLowerCase().includes('make') ||
            speechResult.toLowerCase().includes('cook')) {
          // Extract ingredients and generate recipe suggestion
          const ingredients = parseIngredientsFromMessage(speechResult);
          
          if (ingredients.length > 0) {
            responseText = `Great! With ${ingredients.join(', ')}, you could make a delicious dish. ` +
                          `I recommend trying a simple ${suggestRecipeFromIngredients(ingredients)}. ` +
                          `Would you like more details on how to prepare this?`;
          } else {
            responseText = "I'd be happy to suggest a recipe! What ingredients do you have available?";
          }
        } else {
          // Generic response based on speech
          responseText = "Thanks for sharing that. I'm your kitchen assistant, and I can help with recipes and cooking tips. What would you like to cook today?";
        }
      }
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>${responseText}</Say>
        <Gather input="speech" timeout="5" action="${process.env.SERVER_URL}/gather-response">
          <Say>Please continue with more details, or say goodbye to end the call.</Say>
        </Gather>
        <Say>I didn't hear anything. Goodbye!</Say>
        <Hangup />
      </Response>`;
      
      res.type('text/xml').send(twiml);
      
    } catch (error) {
      logger.error('Error processing speech input', { error: error.message });
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>I'm sorry, I encountered an error. Please call back later.</Say>
        <Hangup />
      </Response>`;
      
      res.type('text/xml').send(twiml);
    }
  });
  
  /**
   * Parse ingredients from a message
   * @param {string} message - User message
   * @returns {Array} Extracted ingredients
   */
  function parseIngredientsFromMessage(message) {
    // Basic parsing logic - extract comma or space-separated items after trigger words
    const ingredientSections = message.match(/(?:with|using|have|got|ingredients?:?)(.+)/i);
    
    if (ingredientSections && ingredientSections[1]) {
      // Split by commas or 'and'
      return ingredientSections[1]
        .split(/,|\sand\s|&/)
        .map(item => item.trim())
        .filter(item => item.length > 2 && !item.match(/^(the|a|an|some|few|my|little)$/i));
    }
    
    // Fallback: try to extract any food items using common food words
    const foodTerms = message.match(/\b(chicken|beef|pork|fish|rice|pasta|potato|tomato|cheese|onion|garlic|carrot|pepper|egg|milk|butter|oil|flour|sugar|salt|vegetable|fruit|apple|banana|meat|bread|bean|lentil|mushroom|spinach|cabbage|lettuce)\b/ig);
    
    return foodTerms ? [...new Set(foodTerms.map(term => term.toLowerCase()))] : [];
  }
  
  /**
   * Suggest a simple recipe based on ingredients
   * @param {Array} ingredients - Available ingredients
   * @returns {string} Recipe suggestion
   */
  function suggestRecipeFromIngredients(ingredients) {
    // Simple hard-coded suggestions based on ingredient combinations
    const ing = ingredients.map(i => i.toLowerCase());
    
    if (ing.some(i => i.includes('pasta') || i.includes('spaghetti')) &&
        ing.some(i => i.includes('tomato'))) {
      return "classic pasta with tomato sauce";
    }
    
    if (ing.some(i => i.includes('rice')) && 
        ing.some(i => i.includes('vegetable'))) {
      return "vegetable rice bowl";
    }
    
    if (ing.some(i => i.includes('chicken'))) {
      return "herb-roasted chicken";
    }
    
    if (ing.some(i => i.includes('egg'))) {
      return "fluffy omelette";
    }
    
    if (ing.some(i => i.includes('potato'))) {
      return "crispy roasted potatoes";
    }
    
    // Generic fallback
    return "simple stir-fry with your ingredients";
  }
};

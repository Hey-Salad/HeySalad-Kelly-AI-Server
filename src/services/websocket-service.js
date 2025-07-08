// src/services/websocket-service.js
const WebSocket = require('ws');
const { logger } = require('../config/logger');

class WebSocketService {
  constructor(server) {
    // WebSocket server for camera streams
    this.wss = new WebSocket.Server({ server });
    
    // Store active connections
    this.clients = new Set();
    
    // Setup WebSocket event handlers
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.wss.on('connection', (ws, req) => {
      // Extract device/client identifier from connection
      const deviceId = this.extractDeviceId(req);
      
      // Log new connection
      logger.info(`New WebSocket connection from device: ${deviceId}`, {
        deviceId,
        remoteAddress: req.socket.remoteAddress
      });

      // Add to active clients
      this.clients.add(ws);

      // Handle incoming messages
      ws.on('message', (message) => {
        this.handleIncomingMessage(ws, message, deviceId);
      });

      // Handle connection closure
      ws.on('close', () => {
        logger.info(`WebSocket connection closed for device: ${deviceId}`);
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error(`WebSocket error for device: ${deviceId}`, { 
          error: error.message 
        });
      });
    });
  }

  /**
   * Extract device identifier from connection request
   * @param {Object} req - Connection request
   * @returns {string} Device identifier
   */
  extractDeviceId(req) {
    // Extract device ID from query parameters or headers
    const url = new URL(`http://dummy.com${req.url}`);
    return url.searchParams.get('deviceId') || 'unknown';
  }

  /**
   * Handle incoming WebSocket messages
   * @param {WebSocket} ws - WebSocket connection
   * @param {Buffer|string} message - Incoming message
   * @param {string} deviceId - Device identifier
   */
  handleIncomingMessage(ws, message, deviceId) {
    try {
      // Log incoming message
      logger.info(`Received message from device: ${deviceId}`, {
        deviceId,
        messageLength: message.length,
        messageType: typeof message
      });

      // Parse message (assuming JSON)
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(message.toString());
      } catch (parseError) {
        logger.warn(`Failed to parse message from ${deviceId}`, { 
          error: parseError.message,
          rawMessage: message.toString()
        });
        return;
      }

      // Handle different message types
      switch (parsedMessage.type) {
        case 'camera_frame':
          this.handleCameraFrame(parsedMessage, deviceId);
          break;
        case 'device_status':
          this.handleDeviceStatus(parsedMessage, deviceId);
          break;
        default:
          logger.warn(`Unknown message type from ${deviceId}`, { 
            messageType: parsedMessage.type 
          });
      }
    } catch (error) {
      logger.error(`Error processing WebSocket message from ${deviceId}`, { 
        error: error.message 
      });
    }
  }

  /**
   * Handle camera frame from ESP32
   * @param {Object} message - Camera frame message
   * @param {string} deviceId - Device identifier
   */
  handleCameraFrame(message, deviceId) {
    // Process and potentially store or forward camera frame
    logger.info(`Received camera frame from ${deviceId}`, {
      frameSize: message.data ? message.data.length : 'unknown',
      timestamp: new Date().toISOString()
    });

    // Optional: Broadcast to other clients, save to storage, etc.
    this.broadcastFrame(message.data, deviceId);
  }

  /**
   * Handle device status update
   * @param {Object} message - Device status message
   * @param {string} deviceId - Device identifier
   */
  handleDeviceStatus(message, deviceId) {
    logger.info(`Device status update from ${deviceId}`, {
      status: message.status,
      battery: message.battery,
      timestamp: new Date().toISOString()
    });

    // Optional: Store device status, trigger alerts, etc.
  }

  /**
   * Broadcast camera frame to all connected clients
   * @param {Buffer} frame - Camera frame data
   * @param {string} originDevice - Device that sent the frame
   */
  broadcastFrame(frame, originDevice) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'camera_frame',
          deviceId: originDevice,
          data: frame.toString('base64')
        }));
      }
    });
  }

  /**
   * Broadcast a message to all connected clients
   * @param {Object} message - Message to broadcast
   */
  broadcast(message) {
    const messageString = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    });
  }
}

module.exports = WebSocketService;

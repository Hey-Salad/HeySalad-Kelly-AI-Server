const express = require('express');
const router = express.Router();
const WebSocket = require('ws');

// Global WebSocket client tracking
global.websocketClients = new Set();

module.exports = (app, wss) => {
  // Store WebSocket server reference
  global.wss = wss;

  // Track clients
  wss.on('connection', (ws, req) => {
    // Add client to global set
    global.websocketClients.add(ws);
    
    // Assign a unique ID to this client
    ws.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    // Remove client when connection closes
    ws.on('close', () => {
      global.websocketClients.delete(ws);
    });
  });

  // API endpoint to get WebSocket client information
  app.get('/api/websocket/clients', (req, res) => {
    const clients = Array.from(global.websocketClients).map((client, index) => {
      return {
        id: client.id || index,
        readyState: client.readyState,
        ip: client._socket ? client._socket.remoteAddress : 'unknown'
      };
    });

    res.json({
      totalClients: clients.length,
      clients: clients
    });
  });
};

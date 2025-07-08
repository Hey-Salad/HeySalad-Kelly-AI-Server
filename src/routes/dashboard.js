// src/routes/dashboard.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const v8 = require('v8');

// Simulated log storage (in a real app, use a proper logging system)
const logStore = [];

module.exports = (app) => {
  // Serve the dashboard HTML
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'dashboard.html'));
  });

  // Comprehensive server metrics endpoint
  app.get('/api/server/metrics', (req, res) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    res.json({
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      platform: {
        os: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname()
      },
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem()
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0].model,
        speed: os.cpus()[0].speed
      },
      v8: {
        heapStatistics: v8.getHeapStatistics(),
        heapSpaceStatistics: v8.getHeapSpaceStatistics()
      }
    });
  });

  // Debug information endpoint
  app.get('/api/server/debug', (req, res) => {
    res.json({
      environment: process.env.NODE_ENV,
      versions: process.versions,
      config: {
        twilioEnabled: process.env.FEATURE_SMS_ENABLED === 'true',
        aiChatEnabled: process.env.FEATURE_AI_CHAT_ENABLED === 'true',
        imageAnalysisEnabled: process.env.FEATURE_IMAGE_ANALYSIS_ENABLED === 'true',
        textToSpeechEnabled: process.env.FEATURE_TEXT_TO_SPEECH_ENABLED === 'true'
      },
      system: {
        arch: os.arch(),
        platform: os.platform(),
        release: os.release(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem()
      }
    });
  });

  // Simulated logs endpoint
  app.get('/api/server/logs', (req, res) => {
    // In a real application, this would pull from your logging system
    res.json(logStore.slice(-50)); // Return last 50 logs
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    const checks = {
      database: { status: 'not implemented' },
      twilio: { status: 'not implemented' },
      azureOpenAI: { status: 'not implemented' },
      websockets: { 
        status: 'ok',
        connectedClients: global.websocketClients ? global.websocketClients.size : 0
      }
    };

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks
    });
  });

  // Endpoint to trigger a simulated log
  app.post('/api/log', (req, res) => {
    const { message, level = 'info' } = req.body;
    const logEntry = {
      timestamp: new Date().toISOString(),
      message,
      level
    };
    
    logStore.push(logEntry);
    
    // Limit log store size
    if (logStore.length > 1000) {
      logStore.shift();
    }

    res.json({ success: true, log: logEntry });
  });
};

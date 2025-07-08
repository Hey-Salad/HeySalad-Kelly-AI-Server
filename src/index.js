// src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Port management utility
const { findAvailablePort } = require('./utils/port-manager');

// Services and Middleware
const twilioService = require('./services/twilio-service');
const azureOpenAIService = require('./services/azure-openai-service');
const WebSocketService = require('./services/websocket-service');
const { generalLimiter } = require('./middleware/rate-limiter');
const { logger, requestLoggerMiddleware } = require('./config/logger');

const app = express();
const server = http.createServer(app);
const BASE_PORT = parseInt(process.env.PORT || 3000);

// Ensure public directory exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Ensure uploads directory exists for camera photos
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(path.join(uploadsDir, 'photos'), { recursive: true });
}

// Middleware
app.use(cors());
app.use(generalLimiter);

// Special handling for Stripe webhooks (needs raw body)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Regular JSON middleware for other routes
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLoggerMiddleware);

// Serve static files
app.use('/static', express.static(publicDir));
app.use('/outputs', express.static(path.join(__dirname, '..', 'outputs')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Serve dashboard HTML
app.get('/', (req, res) => {
  const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
  
  // Ensure dashboard exists
  if (!fs.existsSync(dashboardPath)) {
    const defaultDashboard = `
    <!DOCTYPE html>
    <html>
    <head><title>HeySalad Kelly Server</title></head>
    <body>
      <h1>HeySalad Kelly Server Dashboard</h1>
      <p>Dashboard not found. Please create dashboard.html in src/public.</p>
      <p>🔥 Stripe Integration: ${process.env.STRIPE_SECRET_KEY ? '✅ Configured' : '❌ Not Configured'}</p>
      <p>🔥 Firebase: ${process.env.FIREBASE_PROJECT_ID ? '✅ Configured' : '❌ Not Configured'}</p>
    </body>
    </html>
    `;
    fs.writeFileSync(dashboardPath, defaultDashboard);
  }

  res.sendFile(dashboardPath);
});

// Initialize WebSocket Service
const wsService = new WebSocketService(server);

// Load existing routes
require('./routes/dashboard')(app);
require('./routes/camera-routes')(app); // Add camera routes
require('./routes/sms-routes')(app);    // Add SMS routes if present

// Load Stripe routes (NEW)
try {
  require('./routes/stripe-routes')(app);
  logger.info('✅ Stripe routes loaded successfully');
} catch (error) {
  logger.error('❌ Failed to load Stripe routes', { error: error.message });
}

// Twilio SMS route
app.post('/send-sms', async (req, res) => {
  try {
    const { to, body } = req.body;
    const message = await twilioService.sendSMS(to, body);
    res.json({ success: true, messageSid: message.sid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Azure OpenAI routes
app.post('/analyze-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    const analysis = await azureOpenAIService.analyzeImage(imageUrl);
    res.json({ success: true, analysis });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/text-to-speech', async (req, res) => {
  try {
    const { text, voice } = req.body;
    const audioFilePath = await azureOpenAIService.textToSpeech(text, voice);
    
    // Return the URL to access the audio file
    const audioFileName = path.basename(audioFilePath);
    const audioUrl = `/outputs/${audioFileName}`;
    
    res.json({
      success: true,
      audioUrl,
      fullPath: audioFilePath
    });
  } catch (error) {
    logger.error('Text-to-speech conversion failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// System Information Routes
app.get('/api/system/info', (req, res) => {
  res.json({
    platform: {
      type: os.type(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname()
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem()
    },
    cpus: os.cpus(),
    integrations: {
      stripe: !!process.env.STRIPE_SECRET_KEY,
      firebase: !!process.env.FIREBASE_PROJECT_ID,
      twilio: !!process.env.TWILIO_ACCOUNT_SID,
      azure: !!process.env.AZURE_OPENAI_ENDPOINT
    }
  });
});

// Health check endpoint for Stripe integration
app.get('/api/stripe/health', (req, res) => {
  const isConfigured = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  res.json({
    success: true,
    configured: isConfigured,
    environment: process.env.NODE_ENV,
    webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET
  });
});

// WebSocket API status
app.get('/api/websocket/status', (req, res) => {
  const clientCount = wsService.clients ? wsService.clients.size : 0;
  const cameraCount = wsService.cameraDevices ? wsService.cameraDevices.size : 0;
  
  res.json({
    success: true,
    status: {
      totalClients: clientCount,
      cameraDevices: cameraCount,
      uptime: process.uptime()
    }
  });
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'The requested endpoint does not exist'
  });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack 
  });

  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start the server with dynamic port selection
async function startServer() {
  try {
    const PORT = await findAvailablePort(BASE_PORT);
    
    server.listen(PORT, '0.0.0.0', () => {
      const ipAddress = getServerIpAddress();
      const serverAddress = `http://${ipAddress}:${PORT}`;
      const publicAddress = 'https://api.kelly.ai.heysalad.app';
      
      logger.info(`
  ╔═══════════════════════════════════════════════╗
  ║ HeySalad Kelly Server with Stripe             ║
  ║ ----------------------------------------      ║
  ║ Status: 🟢 Running                            ║
  ║ Port: ${PORT}                                 ║
  ║ Local: ${serverAddress}                       ║
  ║ Public: ${publicAddress}                      ║
  ║ Environment: ${process.env.NODE_ENV}          ║
  ║                                               ║
  ║ Integrations:                                 ║
  ║ 💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌'}                           ║
  ║ 🔥 Firebase: ${process.env.FIREBASE_PROJECT_ID ? '✅' : '❌'}                      ║
  ║ 📱 Twilio: ${process.env.TWILIO_ACCOUNT_SID ? '✅' : '❌'}                        ║
  ║ 🤖 Azure AI: ${process.env.AZURE_OPENAI_ENDPOINT ? '✅' : '❌'}                   ║
  ╚═══════════════════════════════════════════════╝
      `, {
        port: PORT,
        environment: process.env.NODE_ENV,
        local: serverAddress,
        public: publicAddress,
        integrations: {
          stripe: !!process.env.STRIPE_SECRET_KEY,
          firebase: !!process.env.FIREBASE_PROJECT_ID,
          twilio: !!process.env.TWILIO_ACCOUNT_SID,
          azure: !!process.env.AZURE_OPENAI_ENDPOINT
        }
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Function to get server's IP address
function getServerIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Graceful Shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server stopped');
    process.exit(0);
  });
});

// Call the async function
startServer();

module.exports = { app, server };
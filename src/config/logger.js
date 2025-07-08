// src/config/logger.js
const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');

// Ensure logs directory exists
const logDir = path.join(__dirname, '..', '..', 'logs');

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create a logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'heysalad-kelly-server' },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} ${level}: ${message}${stack ? `\n${stack}` : ''}`;
        })
      )
    }),
    
    // File transport for error logs
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d'
    }),
    
    // File transport for combined logs
    new DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
});

// Add request logging middleware
const requestLoggerMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Log the original request details
  logger.info(`[REQUEST] ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    body: req.body,
    query: req.query,
    headers: req.headers
  });

  // Override res.send to log response
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - startTime;
    
    // Log response details
    logger.info(`[RESPONSE] ${req.method} ${req.url}`, {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      responseBody: body
    });

    originalSend.call(this, body);
  };

  next();
};

module.exports = {
  logger,
  requestLoggerMiddleware
};

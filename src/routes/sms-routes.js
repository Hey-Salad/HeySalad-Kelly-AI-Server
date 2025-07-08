const express = require('express');
const router = express.Router();
const twilioService = require('../services/twilio-service');
const { logger } = require('../config/logger');
const { strictLimiter } = require('../middleware/rate-limiter');

module.exports = (app) => {
  // Apply strict rate limiting to SMS endpoints
  app.use('/api/sms', strictLimiter);
  
  // Send SMS endpoint
  app.post('/api/sms/send', async (req, res) => {
    try {
      const { to, body, template, variables } = req.body;
      
      // Validate required fields
      if (!to) {
        return res.status(400).json({
          success: false,
          error: 'Missing recipient phone number',
          message: 'The "to" field is required'
        });
      }
      
      // If template is provided, use template message
      if (template) {
        const message = await twilioService.sendTemplateMessage(to, template, variables || {});
        return res.json({
          success: true,
          messageSid: message.sid,
          status: message.status,
          direction: message.direction,
          from: message.from,
          to: message.to,
          dateCreated: message.dateCreated
        });
      }
      
      // Otherwise, require message body
      if (!body) {
        return res.status(400).json({
          success: false,
          error: 'Missing message body',
          message: 'Either "body" or "template" is required'
        });
      }
      
      // Send SMS with provided body
      const message = await twilioService.sendSMS(to, body);
      
      res.json({
        success: true,
        messageSid: message.sid,
        status: message.status,
        direction: message.direction,
        from: message.from,
        to: message.to,
        dateCreated: message.dateCreated
      });
    } catch (error) {
      logger.error('SMS sending failed via API', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        message: error.message
      });
    }
  });
  
  // Get SMS status endpoint
  app.get('/api/sms/status/:messageSid', async (req, res) => {
    try {
      const { messageSid } = req.params;
      
      const message = await twilioService.getMessageStatus(messageSid);
      
      res.json({
        success: true,
        messageSid: message.sid,
        status: message.status,
        direction: message.direction,
        from: message.from,
        to: message.to,
        body: message.body,
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage
      });
    } catch (error) {
      logger.error('Failed to get SMS status', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get SMS status',
        message: error.message
      });
    }
  });
  
  // Webhook to receive Twilio status callbacks
  app.post('/api/sms/webhook', (req, res) => {
    try {
      const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
      
      logger.info('Received SMS status webhook', {
        messageSid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage
      });
      
      // Send a valid TwiML response
      res.set('Content-Type', 'text/xml');
      res.send('<Response></Response>');
    } catch (error) {
      logger.error('Error in SMS webhook handler', { error: error.message });
      res.status(500).set('Content-Type', 'text/xml').send('<Response></Response>');
    }
  });
};

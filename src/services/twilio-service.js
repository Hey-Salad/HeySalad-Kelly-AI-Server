const twilio = require('twilio');
const { logger } = require('../config/logger');

class TwilioService {
  constructor() {
    // Validate Twilio credentials
    if (!process.env.TWILIO_ACCOUNT_SID || 
        !process.env.TWILIO_AUTH_TOKEN || 
        !process.env.TWILIO_PHONE_NUMBER) {
      throw new Error('Missing Twilio configuration');
    }

    // Initialize Twilio client
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID, 
      process.env.TWILIO_AUTH_TOKEN
    );
    
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER; // US Number: +16503340124
    this.ukPhoneNumber = "+447575666521"; // UK Number for UK recipients
  }

  /**
   * Send an SMS message with appropriate sender number based on recipient
   * @param {string} to - Recipient's phone number
   * @param {string} body - Message body
   * @param {object} options - Additional options
   * @returns {Promise} Twilio message object
   */
  async sendSMS(to, body, options = {}) {
    try {
      logger.info(`Sending SMS to ${to}`, { to, bodyLength: body.length });
      
      // Determine appropriate sender number based on recipient
      // Use UK number for UK recipients (numbers starting with +44)
      const from = to.startsWith('+44') ? this.ukPhoneNumber : this.phoneNumber;
      
      logger.info(`Using sender number ${from} for recipient ${to}`);
      
      const message = await this.client.messages.create({
        body: body,
        from: from,
        to: to,
        ...options
      });
      
      logger.info(`SMS sent successfully to ${to}`, { 
        messageSid: message.sid, 
        status: message.status 
      });
      
      return message;
    } catch (error) {
      logger.error(`SMS sending failed to ${to}`, { 
        error: error.message, 
        errorCode: error.code, 
        statusCode: error.status 
      });
      throw error;
    }
  }

  /**
   * Make a phone call
   * @param {string} to - Recipient's phone number
   * @param {string} twimlUrl - URL of TwiML instructions for the call
   * @param {object} options - Additional options
   * @returns {Promise} Twilio call object
   */
  async makeCall(to, twimlUrl, options = {}) {
    try {
      logger.info(`Initiating call to ${to}`, { to, twimlUrl });
      
      // Determine appropriate caller number based on recipient
      const from = to.startsWith('+44') ? this.ukPhoneNumber : this.phoneNumber;
      
      const call = await this.client.calls.create({
        url: twimlUrl,
        from: from,
        to: to,
        ...options
      });
      
      logger.info(`Call initiated to ${to}`, { callSid: call.sid });
      
      return call;
    } catch (error) {
      logger.error(`Call initiation failed to ${to}`, { 
        error: error.message, 
        errorCode: error.code 
      });
      throw error;
    }
  }

  /**
   * Get information about a message
   * @param {string} messageSid - The SID of the message
   * @returns {Promise} Message details
   */
  async getMessageStatus(messageSid) {
    try {
      return await this.client.messages(messageSid).fetch();
    } catch (error) {
      logger.error(`Failed to get message status for ${messageSid}`, { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Send a pre-formatted template message
   * @param {string} to - Recipient's phone number
   * @param {string} templateName - Name of the template to use
   * @param {object} variables - Template variables
   * @returns {Promise} Twilio message object
   */
  async sendTemplateMessage(to, templateName, variables = {}) {
    const templates = {
      welcome: "Welcome to HeySalad! Your device is ready to use.",
      alert: "ALERT: Your HeySalad ® Device has detected unusual activity.",
      deviceReady: "Your HeySalad ® Device is ready"
    };
    
    const template = templates[templateName] || templates.welcome;
    
    // Apply template variables
    let body = template;
    for (const [key, value] of Object.entries(variables)) {
      body = body.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    
    return await this.sendSMS(to, body);
  }
}

module.exports = new TwilioService();

module.exports = {
  apps: [{
    name: "heysalad-kelly-server",
    script: "./src/index.js",
    watch: false,
    instances: 1,
    exec_mode: "fork",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      LOG_LEVEL: "info",

      // These are now read from .env file
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,

      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
      AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
      AZURE_ASSISTANT_ID: process.env.AZURE_ASSISTANT_ID,

      AZURE_SPEECH_KEY: process.env.AZURE_SPEECH_KEY,
      AZURE_SPEECH_REGION: process.env.AZURE_SPEECH_REGION,

      FEATURE_SMS_ENABLED: process.env.FEATURE_SMS_ENABLED,
      FEATURE_CALL_ENABLED: process.env.FEATURE_CALL_ENABLED,
      FEATURE_AI_CHAT_ENABLED: process.env.FEATURE_AI_CHAT_ENABLED,
      FEATURE_IMAGE_ANALYSIS_ENABLED: process.env.FEATURE_IMAGE_ANALYSIS_ENABLED,
      FEATURE_TEXT_TO_SPEECH_ENABLED: process.env.FEATURE_TEXT_TO_SPEECH_ENABLED
    },
    env_development: {
      NODE_ENV: "development",
      PORT: 3000
    },
    env_production: {
      NODE_ENV: "production",
      PORT: 80
    }
  }]
}
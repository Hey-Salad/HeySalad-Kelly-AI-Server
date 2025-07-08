# HeySalad Kelly AI Server

## Overview
HeySalad Kelly AI Server is a comprehensive server solution providing AI-powered services, WebSocket communication, and real-time monitoring capabilities.

## Features
- Twilio SMS and Call Integration
- Azure OpenAI Services
- WebSocket Real-time Communication
- Server Metrics Dashboard
- Image Analysis
- Text-to-Speech Conversion

## Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)
- Azure Account
- Twilio Account
- Azure OpenAI Account

## Installation

### 1. Clone the Repository
```bash
git clone https://github.com/Hey-Salad/HeySalad-Kelly-AI-Server.git
cd HeySalad-Kelly-AI-Server
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the project root with the following variables:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Twilio Credentials
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_API_VERSION=2024-05-01-preview
AZURE_ASSISTANT_ID=your_azure_assistant_id

# Azure Speech Services
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=eastus

# Feature Flags
FEATURE_SMS_ENABLED=true
FEATURE_CALL_ENABLED=true
FEATURE_AI_CHAT_ENABLED=true
FEATURE_IMAGE_ANALYSIS_ENABLED=true
FEATURE_TEXT_TO_SPEECH_ENABLED=true
```

### 4. Running the Server

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm start
```

## Azure Deployment

### Initial Setup
1. Create an Azure Virtual Machine
   - Choose Ubuntu Server LTS
   - Configure network security group
   - Open ports: 22 (SSH), 3000 (Node.js), 443 (HTTPS)

### Server Configuration
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Clone your repository
git clone https://github.com/Hey-Salad/HeySalad-Kelly-AI-Server.git
cd HeySalad-Kelly-AI-Server

# Install dependencies
npm install

# Set up environment variables
nano .env  # Add your configuration

# Start server with PM2
pm2 start src/index.js --name "heysalad-kelly-server"
pm2 startup
pm2 save
```

### Nginx Reverse Proxy (Optional but Recommended)
```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/heysalad-kelly-server

# Add Nginx configuration
server {
    listen 80;
    listen 443 ssl;
    server_name your_domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Security Recommendations
- Use HTTPS
- Regularly update dependencies
- Implement rate limiting
- Use strong, unique credentials
- Enable Azure Security Center

## Monitoring
- Use PM2 for process management
- Set up Azure Monitor
- Configure logging

## Contributing
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License
Distributed under the MIT License. See `LICENSE` for more information.

## Contact
HeySalad Team - [Your Contact Information]
Project Link: [https://github.com/Hey-Salad/HeySalad-Kelly-AI-Server](https://github.com/Hey-Salad/HeySalad-Kelly-AI-Server)
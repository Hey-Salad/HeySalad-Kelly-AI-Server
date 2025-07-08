#!/bin/bash

# HeySalad Kelly Server Deployment Script
# ======================================

# Text colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN}  HeySalad Kelly Server Deployment Script    ${NC}"
echo -e "${GREEN}==============================================${NC}"

# Check if running as root for port 80
if [[ $EUID -ne 0 && "$PORT" = "80" ]]; then
  echo -e "${YELLOW}Warning: You may need root privileges to bind to port 80${NC}"
  echo -e "${YELLOW}Consider running with sudo or setting PORT to a value above 1024${NC}"
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
  echo -e "${YELLOW}PM2 is not installed. Installing PM2 globally...${NC}"
  npm install -g pm2
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install PM2. Please install it manually: npm install -g pm2${NC}"
    exit 1
  fi
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  npm install
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install dependencies. Please check package.json${NC}"
    exit 1
  fi
fi

# Ensure log directory exists
mkdir -p logs

# Ensure public directory exists
mkdir -p public

# Check if .env file exists
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}Creating .env file from example...${NC}"
  cp .env.example .env 2>/dev/null || touch .env
  echo "Please update the .env file with your credentials."
fi

# Check if ecosystem.config.js exists
if [ ! -f "ecosystem.config.js" ]; then
  echo -e "${RED}ecosystem.config.js not found. Please create this file.${NC}"
  exit 1
fi

# Deploy with PM2
echo -e "${GREEN}Starting server with PM2...${NC}"
pm2 start ecosystem.config.js
if [ $? -ne 0 ]; then
  echo -e "${RED}Failed to start with PM2. Check logs for errors.${NC}"
  exit 1
fi

# Save PM2 configuration
echo -e "${GREEN}Saving PM2 configuration...${NC}"
pm2 save
if [ $? -ne 0 ]; then
  echo -e "${YELLOW}Failed to save PM2 configuration. You may need to run 'pm2 save' manually.${NC}"
fi

# Setup PM2 to start on boot (if running as root)
if [[ $EUID -eq 0 ]]; then
  echo -e "${GREEN}Setting up PM2 to start on system boot...${NC}"
  pm2 startup
  if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Failed to setup PM2 startup. You may need to run 'pm2 startup' manually.${NC}"
  fi
else
  echo -e "${YELLOW}Skipping PM2 startup configuration (requires root)${NC}"
  echo -e "${YELLOW}To enable startup on boot, run 'sudo pm2 startup' and follow instructions${NC}"
fi

# Get server information
SERVER_IP=$(hostname -I | awk '{print $1}')
SERVER_PORT=$(grep -E 'PORT.*[0-9]+' ecosystem.config.js | head -1 | grep -oE '[0-9]+' || echo "3000")

echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN}  Server deployed successfully!              ${NC}"
echo -e "${GREEN}==============================================${NC}"
echo -e "Local access: http://$SERVER_IP:$SERVER_PORT"
echo -e "Public DNS: http://api.kelly.ai.heysalad.app:$SERVER_PORT"
echo -e ""
echo -e "To monitor the server: ${YELLOW}pm2 monit${NC}"
echo -e "To view logs: ${YELLOW}pm2 logs heysalad-kelly-server${NC}"
echo -e "To restart: ${YELLOW}pm2 restart heysalad-kelly-server${NC}"
echo -e "${GREEN}==============================================${NC}"

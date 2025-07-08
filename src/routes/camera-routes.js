// src/routes/camera-routes.js
const express = require('express');
const { logger } = require('../config/logger');
const fs = require('fs');
const path = require('path');

// Store for registered camera devices
const cameraDevices = new Map();
// Store for pending commands
const pendingCommands = new Map();
// Store for frames (limited history)
const frameStore = new Map();
// Store for photos
const photoStore = new Map();

module.exports = (app) => {
  // API v1 endpoints to match your device's cloud.py module
  
  // Device registration endpoint
  app.post('/api/v1/devices/register', async (req, res) => {
    try {
      const deviceData = req.body;
      
      if (!deviceData.device_id) {
        return res.status(400).json({
          success: false,
          error: 'Missing device_id'
        });
      }
      
      // Register or update the device
      cameraDevices.set(deviceData.device_id, {
        ...deviceData,
        lastSeen: new Date().toISOString(),
        isOnline: true
      });
      
      logger.info(`Camera device registered: ${deviceData.device_id}`, { deviceData });
      
      res.json({
        success: true,
        message: 'Device registered successfully',
        device_id: deviceData.device_id
      });
    } catch (error) {
      logger.error('Camera registration failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Registration failed',
        message: error.message
      });
    }
  });
  
  // Device heartbeat endpoint
  app.post('/api/v1/devices/heartbeat', async (req, res) => {
    try {
      const { device_id, status } = req.body;
      
      if (!device_id) {
        return res.status(400).json({
          success: false,
          error: 'Missing device_id'
        });
      }
      
      // Update device status
      if (cameraDevices.has(device_id)) {
        const device = cameraDevices.get(device_id);
        cameraDevices.set(device_id, {
          ...device,
          ...req.body,
          lastSeen: new Date().toISOString(),
          isOnline: true
        });
      } else {
        // Register new device if not found
        cameraDevices.set(device_id, {
          device_id,
          status: status || 'online',
          lastSeen: new Date().toISOString(),
          isOnline: true
        });
      }
      
      // Check for pending commands for this device
      const commands = pendingCommands.get(device_id) || [];
      
      logger.info(`Camera heartbeat received: ${device_id}`, {
        status: status || 'online',
        commandCount: commands.length
      });
      
      res.json({
        success: true,
        message: 'Heartbeat acknowledged',
        commands: commands
      });
    } catch (error) {
      logger.error('Camera heartbeat failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Heartbeat failed',
        message: error.message
      });
    }
  });
  
  // Telemetry data endpoint
  app.post('/api/v1/telemetry', async (req, res) => {
    try {
      const { device_id, data } = req.body;
      
      if (!device_id) {
        return res.status(400).json({
          success: false,
          error: 'Missing device_id'
        });
      }
      
      // Update device with telemetry
      if (cameraDevices.has(device_id)) {
        const device = cameraDevices.get(device_id);
        cameraDevices.set(device_id, {
          ...device,
          telemetry: data,
          lastTelemetry: new Date().toISOString()
        });
      }
      
      logger.info(`Camera telemetry received: ${device_id}`, { telemetry: data });
      
      res.json({
        success: true,
        message: 'Telemetry received'
      });
    } catch (error) {
      logger.error('Camera telemetry failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Telemetry failed',
        message: error.message
      });
    }
  });
  
  // Get pending commands endpoint
  app.get('/api/v1/commands', async (req, res) => {
    try {
      const { device_id } = req.query;
      
      if (!device_id) {
        return res.status(400).json({
          success: false,
          error: 'Missing device_id'
        });
      }
      
      // Get pending commands for this device
      const commands = pendingCommands.get(device_id) || [];
      
      res.json({
        success: true,
        commands: commands
      });
    } catch (error) {
      logger.error('Fetching camera commands failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Fetching commands failed',
        message: error.message
      });
    }
  });
  
  // Command response endpoint
  app.post('/api/v1/commands/response', async (req, res) => {
    try {
      const { device_id, command_id, status, result } = req.body;
      
      if (!device_id || !command_id) {
        return res.status(400).json({
          success: false,
          error: 'Missing device_id or command_id'
        });
      }
      
      // Remove the command from pending commands
      if (pendingCommands.has(device_id)) {
        const commands = pendingCommands.get(device_id);
        const updatedCommands = commands.filter(cmd => cmd.id !== command_id);
        pendingCommands.set(device_id, updatedCommands);
      }
      
      logger.info(`Command response received: ${command_id} for device ${device_id}`, {
        status,
        result
      });
      
      res.json({
        success: true,
        message: 'Command response received'
      });
    } catch (error) {
      logger.error('Command response failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Command response failed',
        message: error.message
      });
    }
  });
  
  // Image upload endpoint
  app.post('/api/v1/devices/images', async (req, res) => {
    try {
      const { device_id, image, format, metadata } = req.body;
      
      if (!device_id || !image) {
        return res.status(400).json({
          success: false,
          error: 'Missing device_id or image data'
        });
      }
      
      // Create unique ID for the image
      const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      
      // Create directory if it doesn't exist
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'images');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Save image to disk
      try {
        const imageBuffer = Buffer.from(image, 'base64');
        const extension = format || 'jpg';
        const filePath = path.join(uploadsDir, `${imageId}.${extension}`);
        
        fs.writeFileSync(filePath, imageBuffer);
        
        logger.info(`Image uploaded from device: ${device_id}`, {
          imageId,
          filePath,
          size: imageBuffer.length
        });
        
        res.json({
          success: true,
          message: 'Image uploaded successfully',
          imageId,
          url: `/uploads/images/${imageId}.${extension}`
        });
      } catch (fileError) {
        logger.error('Image file save failed', { error: fileError.message });
        res.status(500).json({
          success: false,
          error: 'Image save failed',
          message: fileError.message
        });
      }
    } catch (error) {
      logger.error('Image upload failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Image upload failed',
        message: error.message
      });
    }
  });
  
  // Send command to camera
  app.post('/api/v1/devices/:deviceId/command', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { type, params } = req.body;
      
      if (!cameraDevices.has(deviceId)) {
        return res.status(404).json({
          success: false,
          error: 'Device not found'
        });
      }
      
      // Create command
      const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const command = {
        id: commandId,
        type,
        params: params || {},
        created_at: new Date().toISOString()
      };
      
      // Add to pending commands
      if (!pendingCommands.has(deviceId)) {
        pendingCommands.set(deviceId, []);
      }
      
      const commands = pendingCommands.get(deviceId);
      commands.push(command);
      pendingCommands.set(deviceId, commands);
      
      logger.info(`Command sent to device ${deviceId}: ${type}`, { command });
      
      res.json({
        success: true,
        message: 'Command sent',
        commandId
      });
    } catch (error) {
      logger.error('Sending command failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Sending command failed',
        message: error.message
      });
    }
  });
  
  // List all registered cameras
  app.get('/api/v1/devices', async (req, res) => {
    try {
      const devices = Array.from(cameraDevices.values()).map(device => ({
        device_id: device.device_id,
        device_type: device.device_type,
        firmware_version: device.firmware_version,
        status: device.status || 'unknown',
        lastSeen: device.lastSeen,
        isOnline: device.isOnline,
        ip_address: device.ip_address
      }));
      
      res.json({
        success: true,
        devices
      });
    } catch (error) {
      logger.error('Listing devices failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Listing devices failed',
        message: error.message
      });
    }
  });
};

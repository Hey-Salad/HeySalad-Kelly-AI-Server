// src/utils/port-manager.js
const net = require('net');

/**
 * Find an available port starting from a base port
 * @param {number} basePort - Starting port to check
 * @param {number} [maxAttempts=10] - Maximum number of ports to try
 * @returns {Promise<number>} Available port
 */
async function findAvailablePort(basePort, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let currentPort = basePort;
    let attempts = 0;

    function tryPort() {
      const server = net.createServer();
      
      server.listen(currentPort, () => {
        const port = server.address().port;
        server.close(() => {
          resolve(port);
        });
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          attempts++;
          currentPort++;

          if (attempts >= maxAttempts) {
            reject(new Error(`Could not find an available port after ${maxAttempts} attempts`));
          } else {
            tryPort();
          }
        } else {
          reject(err);
        }
      });
    }

    tryPort();
  });
}

/**
 * Check if a port is available
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} Whether the port is available
 */
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.close(() => {
        resolve(true);
      });
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
  });
}

module.exports = {
  findAvailablePort,
  isPortAvailable
};

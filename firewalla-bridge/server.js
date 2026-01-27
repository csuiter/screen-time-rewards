#!/usr/bin/env node
/**
 * Firewalla API Bridge Server
 *
 * This lightweight server runs on your Firewalla box and provides
 * a simple HTTP API to control internet access policies.
 *
 * Installation (SSH into Firewalla):
 *   1. Copy this file to /home/pi/firewalla-bridge/server.js
 *   2. Run: node /home/pi/firewalla-bridge/server.js &
 *   3. To auto-start, add to crontab: @reboot node /home/pi/firewalla-bridge/server.js
 *
 * API Endpoints:
 *   GET  /health              - Check if server is running
 *   GET  /policy/:id          - Get policy status
 *   POST /policy/:id/enable   - Enable policy (BLOCK internet)
 *   POST /policy/:id/disable  - Disable policy (ALLOW internet)
 */

const http = require('http');
const { exec } = require('child_process');
const url = require('url');

// Configuration
const PORT = 3838;
const API_SECRET = process.env.API_SECRET || 'screentime2024'; // Change this!
const FIREWALLA_API = 'http://127.0.0.1:8834';

// Simple logging
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// Execute curl command to Firewalla's internal API
function firewallaRequest(method, path) {
  return new Promise((resolve, reject) => {
    const cmd = method === 'GET'
      ? `curl -s ${FIREWALLA_API}${path}`
      : `curl -s -X POST ${FIREWALLA_API}${path}`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve({ raw: stdout });
      }
    });
  });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const query = parsedUrl.query;

  // CORS headers for browser access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Simple auth check
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (path !== '/health' && token !== API_SECRET) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  log(`${req.method} ${path}`);

  try {
    // Health check
    if (path === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // Get policy status
    const getPolicyMatch = path.match(/^\/policy\/(\d+)$/);
    if (getPolicyMatch && req.method === 'GET') {
      const policyId = getPolicyMatch[1];
      const result = await firewallaRequest('GET', `/v1/policy/${policyId}`);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // Enable policy (BLOCK internet)
    const enableMatch = path.match(/^\/policy\/(\d+)\/enable$/);
    if (enableMatch && req.method === 'POST') {
      const policyId = enableMatch[1];
      const result = await firewallaRequest('POST', `/v1/policy/${policyId}/enable`);
      log(`Policy ${policyId} ENABLED (internet BLOCKED)`);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, action: 'enabled', policyId, result }));
      return;
    }

    // Disable policy (ALLOW internet)
    const disableMatch = path.match(/^\/policy\/(\d+)\/disable$/);
    if (disableMatch && req.method === 'POST') {
      const policyId = disableMatch[1];
      const result = await firewallaRequest('POST', `/v1/policy/${policyId}/disable`);
      log(`Policy ${policyId} DISABLED (internet ALLOWED)`);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, action: 'disabled', policyId, result }));
      return;
    }

    // List all policies (helper endpoint)
    if (path === '/policies' && req.method === 'GET') {
      const result = await new Promise((resolve, reject) => {
        exec('redis-cli hgetall policy:system', (error, stdout) => {
          if (error) reject(error);
          else resolve({ raw: stdout });
        });
      });
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (error) {
    log(`Error: ${error.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Firewalla Bridge Server running on port ${PORT}`);
  log(`API Secret: ${API_SECRET}`);
  log('');
  log('Endpoints:');
  log('  GET  /health              - Health check');
  log('  GET  /policy/:id          - Get policy status');
  log('  POST /policy/:id/enable   - Enable policy (BLOCK)');
  log('  POST /policy/:id/disable  - Disable policy (ALLOW)');
  log('  GET  /policies            - List all policies');
});

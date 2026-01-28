#!/usr/bin/env node
/**
 * Simple HTTP/HTTPS proxy that logs all requests to vLLM
 * 
 * Usage:
 * 1. Run: node proxy-logger.js
 * 2. Change Base URL in ValeDesk settings to: http://localhost:8888
 * 3. All requests will be logged to ./logs/proxy-requests.log
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration
const PROXY_PORT = 8888;
const TARGET_BASE_URL = process.env.VLLM_URL || 'http://localhost:8000/v1'; // Set VLLM_URL env var or change this to your vLLM URL
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logFile = path.join(LOGS_DIR, 'proxy-requests.log');

function logRequest(data) {
  const timestamp = new Date().toISOString();
  const separator = '\n' + '='.repeat(80) + '\n';
  const logEntry = `${separator}${timestamp}${separator}${JSON.stringify(data, null, 2)}\n`;
  
  fs.appendFileSync(logFile, logEntry);
  console.log(`[${timestamp}] Request logged`);
}

// Create proxy server
const server = http.createServer((req, res) => {
  let body = '';
  
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    // Parse target URL
    const targetUrl = new URL(req.url, TARGET_BASE_URL);
    
    // Log request
    const requestData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: targetUrl.href,
      headers: req.headers,
      body: body ? JSON.parse(body) : null
    };
    
    logRequest(requestData);
    
    // Forward request to target
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: req.headers
    };
    
    const protocol = targetUrl.protocol === 'https:' ? https : http;
    const proxyReq = protocol.request(options, (proxyRes) => {
      // Forward response headers
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      
      // Forward response body
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err);
      res.writeHead(500);
      res.end('Proxy error: ' + err.message);
    });
    
    if (body) {
      proxyReq.write(body);
    }
    
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           vLLM Request Logger Proxy                        ║
╚════════════════════════════════════════════════════════════╝

✓ Proxy running on: http://localhost:${PROXY_PORT}
✓ Forwarding to: ${TARGET_BASE_URL}
✓ Logs directory: ${LOGS_DIR}
✓ Log file: ${path.basename(logFile)}

📝 Next steps:
  1. Open ValeDesk Settings
  2. Change Base URL to: http://localhost:${PROXY_PORT}
  3. Make a request
  4. Check logs in: ${logFile}

Press Ctrl+C to stop
  `);
});

#!/usr/bin/env node
/**
 * MCP Server Test Script
 * 
 * This script tests the Buddy MCP server by simulating MCP protocol messages.
 * It verifies that the server can:
 * 1. Start up correctly
 * 2. List available resources
 * 3. List available tools
 * 4. Handle basic requests
 * 
 * Usage:
 *   node mcp-server/test-mcp.mjs
 * 
 * Requirements:
 *   - BUDDY_MCP_API_KEY environment variable
 *   - BUDDY_MCP_BANK_ID environment variable
 *   - Buddy instance running at BUDDY_MCP_URL (default: http://localhost:3000)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check required environment variables
const requiredEnvVars = ['BUDDY_MCP_API_KEY', 'BUDDY_MCP_BANK_ID'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('Error: Missing required environment variables:');
  missingVars.forEach(v => console.error(`  - ${v}`));
  console.error('\nSet them in your environment or .env file');
  process.exit(1);
}

console.log('✓ Environment variables configured');
console.log(`  BUDDY_MCP_BANK_ID: ${process.env.BUDDY_MCP_BANK_ID}`);
console.log(`  BUDDY_MCP_URL: ${process.env.BUDDY_MCP_URL || 'http://localhost:3000'}`);
console.log('');

// Path to the built MCP server
const serverPath = join(__dirname, 'dist', 'index.js');

console.log('Starting MCP server...');
const server = spawn('node', [serverPath], {
  env: {
    ...process.env,
    NODE_ENV: 'test'
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let receivedData = '';
let testsPassed = 0;
let testsFailed = 0;

// Handle stdout (MCP protocol messages)
server.stdout.on('data', (data) => {
  receivedData += data.toString();
  
  // Try to parse JSON-RPC messages
  const lines = receivedData.split('\n');
  receivedData = lines.pop() || ''; // Keep incomplete line
  
  lines.forEach(line => {
    if (!line.trim()) return;
    
    try {
      const msg = JSON.parse(line);
      console.log('Received:', JSON.stringify(msg, null, 2));
      
      // Verify response structure
      if (msg.jsonrpc === '2.0') {
        console.log('✓ Valid JSON-RPC 2.0 response');
        testsPassed++;
      } else {
        console.error('✗ Invalid JSON-RPC version');
        testsFailed++;
      }
    } catch (err) {
      // Not JSON or incomplete
    }
  });
});

// Handle stderr (logs)
server.stderr.on('data', (data) => {
  const msg = data.toString();
  if (msg.includes('started')) {
    console.log('✓ Server started successfully');
    testsPassed++;
    
    // Send test requests
    setTimeout(() => sendTestRequests(), 500);
  }
  console.log('[Server]', msg.trim());
});

// Handle server exit
server.on('close', (code) => {
  console.log('');
  console.log('='.repeat(50));
  console.log('Test Summary:');
  console.log(`  Passed: ${testsPassed}`);
  console.log(`  Failed: ${testsFailed}`);
  
  if (testsFailed === 0 && testsPassed > 0) {
    console.log('');
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('');
    console.log('✗ Some tests failed');
    process.exit(1);
  }
});

// Handle errors
server.on('error', (err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});

// Send test requests
function sendTestRequests() {
  console.log('');
  console.log('Sending test requests...');
  
  // Request 1: List resources
  const listResourcesRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/list',
    params: {}
  };
  
  console.log('Test 1: List resources');
  server.stdin.write(JSON.stringify(listResourcesRequest) + '\n');
  
  // Request 2: List tools
  setTimeout(() => {
    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    };
    
    console.log('Test 2: List tools');
    server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    
    // Give time for responses, then shutdown
    setTimeout(() => {
      console.log('');
      console.log('Tests complete, shutting down...');
      server.kill();
    }, 2000);
  }, 1000);
}

// Timeout
setTimeout(() => {
  console.error('');
  console.error('✗ Test timeout (30s)');
  server.kill();
  process.exit(1);
}, 30000);

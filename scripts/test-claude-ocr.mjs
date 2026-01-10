// Test Claude OCR with a sample PDF
import { runClaudeOcrJob } from '../src/lib/ocr/runClaudeOcrJob.js';
import { readFileSync } from 'fs';
import { join } from 'path';

async function testClaudeOcr() {
  console.log('=== Testing Claude OCR ===\n');
  
  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set in environment');
    process.exit(1);
  }
  console.log('✅ ANTHROPIC_API_KEY is set\n');
  
  // For now, just test that the function is importable
  console.log('✅ runClaudeOcrJob function imported successfully\n');
  
  console.log('To test with a real document:');
  console.log('1. Upload a PDF via the Buddy UI');
  console.log('2. Check the server logs for [ClaudeOCR] messages');
  console.log('3. Verify the OCR completes faster than Azure DI\n');
  
  console.log('Environment check:');
  console.log(`  USE_CLAUDE_OCR=${process.env.USE_CLAUDE_OCR}`);
  console.log(`  ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY?.substring(0, 20)}...`);
}

testClaudeOcr().catch(console.error);

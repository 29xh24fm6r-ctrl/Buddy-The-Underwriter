#!/bin/bash
# Test Claude OCR Integration
# This script tests the Claude OCR setup

set -e

echo "=== Claude OCR Integration Test ==="
echo ""

# Check environment variables
echo "✓ Checking environment variables..."
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "  ❌ ANTHROPIC_API_KEY not set"
  exit 1
else
  echo "  ✅ ANTHROPIC_API_KEY is set"
fi

if [ "$USE_CLAUDE_OCR" = "true" ]; then
  echo "  ✅ USE_CLAUDE_OCR=true (Claude enabled)"
else
  echo "  ⚠️  USE_CLAUDE_OCR=$USE_CLAUDE_OCR (Azure DI fallback)"
fi

echo ""
echo "✓ Checking Claude OCR function exists..."
if [ -f "src/lib/ocr/runClaudeOcrJob.ts" ]; then
  echo "  ✅ runClaudeOcrJob.ts exists"
else
  echo "  ❌ runClaudeOcrJob.ts not found"
  exit 1
fi

echo ""
echo "✓ Checking integration in runOcrJob.ts..."
if grep -q "runClaudeOcrJob" "src/lib/ocr/runOcrJob.ts"; then
  echo "  ✅ Claude OCR imported in runOcrJob.ts"
else
  echo "  ❌ Claude OCR not imported"
  exit 1
fi

if grep -q "USE_CLAUDE_OCR" "src/lib/ocr/runOcrJob.ts"; then
  echo "  ✅ USE_CLAUDE_OCR check present"
else
  echo "  ❌ USE_CLAUDE_OCR check missing"
  exit 1
fi

echo ""
echo "✓ Checking @anthropic-ai/sdk installation..."
if grep -q "@anthropic-ai/sdk" "package.json"; then
  echo "  ✅ @anthropic-ai/sdk in package.json"
else
  echo "  ❌ @anthropic-ai/sdk not installed"
  exit 1
fi

echo ""
echo "════════════════════════════════════════"
echo "✅ All checks passed!"
echo "════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Upload a document via the UI"
echo "2. Trigger OCR (should use Claude)"
echo "3. Check logs for 'ClaudeOCR' messages"
echo "4. Verify 'engine: claude_anthropic' in results"
echo ""
echo "To test both engines:"
echo "  - Set USE_CLAUDE_OCR=true  → Uses Claude"
echo "  - Set USE_CLAUDE_OCR=false → Uses Azure DI"
echo ""

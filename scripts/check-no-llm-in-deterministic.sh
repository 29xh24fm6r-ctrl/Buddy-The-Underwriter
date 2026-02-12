#!/usr/bin/env bash
# CI guardrail: deterministic extractors must NEVER import LLM/AI libraries.
#
# The deterministic pipeline (src/lib/financialSpreads/extractors/deterministic/)
# is a zero-LLM zone. Any reference to Anthropic, OpenAI, or Claude libraries
# means someone accidentally coupled them — fail the build.
set -euo pipefail

TARGET="src/lib/financialSpreads/extractors/deterministic"
PATTERN="(anthropic|@anthropic-ai/sdk|callClaudeForExtraction|openai|chat\.completions|getOpenAI|openaiClient|legacyClaudeExtractor)"

if rg -n "$PATTERN" "$TARGET" 2>/dev/null; then
  echo ""
  echo "ERROR: LLM/AI references found in deterministic extractors."
  echo "The deterministic pipeline must have ZERO LLM dependencies."
  echo "Move any AI code to src/lib/financialSpreads/extractors/legacyClaudeExtractor.ts"
  exit 1
fi

echo "OK: no LLM references in deterministic extractors."

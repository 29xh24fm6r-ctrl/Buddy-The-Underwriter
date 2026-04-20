# OpenAI Environment Variables Setup

Copy these variables to your `.env.local` file (create if doesn't exist):

```bash
# OpenAI (server-only, required for real AI)
OPENAI_API_KEY=sk-your-actual-key-here
OPENAI_MODEL=gpt-4o-2024-08-06
OPENAI_TEMPERATURE=0.2
OPENAI_MAX_OUTPUT_TOKENS=4096
```

## Getting Your API Key

1. Go to https://platform.openai.com/api-keys
2. Sign in or create account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Paste into `.env.local`

## Default Values

If you only set `OPENAI_API_KEY`, these defaults apply:
- Model: `gpt-4o-2024-08-06`
- Temperature: `0.2`
- Max tokens: `4096`

## Security Notes

- `.env.local` is gitignored (never commit secrets!)
- API key only accessible server-side
- All AI calls happen in server actions/API routes
- Key never shipped to client browser

## Testing

Without API key:
- System uses StubProvider (deterministic demo data)
- No network calls, zero cost

With API key:
- System uses OpenAIProvider (real AI)
- Costs ~$0.02-$0.04 per risk/memo generation
- See OPENAI_ADAPTER_COMPLETE.md for cost estimates

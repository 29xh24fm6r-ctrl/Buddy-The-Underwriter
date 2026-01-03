# Upload Pipeline Smoke Test

## Purpose
Validates that the upload record endpoint works end-to-end without causing database errors.

## Usage

### Local Testing
```bash
# 1. Start the dev server
pnpm dev

# 2. In another terminal, set environment variables
export SMOKE_BASE_URL=http://localhost:3000
export SMOKE_DEAL_ID=<PASTE_VALID_DEAL_UUID>

# If authentication is required, capture your cookie from browser DevTools
export SMOKE_AUTH_COOKIE='__session=...; other=...'

# 3. Run the smoke test
pnpm smoke:upload-record
```

### Production Testing
```bash
export SMOKE_BASE_URL=https://<your-vercel-domain>
export SMOKE_DEAL_ID=<PASTE_VALID_DEAL_UUID>
export SMOKE_AUTH_COOKIE='__session=...; ...'  # if required
pnpm smoke:upload-record
```

## Environment Variables
- `SMOKE_BASE_URL` (required) - Base URL of the application (e.g., http://localhost:3000)
- `SMOKE_DEAL_ID` (required) - A valid deal UUID in the target environment
- `SMOKE_AUTH_COOKIE` (optional) - Authentication cookie if the endpoint requires auth
- `SMOKE_BEARER` (optional) - Bearer token if the endpoint supports it

## Expected Output
```
✅ Smoke upload-record OK { status: 200, json: { ok: true, ... } }
```

## What It Tests
- Document key derivation logic
- Schema drift guard (ensures no invalid columns)
- Database insert constraints (NOT NULL, etc.)
- Basic upload pipeline flow

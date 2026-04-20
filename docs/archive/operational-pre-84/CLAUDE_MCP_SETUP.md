# Connecting Claude Desktop to Buddy via MCP

This guide explains how to connect Claude Desktop to Buddy The Underwriter using the Model Context Protocol (MCP), enabling Claude to access deal information, validate cases, and interact with the underwriting system.

## Prerequisites

1. **Buddy instance running** (local or deployed)
2. **Claude Desktop installed** ([download here](https://claude.ai/download))
3. **Node.js 20+** installed
4. **BUDDY_MCP_API_KEY** configured in your Buddy instance

## Architecture

```
┌─────────────────┐
│ Claude Desktop  │
│                 │
│  (User chat)    │
└────────┬────────┘
         │ MCP Protocol (stdio)
         ▼
┌─────────────────────────┐
│  Buddy MCP Server       │
│  (mcp-server/index.ts)  │
│                         │
│  - Stdio transport      │
│  - Tool/Resource bridge │
└────────┬────────────────┘
         │ HTTP JSON-RPC
         ▼
┌─────────────────────────┐
│  Buddy HTTP API         │
│  POST /api/mcp          │
│                         │
│  - Bearer auth          │
│  - Tenant isolation     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Supabase Database      │
│  (tenant-isolated)      │
└─────────────────────────┘
```

## Setup Instructions

### Step 1: Set BUDDY_MCP_API_KEY

The Buddy HTTP API requires authentication via `BUDDY_MCP_API_KEY`. Set this in your Buddy instance environment:

**For local development (.env.local):**
```bash
BUDDY_MCP_API_KEY=your_secret_key_here_make_it_long_and_random
```

**For Vercel deployment:**
```bash
vercel env add BUDDY_MCP_API_KEY
# Enter your secret key when prompted
```

**Important:** Use a strong random string (32+ characters). This key protects your Buddy API from unauthorized access.

### Step 2: Build the MCP Server

```bash
# From the repository root
npm run build:mcp
```

This will:
1. Install dependencies in `mcp-server/`
2. Compile TypeScript to JavaScript
3. Output to `mcp-server/dist/`

### Step 3: Configure Claude Desktop

Claude Desktop reads its MCP configuration from a JSON file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

Create or edit this file:

```json
{
  "mcpServers": {
    "buddy-underwriter": {
      "command": "node",
      "args": [
        "/absolute/path/to/Buddy-The-Underwriter/mcp-server/dist/index.js"
      ],
      "env": {
        "BUDDY_MCP_API_KEY": "your_secret_key_here_same_as_step_1",
        "BUDDY_MCP_BANK_ID": "your_bank_id_from_supabase",
        "BUDDY_MCP_URL": "http://localhost:3000"
      }
    }
  }
}
```

**Configuration fields:**

- **BUDDY_MCP_API_KEY**: Must match the key set in Step 1
- **BUDDY_MCP_BANK_ID**: Bank ID for tenant isolation (get from your Supabase `banks` table)
- **BUDDY_MCP_URL**: 
  - Local: `http://localhost:3000`
  - Vercel: `https://your-deployment.vercel.app`

**Important:** 
- Use the **absolute path** to the built `index.js` file (not relative `./` paths)
- On macOS/Linux: `/Users/yourname/projects/Buddy-The-Underwriter/mcp-server/dist/index.js`
- On Windows: `C:\Users\yourname\projects\Buddy-The-Underwriter\mcp-server\dist\index.js`

### Step 4: Restart Claude Desktop

1. Quit Claude Desktop completely
2. Relaunch Claude Desktop
3. Look for the 🔌 icon in the bottom right corner — it should show "buddy-underwriter" as connected

### Step 5: Verify Connection

In a new Claude chat, try:

```
Can you list the recent workflows in Buddy?
```

Claude should respond with data from your Buddy instance.

## Available Resources

Claude can read these Buddy resources:

| Resource | Description |
|----------|-------------|
| `buddy://workflows/recent` | Recent active deals/cases |
| `buddy://ledger/summary` | Observability ledger statistics |
| `buddy://ledger/query` | Filtered event ledger query |

## Available Tools

Claude can use these Buddy tools:

### Case Information
- **buddy_get_case** - Full case summary (borrower, documents, signals)
- **buddy_get_case_documents** - Document manifest (metadata only)
- **buddy_get_case_signals** - Signal ledger for a case
- **buddy_get_case_ledger** - Full event timeline for a case

### Case Operations
- **buddy_replay_case** - Re-emit signals to Omega (for re-sync)
- **buddy_validate_case** - Run validation checks
- **buddy_generate_missing_docs_email** - Draft missing docs email

### Observability
- **buddy_write_signal** - Write a Pulse signal to ledger
- **buddy_detect_anomalies** - Detect error spikes, stale deals, etc.

## Example Prompts

Once connected, you can ask Claude:

**Case Management:**
- "Show me the details for deal ID abc-123-xyz"
- "Validate case abc-123-xyz and tell me what's missing"
- "Generate a missing documents email for deal abc-123"

**Observability:**
- "Show me recent workflows"
- "Detect any anomalies in the last 30 minutes"
- "Show me the ledger summary for today"
- "What errors have occurred on deal abc-123?"

**Troubleshooting:**
- "Why did deal abc-123 fail?"
- "Replay signals for case xyz-456"
- "Check the event timeline for deal abc-123"

## Troubleshooting

### Server not showing in Claude Desktop

**Check Claude logs:**
- macOS: `~/Library/Logs/Claude/mcp*.log`
- Windows: `%APPDATA%\Claude\logs\mcp*.log`

**Common issues:**
- Path in config is not absolute
- Server not built (run `npm run build:mcp`)
- Syntax error in `claude_desktop_config.json`

**Verify JSON syntax:**
```bash
# macOS/Linux
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .

# Windows (PowerShell)
Get-Content "$env:APPDATA\Claude\claude_desktop_config.json" | jq .
```

### Authentication errors

**Error:** `Unauthorized: invalid or missing BUDDY_MCP_API_KEY`

**Solution:**
1. Verify `BUDDY_MCP_API_KEY` in Claude config matches Buddy env
2. Restart Claude Desktop after changing config
3. Check Buddy is running: `curl http://localhost:3000/api/health`

### Connection timeouts

**Error:** `Failed to read resource: HTTP 500` or timeouts

**Solution:**
1. Verify Buddy instance is running
2. Check `BUDDY_MCP_URL` is correct
3. Test API manually:
   ```bash
   curl -X POST http://localhost:3000/api/mcp \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your_api_key" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "buddy://workflows/recent",
       "params": { "bankId": "your_bank_id" }
     }'
   ```

### Bank ID errors

**Error:** `params.bankId is required for tenant isolation`

**Solution:**
1. Find your bank ID: `SELECT id, code, name FROM banks LIMIT 1;` in Supabase
2. Set `BUDDY_MCP_BANK_ID` in Claude config to that ID
3. Restart Claude Desktop

### Module not found errors

**Error:** `Cannot find module @modelcontextprotocol/sdk`

**Solution:**
```bash
cd mcp-server
npm install
npm run build
```

## Security Notes

- **API Key:** Keep `BUDDY_MCP_API_KEY` secret. Don't commit it to git.
- **Tenant Isolation:** The `BUDDY_MCP_BANK_ID` restricts Claude to a single bank's data.
- **Read-mostly:** Most tools are read-only. Only `buddy_write_signal` writes data.
- **Local-first:** MCP server runs locally on your machine, not in the cloud.

## Updating the Server

After making changes to `mcp-server/index.ts`:

```bash
npm run build:mcp
```

Then restart Claude Desktop for changes to take effect.

## Uninstalling

1. Remove the `buddy-underwriter` entry from `claude_desktop_config.json`
2. Restart Claude Desktop
3. Optionally delete `mcp-server/dist/` and `mcp-server/node_modules/`

## Additional Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Claude Desktop MCP Guide](https://docs.anthropic.com/claude/docs/model-context-protocol)
- [Buddy MCP API Reference](/src/lib/mcp/server.ts)
- [Pulse Observer Integration](/docs/PULSE_OBSERVER_INTEGRATION.md)

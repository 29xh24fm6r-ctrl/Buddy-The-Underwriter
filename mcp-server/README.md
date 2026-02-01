# Buddy MCP Server for Claude Desktop

This standalone MCP server exposes Buddy's underwriting resources and tools to Claude Desktop via the Model Context Protocol (MCP).

## Quick Start

### 1. Build the MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 2. Set Environment Variables

Create a `.env` file in the `mcp-server` directory:

```bash
# Required: Buddy MCP API authentication
BUDDY_MCP_API_KEY=your_api_key_here

# Required: Bank ID for tenant isolation
BUDDY_MCP_BANK_ID=your_bank_id_here

# Optional: Buddy instance URL (defaults to http://localhost:3000)
BUDDY_MCP_URL=https://your-buddy-instance.vercel.app
```

### 3. Configure Claude Desktop

Add the Buddy MCP server to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "buddy-underwriter": {
      "command": "node",
      "args": [
        "/absolute/path/to/Buddy-The-Underwriter/mcp-server/dist/index.js"
      ],
      "env": {
        "BUDDY_MCP_API_KEY": "your_api_key_here",
        "BUDDY_MCP_BANK_ID": "your_bank_id_here",
        "BUDDY_MCP_URL": "https://your-buddy-instance.vercel.app"
      }
    }
  }
}
```

**Important:** Replace `/absolute/path/to/` with the actual absolute path to this repository on your system.

### 4. Restart Claude Desktop

Quit and relaunch Claude Desktop for the changes to take effect.

## Available Resources

Once connected, Claude can access:

- `buddy://workflows/recent` - List recent active deals/cases
- `buddy://ledger/summary` - Aggregate statistics from observability ledger
- `buddy://ledger/query` - Filtered query into canonical event ledger

## Available Tools

Claude can use these tools to interact with Buddy:

### Case Information
- **buddy_get_case** - Get full case summary including borrower info, documents, and signals
- **buddy_get_case_documents** - Get document manifest for a case
- **buddy_get_case_signals** - Get signal ledger entries for a case
- **buddy_get_case_ledger** - Get full event timeline for a case

### Case Operations
- **buddy_replay_case** - Re-emit all signals for a case to Omega
- **buddy_validate_case** - Run validation checks on a case
- **buddy_generate_missing_docs_email** - Generate email draft listing missing documents

### Observability
- **buddy_write_signal** - Write a Pulse signal into the canonical ledger
- **buddy_detect_anomalies** - Scan recent events and detect anomalies

## Example Usage in Claude

Once configured, you can ask Claude things like:

- "Can you show me the recent workflows in Buddy?"
- "Get the case details for deal ID abc-123"
- "Validate case xyz-456 and tell me what's missing"
- "Generate a missing documents email for case abc-123"
- "Detect any anomalies in the system over the last 30 minutes"

## Security

The MCP server requires:
- **BUDDY_MCP_API_KEY**: Authentication token for the Buddy HTTP API
- **BUDDY_MCP_BANK_ID**: Bank ID for tenant isolation (ensures Claude only accesses data for one bank)

All requests are authenticated and tenant-isolated via the Buddy HTTP MCP endpoint at `/api/mcp`.

## Troubleshooting

### Server not appearing in Claude Desktop

1. Check the Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/mcp*.log`
   - Windows: `%APPDATA%\Claude\logs\mcp*.log`

2. Verify the path in `claude_desktop_config.json` is absolute
3. Ensure the server is built: `npm run build` in `mcp-server/`
4. Check that all environment variables are set correctly

### Authentication errors

- Verify `BUDDY_MCP_API_KEY` matches the `BUDDY_MCP_API_KEY` set in your Buddy instance
- Ensure the Buddy instance is running and accessible at `BUDDY_MCP_URL`

### Connection timeouts

- Check network connectivity to your Buddy instance
- Verify the Buddy instance is running: visit `https://your-instance/api/health`

## Architecture

```
Claude Desktop
    ↓ (stdio/MCP protocol)
Buddy MCP Server (this)
    ↓ (HTTP/JSON-RPC)
Buddy Instance @ /api/mcp
    ↓
Supabase Database
```

The MCP server acts as a bridge between Claude Desktop (which speaks MCP over stdio) and the Buddy HTTP API (which speaks JSON-RPC over HTTP).

# Claude MCP Integration - Complete ✅

## Summary

Claude Desktop can now connect to Buddy The Underwriter via the Model Context Protocol (MCP), enabling AI-assisted underwriting operations with full access to case data, document intelligence, and observability tools.

## What Was Built

### 1. Standalone MCP Server (`mcp-server/`)
- **Language:** TypeScript/Node.js
- **Transport:** stdio (required for Claude Desktop)
- **Protocol:** MCP 1.0 (via `@modelcontextprotocol/sdk`)
- **Architecture:** Bridge between Claude Desktop ↔ Buddy HTTP API

**Key files:**
- `mcp-server/index.ts` - Main MCP server implementation
- `mcp-server/package.json` - Server dependencies
- `mcp-server/tsconfig.json` - TypeScript configuration
- `mcp-server/dist/index.js` - Compiled output (executable)

### 2. Resources Exposed

The MCP server exposes these Buddy resources to Claude:

| Resource | URI | Description |
|----------|-----|-------------|
| Recent Workflows | `buddy://workflows/recent` | Active deals/cases |
| Ledger Summary | `buddy://ledger/summary` | Observability stats |
| Ledger Query | `buddy://ledger/query` | Filtered event log |

### 3. Tools Exposed

The MCP server exposes these Buddy tools to Claude:

**Case Information:**
- `buddy_get_case` - Full case summary
- `buddy_get_case_documents` - Document manifest
- `buddy_get_case_signals` - Signal history
- `buddy_get_case_ledger` - Event timeline

**Case Operations:**
- `buddy_validate_case` - Validation checks
- `buddy_generate_missing_docs_email` - Email drafts
- `buddy_replay_case` - Signal replay

**Observability:**
- `buddy_write_signal` - Log signals
- `buddy_detect_anomalies` - System scan

### 4. Documentation

- **[CLAUDE_MCP_SETUP.md](./CLAUDE_MCP_SETUP.md)** - Complete setup guide
- **[CLAUDE_MCP_QUICKSTART.md](./CLAUDE_MCP_QUICKSTART.md)** - Usage examples
- **[mcp-server/README.md](./mcp-server/README.md)** - Server documentation
- **[mcp-server/claude_desktop_config.example.json](./mcp-server/claude_desktop_config.example.json)** - Config template

### 5. Build & Test Infrastructure

**Build:**
```bash
npm run build:mcp
```

**Test:**
```bash
cd mcp-server
npm test
```

## Integration Points

### Buddy HTTP API (`/api/mcp`)
The MCP server authenticates to Buddy's existing HTTP MCP endpoint:

```
POST /api/mcp
Authorization: Bearer {BUDDY_MCP_API_KEY}
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "buddy://case/{caseId}",
  "params": {
    "bankId": "{BUDDY_MCP_BANK_ID}"
  }
}
```

**Authentication:** Bearer token via `BUDDY_MCP_API_KEY`  
**Tenant Isolation:** `bankId` parameter (required)

### Claude Desktop Configuration

Users configure Claude Desktop with:

```json
{
  "mcpServers": {
    "buddy-underwriter": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "BUDDY_MCP_API_KEY": "...",
        "BUDDY_MCP_BANK_ID": "...",
        "BUDDY_MCP_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Security Model

### Authentication
- **API Key:** `BUDDY_MCP_API_KEY` must match between Buddy and MCP server
- **Transport:** stdio (local process, not network exposed)

### Tenant Isolation
- **Bank ID:** All requests scoped to single `BUDDY_MCP_BANK_ID`
- **RLS:** Buddy enforces tenant isolation server-side
- **No cross-bank access:** MCP server cannot access other banks' data

### Permissions
- **Read-mostly:** Most tools are read-only
- **No direct writes:** Cannot modify deals, documents, or status
- **Observability signals:** Can write `buddy_signal_ledger` entries only
- **No email sending:** Draft generation only (user must send)

## Environment Variables

### Buddy Instance (Required)
```bash
BUDDY_MCP_API_KEY=your_secret_key_here
```

### MCP Server (Required, set in Claude config)
```bash
BUDDY_MCP_API_KEY=same_as_above
BUDDY_MCP_BANK_ID=your_bank_id
BUDDY_MCP_URL=http://localhost:3000  # or production URL
```

## Architecture

```
┌─────────────────────────────────────────────┐
│           Claude Desktop                    │
│  (User interacts via natural language)      │
└──────────────────┬──────────────────────────┘
                   │ MCP Protocol (stdio)
                   ▼
┌─────────────────────────────────────────────┐
│      Buddy MCP Server (Node.js)             │
│                                             │
│  • stdio transport (MCP SDK)                │
│  • Resource/Tool handlers                   │
│  • HTTP client to Buddy API                 │
└──────────────────┬──────────────────────────┘
                   │ HTTP JSON-RPC
                   ▼
┌─────────────────────────────────────────────┐
│      Buddy HTTP API (/api/mcp)              │
│                                             │
│  • Bearer auth (BUDDY_MCP_API_KEY)          │
│  • Tenant scoping (bankId param)            │
│  • Resource/Tool dispatchers                │
└──────────────────┬──────────────────────────┘
                   │ Supabase queries
                   ▼
┌─────────────────────────────────────────────┐
│      Supabase Database                      │
│  (RLS-protected, tenant-isolated)           │
└─────────────────────────────────────────────┘
```

## Testing

### Manual Testing
1. Build MCP server: `npm run build:mcp`
2. Configure Claude Desktop with example config
3. Restart Claude Desktop
4. Ask: "Can you list recent workflows in Buddy?"

### Automated Testing
```bash
cd mcp-server
npm test
```

## Deployment Notes

### Local Development
- MCP server runs on developer's machine
- Connects to local Buddy instance (`http://localhost:3000`)
- No cloud deployment needed for MCP server

### Production Use
- MCP server still runs locally (Claude Desktop requirement)
- `BUDDY_MCP_URL` points to production Buddy instance
- HTTPS required for production URLs
- API key must be production-safe (not committed to git)

## Known Limitations

1. **stdio only:** Cannot use SSE or HTTP transports (Claude Desktop limitation)
2. **Local execution:** MCP server must run on same machine as Claude Desktop
3. **No streaming:** Large responses may be slow (JSON-RPC limitation)
4. **Single bank:** One MCP server instance per bank (tenant isolation)

## Future Enhancements

### Potential Additions
- [ ] More granular permissions (read-only vs read-write modes)
- [ ] Streaming support for large document lists
- [ ] Multi-bank support (with bank selection in prompts)
- [ ] Direct document content access (OCR text, not just metadata)
- [ ] Real-time event subscriptions (notifications)

### Integration Opportunities
- [ ] Connect to Pulse Omega Prime MCP server (parallel connection)
- [ ] Aggregate signals from both Buddy and Pulse
- [ ] Cross-reference deal data with Omega insights
- [ ] Unified observability dashboard via Claude

## Success Criteria ✅

- [x] MCP server compiles without errors
- [x] Server exposes all planned resources and tools
- [x] Authentication works via BUDDY_MCP_API_KEY
- [x] Tenant isolation enforced via bankId
- [x] Comprehensive documentation provided
- [x] Build script integrated into main package.json
- [x] Example configuration file created
- [x] Security model documented
- [x] Quick reference guide created

## Rollout Checklist

For teams deploying this integration:

- [ ] Generate strong `BUDDY_MCP_API_KEY` (32+ chars)
- [ ] Add `BUDDY_MCP_API_KEY` to Buddy instance env vars
- [ ] Identify bank ID from Supabase `banks` table
- [ ] Build MCP server: `npm run build:mcp`
- [ ] Configure Claude Desktop with absolute path to `dist/index.js`
- [ ] Restart Claude Desktop
- [ ] Test with: "List recent workflows in Buddy"
- [ ] Review MCP logs if connection fails
- [ ] Document bank ID for team members

## Support

**Logs:**
- Claude Desktop: `~/Library/Logs/Claude/mcp*.log`
- MCP Server: stderr output (visible in Claude logs)

**Common Issues:**
- Server not appearing: Check path is absolute, not relative
- Auth errors: Verify API key matches between Buddy and Claude config
- Timeout errors: Ensure Buddy instance is running and accessible

## References

- [Model Context Protocol Spec](https://modelcontextprotocol.io/)
- [Anthropic MCP Docs](https://docs.anthropic.com/claude/docs/model-context-protocol)
- [Buddy MCP HTTP API](/src/lib/mcp/server.ts)
- [Pulse Observer Integration](/docs/PULSE_OBSERVER_INTEGRATION.md)

---

**Status:** Production Ready ✅  
**Last Updated:** 2026-01-31  
**Integration Complete:** Yes

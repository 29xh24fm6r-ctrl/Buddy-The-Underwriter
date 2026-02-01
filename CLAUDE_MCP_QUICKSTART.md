# Claude MCP Integration - Quick Reference

## What You Can Ask Claude

Once the MCP server is connected, Claude can interact with your Buddy instance. Here are example prompts:

### Case Management

**Get case details:**
```
Show me all the details for deal ID abc-123-xyz
```

**Check missing documents:**
```
What documents are missing for case abc-123?
Generate a missing documents email for deal abc-123
```

**Validate a case:**
```
Validate case abc-123 and tell me if it's ready for underwriting
Run all validation checks on deal xyz-456
```

### Recent Activity

**List recent workflows:**
```
Show me the 10 most recent deals in the system
What cases are currently active?
List recent workflows and their status
```

### Observability & Debugging

**Check system health:**
```
Show me the ledger summary for today
Are there any anomalies in the system right now?
Detect any error spikes in the last hour
```

**Case timeline:**
```
Show me the complete event timeline for deal abc-123
What happened to case xyz-456 yesterday?
Get the ledger entries for deal abc-123
```

**Troubleshooting:**
```
Why did deal abc-123 fail?
Show me all errors related to case xyz-456
What signals have been emitted for deal abc-123?
```

### Document Management

**Document inventory:**
```
List all documents uploaded for case abc-123
What type of documents do we have for deal xyz-456?
Show me the document manifest for case abc-123
```

### Advanced Operations

**Replay signals (for debugging):**
```
Replay all signals for case abc-123 to re-sync with Omega
Re-emit the event history for deal xyz-456
```

**Write custom signals:**
```
Write a health_check signal with payload indicating manual test
Log a custom signal for deal abc-123 about document gap
```

## Example Conversation Flow

**User:** "I need to check on deal abc-123. Can you tell me its current status?"

**Claude:** *Uses `buddy_get_case` tool*  
"Deal abc-123 is for ABC Corporation (LLC). It's currently in the 'underwriting' stage. The case has 12 documents uploaded and 45 signals in the ledger. Let me get more details..."

**User:** "What documents are missing?"

**Claude:** *Uses `buddy_generate_missing_docs_email` tool*  
"Based on the checklist, the following documents are still needed:
1. Business Tax Return (prior year)
2. Personal Financial Statement (SBA Form 413)
3. Rent Roll

I've generated an email draft you can send to the borrower..."

**User:** "Run a full validation"

**Claude:** *Uses `buddy_validate_case` tool*  
"I've run all validation checks on deal abc-123:
- ✓ Deal exists
- ✓ Borrower linked
- ✓ Has documents (12 found)
- ✓ Has signals (45 found)
- ✓ Lifecycle stage valid (underwriting)
- ✗ Borrower attestation missing

The case is mostly ready, but missing borrower attestation."

## Tips for Effective Prompts

**Be specific about case IDs:**
- Good: "Show me deal abc-123"
- Less effective: "Show me a deal"

**Ask for summaries:**
- "Summarize the current state of case abc-123"
- "Give me a health report for the last hour"

**Chain requests naturally:**
- Claude can use multiple tools in sequence
- "Get deal abc-123, check if it's valid, and if not, tell me what's missing"

**Use natural language:**
- You don't need to know MCP tool names
- Claude will map your intent to the right tools

## Available Tools Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `buddy_get_case` | Full case summary | "Show me deal X" |
| `buddy_get_case_documents` | Document list | "What docs exist for X" |
| `buddy_get_case_signals` | Signal history | "Show me signals for X" |
| `buddy_get_case_ledger` | Full event timeline | "What happened to X" |
| `buddy_validate_case` | Run checks | "Is X ready?" |
| `buddy_generate_missing_docs_email` | Email draft | "Draft missing docs email" |
| `buddy_replay_case` | Re-sync | "Replay signals for X" |
| `buddy_write_signal` | Log event | "Write a signal for X" |
| `buddy_detect_anomalies` | System scan | "Any issues?" |

## Security & Permissions

**What Claude CAN do:**
- ✓ Read case data for your bank only (tenant-isolated)
- ✓ Read documents metadata (not file bytes)
- ✓ Read event history
- ✓ Run validations (read-only)
- ✓ Generate email drafts (doesn't send)
- ✓ Write observability signals

**What Claude CANNOT do:**
- ✗ Access data from other banks
- ✗ Modify deal status
- ✗ Delete documents
- ✗ Send emails directly
- ✗ Approve/reject loans
- ✗ Access sensitive PII (EIN is masked)

## Performance Tips

**Cache case IDs:**
- If you'll reference a case multiple times, mention the ID early
- Claude may remember it for the conversation

**Batch requests:**
- "Show me cases abc-123, def-456, and ghi-789"
- Claude can process multiple cases

**Use time windows:**
- "Show me events in the last 2 hours"
- "Detect anomalies in the last 30 minutes"

## Troubleshooting in Claude

If you see errors like "Failed to read resource" or "MCP Error":

1. **Check Buddy is running:**
   - Ask: "Can you try listing recent workflows?"
   - If that fails, Buddy may be offline

2. **Verify bank ID:**
   - Error about tenant isolation means BUDDY_MCP_BANK_ID is wrong
   - Check your Claude config

3. **API key issues:**
   - "Unauthorized" errors mean BUDDY_MCP_API_KEY mismatch
   - Verify it matches between Buddy and Claude config

4. **Restart Claude Desktop:**
   - If tools disappear, restart Claude Desktop
   - Check MCP logs: `~/Library/Logs/Claude/mcp*.log`

## Next Steps

- Try the example prompts above
- Ask Claude to explain what tools are available
- Experiment with natural language queries
- Report bugs or improvements to the Buddy team

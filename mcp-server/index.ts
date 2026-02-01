#!/usr/bin/env node
/**
 * Buddy MCP Server for Claude Desktop
 * 
 * This is a standalone MCP server that exposes Buddy's resources and tools
 * to Claude Desktop via the Model Context Protocol (MCP).
 * 
 * Usage:
 *   1. Build: npm run build:mcp
 *   2. Configure in Claude Desktop's config
 *   3. Restart Claude Desktop
 * 
 * Resources exposed:
 *   - buddy://case/{caseId}
 *   - buddy://case/{caseId}/documents
 *   - buddy://case/{caseId}/signals
 *   - buddy://case/{caseId}/ledger
 *   - buddy://workflows/recent
 *   - buddy://ledger/summary
 *   - buddy://ledger/query
 * 
 * Tools exposed:
 *   - buddy_replay_case
 *   - buddy_validate_case
 *   - buddy_generate_missing_docs_email
 *   - buddy_write_signal
 *   - buddy_detect_anomalies
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Server configuration
const SERVER_NAME = "buddy-underwriter";
const SERVER_VERSION = "1.0.0";

// Get bank ID from environment (required for tenant isolation)
const BANK_ID = process.env.BUDDY_MCP_BANK_ID;
if (!BANK_ID) {
  console.error("Error: BUDDY_MCP_BANK_ID environment variable is required");
  process.exit(1);
}

// Create MCP server
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

/**
 * Make an authenticated request to the Buddy MCP HTTP endpoint
 */
async function callBuddyMcp(method: string, params?: Record<string, unknown>) {
  const apiKey = process.env.BUDDY_MCP_API_KEY;
  if (!apiKey) {
    throw new Error("BUDDY_MCP_API_KEY environment variable is required");
  }

  const baseUrl = process.env.BUDDY_MCP_URL || "http://localhost:3000";
  const url = `${baseUrl}/api/mcp`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: {
        ...params,
        bankId: BANK_ID,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as { 
    error?: { message: string }; 
    result?: unknown;
  };
  
  if (data.error) {
    throw new Error(`MCP Error: ${data.error.message}`);
  }

  return data.result;
}

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "buddy://workflows/recent",
        name: "Recent Workflows",
        description: "List of recent active deals/cases in the system",
        mimeType: "application/json",
      },
      {
        uri: "buddy://ledger/summary",
        name: "Ledger Summary",
        description: "Aggregate statistics from the observability ledger",
        mimeType: "application/json",
      },
      {
        uri: "buddy://ledger/query",
        name: "Ledger Query",
        description: "Filtered query into the canonical event ledger",
        mimeType: "application/json",
      },
    ],
  };
});

// Read a specific resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  try {
    const result = await callBuddyMcp(uri);
    
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to read resource ${uri}: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "buddy_get_case",
        description: "Get full case summary including borrower info, documents, and signals",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_get_case_documents",
        description: "Get document manifest for a case (metadata only, no file bytes)",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_get_case_signals",
        description: "Get signal ledger entries for a case",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal",
            },
            limit: {
              type: "number",
              description: "Maximum number of signals to return (default: 100)",
            },
            since: {
              type: "string",
              description: "ISO 8601 timestamp to filter signals after this time",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_get_case_ledger",
        description: "Get full event timeline for a case from canonical ledger",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal",
            },
            limit: {
              type: "number",
              description: "Maximum number of events to return (default: 100, max: 200)",
            },
            since: {
              type: "string",
              description: "ISO 8601 timestamp to filter events after this time",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_replay_case",
        description: "Re-emit all signals for a case to Omega (useful for re-syncing after data corrections)",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal to replay",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_validate_case",
        description: "Run validation checks on a case (read-only, returns check results)",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal to validate",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_generate_missing_docs_email",
        description: "Generate an email draft listing missing documents for a case",
        inputSchema: {
          type: "object",
          properties: {
            caseId: {
              type: "string",
              description: "The unique ID of the case/deal",
            },
          },
          required: ["caseId"],
        },
      },
      {
        name: "buddy_write_signal",
        description: "Write a Pulse signal into the canonical ledger",
        inputSchema: {
          type: "object",
          properties: {
            signalType: {
              type: "string",
              description: "Type of signal (e.g., 'error_spike', 'mismatch_detected', 'stale_deal', 'anomaly', 'health_check')",
              enum: ["error_spike", "mismatch_detected", "stale_deal", "anomaly", "health_check", "intake_stalled", "document_gap", "custom"],
            },
            severity: {
              type: "string",
              description: "Severity level (default: 'info')",
              enum: ["debug", "info", "warning", "error", "critical"],
            },
            dealId: {
              type: "string",
              description: "Optional deal ID if this signal is deal-specific",
            },
            payload: {
              type: "object",
              description: "Additional signal data (max 8KB)",
            },
            traceId: {
              type: "string",
              description: "Optional trace ID for correlation",
            },
          },
          required: ["signalType"],
        },
      },
      {
        name: "buddy_detect_anomalies",
        description: "Scan recent ledger events and detect anomalies (error spikes, mismatches, stale deals)",
        inputSchema: {
          type: "object",
          properties: {
            windowMinutes: {
              type: "number",
              description: "Time window to scan in minutes (default: 15, max: 60)",
            },
            errorThreshold: {
              type: "number",
              description: "Error count threshold for spike detection (default: 10)",
            },
            mismatchThreshold: {
              type: "number",
              description: "Mismatch count threshold for detection (default: 5)",
            },
            staleDealHours: {
              type: "number",
              description: "Hours without activity to consider a deal stale (default: 48)",
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let method: string;
    let params = args || {};

    // Map tool names to MCP methods
    switch (name) {
      case "buddy_get_case":
        method = `buddy://case/${params.caseId}`;
        break;
      case "buddy_get_case_documents":
        method = `buddy://case/${params.caseId}/documents`;
        break;
      case "buddy_get_case_signals":
        method = `buddy://case/${params.caseId}/signals`;
        break;
      case "buddy_get_case_ledger":
        method = `buddy://case/${params.caseId}/ledger`;
        break;
      case "buddy_replay_case":
        method = "buddy://tools/replay_case";
        break;
      case "buddy_validate_case":
        method = "buddy://tools/validate_case";
        break;
      case "buddy_generate_missing_docs_email":
        method = "buddy://tools/generate_missing_docs_email";
        break;
      case "buddy_write_signal":
        method = "buddy://tools/write_signal";
        break;
      case "buddy_detect_anomalies":
        method = "buddy://tools/detect_anomalies";
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const result = await callBuddyMcp(method, params);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Log to stderr (stdout is used for MCP protocol)
  console.error("Buddy MCP Server started");
  console.error(`Bank ID: ${BANK_ID}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

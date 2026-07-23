import "server-only";

/**
 * buddy_query — the single Realtime tool exposed to both banker and
 * borrower Buddy voice sessions. Shared by the ephemeral-token minting
 * routes (which embed it in the session config sent to OpenAI) and the
 * server-side tool-call relay routes (which validate/execute calls the
 * browser forwards) — one schema, not duplicated per call site.
 */
export const BUDDY_QUERY_TOOL = {
  type: "function",
  name: "buddy_query",
  description:
    "Resolve a gap or record a confirmed fact from the banker's answer. Use this whenever the banker provides a specific verifiable fact (dollar amount, date, percentage, name, address). Only objective, documentable facts. No subjective impressions.",
  parameters: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description:
          "The banker's answer as a structured fact. Examples: 'confirm DSCR 4.27x', 'record occupancy rate 87%', 'confirm fleet size 28 vessels', 'record collateral appraised value 2400000', 'confirm business start date 2017'",
      },
      gap_id: {
        type: "string",
        description: "Optional. The gap_queue ID this answer resolves.",
      },
      fact_key: {
        type: "string",
        description: "Optional. The specific fact key being confirmed (e.g. OCCUPANCY_RATE, FLEET_SIZE).",
      },
      value: {
        type: "string",
        description: "Optional. The raw value as a string (numeric or text).",
      },
    },
    required: ["intent"],
  },
} as const;

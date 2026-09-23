/** In-memory transport for enrichment tests; SQL ownership is tested with PGlite. */
export function reviewCheckpointRpc() {
  const rows = new Map<string, { state: unknown; revision: number; hash: string; owner: unknown }>();
  return async (_name: string, args: Record<string, any>) => {
    const key = `${args.p_bank_id}/${args.p_deal_id}/${args.p_artifact_type}/${args.p_artifact_id}`;
    const row = rows.get(key) ?? { state: null, revision: 0, hash: args.p_input_hash, owner: null };
    if (args.p_action === "claim") {
      if (row.owner) return { data: null, error: { message: "already owned" } };
      if (row.hash !== args.p_input_hash) row.state = null;
      row.hash = args.p_input_hash;
      row.owner = args.p_owner;
    } else {
      if (row.owner !== args.p_owner || row.revision !== args.p_revision)
        return { data: null, error: { message: "ownership lost" } };
      if (args.p_action === "save") row.state = structuredClone(args.p_state);
      else row.owner = null;
    }
    row.revision++;
    rows.set(key, row);
    return { data: structuredClone(row), error: null };
  };
}

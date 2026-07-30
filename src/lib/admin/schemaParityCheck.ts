// src/lib/admin/schemaParityCheck.ts
//
// SPEC-DRIFT-HARDENING-1 D3 — runtime half of the Schema Parity check.
//
// Split out from src/app/admin/brokerage/launch-readiness/page.tsx (which
// imports "server-only" and so cannot be unit-tested directly — no page.tsx
// in this repo is) so the RPC-calling logic itself is testable with a
// mocked Supabase client, following the src/lib/admin/schemaDiscovery.ts
// convention of plain, non-"server-only" admin helpers.
//
// Confirms every non-function entry in scripts/audit/schema-manifest.json
// actually exists in the LIVE schema via the buddy_table_exists /
// buddy_column_exists / buddy_view_exists RPCs. Complements
// `pnpm guard:schema-manifest` (which statically checks migration files
// against the same manifest at commit time): this catches "the manifest
// says this should exist live but it doesn't" — e.g. an authored migration
// that was never actually applied, the exact 2026-07-30 incident this spec
// exists to prevent.

export type SchemaManifestEntry = {
  name: string;
  type: "table" | "column" | "view" | "function";
  migration: string;
};

export type SchemaParityResult = {
  id: "schema_parity";
  label: string;
  status: "ok" | "warn" | "fail";
  value: string;
};

type MinimalSupabaseClient = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
};

function readExists(data: unknown, error: unknown): boolean {
  return !error && ((data as { exists?: boolean } | null)?.exists ?? false);
}

export async function checkSchemaParity(
  sb: MinimalSupabaseClient,
  manifest: SchemaManifestEntry[],
): Promise<SchemaParityResult> {
  const checkable = manifest.filter((e) => e.type !== "function");
  const missing: string[] = [];

  for (const entry of checkable) {
    if (entry.type === "table") {
      const { data, error } = await sb
        .rpc("buddy_table_exists", { p_table_name: entry.name })
        .maybeSingle();
      if (!readExists(data, error)) missing.push(`table ${entry.name}`);
    } else if (entry.type === "column") {
      const [table, column] = entry.name.split(".");
      const { data, error } = await sb
        .rpc("buddy_column_exists", { p_table_name: table, p_column_name: column })
        .maybeSingle();
      if (!readExists(data, error)) missing.push(`column ${entry.name}`);
    } else if (entry.type === "view") {
      const { data, error } = await sb
        .rpc("buddy_view_exists", { p_view_name: entry.name })
        .maybeSingle();
      if (!readExists(data, error)) missing.push(`view ${entry.name}`);
    }
  }

  return {
    id: "schema_parity",
    label: "Schema parity (manifest vs. live)",
    status: missing.length === 0 ? "ok" : missing.length <= 2 ? "warn" : "fail",
    value:
      missing.length === 0
        ? `${checkable.length} manifest entries checked, all present live`
        : `missing live: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}`,
  };
}

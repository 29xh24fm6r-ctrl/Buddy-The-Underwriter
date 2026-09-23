import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Build a read-only comparison against the exact reviewed PL/pgSQL body. */
export function handoffVerificationQuery() {
  const migration = readFileSync(new URL("../supabase/migrations/20260923010000_ensure_borrower_doc_extraction_handoff.sql", import.meta.url), "utf8");
  const body = migration.match(/\bAS \$\$([\s\S]*?)\$\$;/)?.[1];
  if (!body) throw new Error("Reviewed handoff function body was not found.");
  const literal = "'" + body.replaceAll("'", "''") + "'";
  return `SELECT COALESCE((
    SELECT p.prosrc = ${literal}
      AND NOT p.prosecdef
      AND p.prorettype = 'jsonb'::regtype
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND p.proargnames = ARRAY['p_deal_id','p_bank_id','p_document_id']
      AND p.provolatile = 'v'
      AND p.proconfig = ARRAY['search_path=public']
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_table_privilege('service_role', 'public.document_artifacts', 'SELECT')
      AND has_table_privilege('service_role', 'public.document_artifacts', 'UPDATE')
      AND has_table_privilege('service_role', 'public.buddy_outbox_events', 'SELECT')
      AND has_table_privilege('service_role', 'public.buddy_outbox_events', 'INSERT')
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.ensure_borrower_doc_extraction_handoff(uuid,uuid,uuid)')
  ), false) AS current;`;
}

function main() {
  const connection = process.env.VERIFICATION_DATABASE_URL;
  if (!connection) throw new Error("VERIFICATION_DATABASE_URL is required.");
  const result = spawnSync("psql", [connection, "-X", "--no-password", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: handoffVerificationQuery(), encoding: "utf8", timeout: 30000,
    env: { ...process.env, PGCONNECT_TIMEOUT: "15" },
  });
  // Never print the connection string or a child-process error containing it.
  if (result.error || result.status !== 0) throw new Error("Handoff verification could not query the database; check the verification connection.");
  const value = result.stdout.trim();
  if (value !== "t" && value !== "f") throw new Error("Unexpected handoff verification result.");
  const current = value === "t";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\n`);
  console.log(current ? "Deployed handoff body, permissions, and service-role table access match the reviewed contract." : "Deployed handoff requires migration; a connection that can own the function is required.");
  if (!current && process.argv.includes("--require-current")) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : "Handoff verification failed.");
    process.exitCode = 1;
  }
}

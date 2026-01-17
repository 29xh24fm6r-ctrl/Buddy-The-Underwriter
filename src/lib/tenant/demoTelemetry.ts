import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxBank } from "@/lib/tenant/sandbox";

type DemoTelemetryInput = {
  email: string | null;
  bankId?: string | null;
  path?: string | null;
  method?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  eventType: "pageview" | "click" | "action";
  label?: string | null;
  meta?: Record<string, unknown> | null;
};

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function extractDomain(email?: string | null) {
  const value = normalizeEmail(email);
  const parts = value.split("@");
  if (parts.length !== 2) return "";
  return parts[1] || "";
}

function stripQuery(path?: string | null) {
  const value = String(path || "");
  const idx = value.indexOf("?");
  if (idx === -1) return value;
  return value.slice(0, idx);
}

function shouldLogPath(path: string) {
  if (!path) return false;
  if (path.startsWith("/_next")) return false;
  if (path.startsWith("/favicon")) return false;
  if (path.startsWith("/api/qa")) return false;
  if (path.startsWith("/api/sandbox")) return true;
  if (path.startsWith("/api/")) return false;
  return true;
}

async function resolveAllowlistEntry(email: string) {
  const sb = supabaseAdmin();
  const normalizedEmail = normalizeEmail(email);
  const domain = extractDomain(normalizedEmail);

  if (!normalizedEmail && !domain) return null;

  const orFilters = [] as string[];
  if (normalizedEmail) orFilters.push(`email.eq.${normalizedEmail}`);
  if (domain) orFilters.push(`domain.eq.${domain}`);

  const { data, error } = await sb
    .from("sandbox_access_allowlist")
    .select("email, domain, role")
    .eq("enabled", true)
    .or(orFilters.join(","))
    .limit(10);

  if (error || !data?.length) return null;

  const exact = data.find(
    (row: any) => normalizeEmail(row?.email) === normalizedEmail,
  );
  return exact ?? data[0] ?? null;
}

async function insertUsageEvent(input: DemoTelemetryInput, route: string) {
  const sb = supabaseAdmin();
  const payload = {
    email: normalizeEmail(input.email),
    event_type: input.eventType,
    route,
    label: input.label ?? null,
    meta: input.meta ?? {},
  };

  await sb.from("demo_usage_events").insert(payload);
}

export async function logDemoPageviewIfApplicable(input: DemoTelemetryInput) {
  try {
    const email = normalizeEmail(input.email);
    const bankId = input.bankId ? String(input.bankId) : "";
    const rawPath = stripQuery(input.path ?? "");

    if (!email) return;
    if (!rawPath || !shouldLogPath(rawPath)) return;
    if (!bankId) return;

    const sandbox = await isSandboxBank(bankId);
    if (!sandbox) return;

    const allow = await resolveAllowlistEntry(email);
    if (!allow?.email && !allow?.domain) return;

    const sb = supabaseAdmin();
    await sb.from("demo_user_activity").upsert(
      {
        email,
        role: allow?.role ?? "banker",
        last_seen_at: new Date().toISOString(),
        last_path: rawPath,
        last_method: input.method ?? null,
        last_ip: input.ip ?? null,
        last_user_agent: input.userAgent ?? null,
      },
      { onConflict: "email" },
    );

    await insertUsageEvent(input, rawPath);
  } catch (err) {
    console.warn("[demoTelemetry] pageview log skipped", err);
  }
}

export async function logDemoUsageEvent(input: DemoTelemetryInput) {
  try {
    const email = normalizeEmail(input.email);
    const bankId = input.bankId ? String(input.bankId) : "";
    const rawPath = stripQuery(input.path ?? "");

    if (!email) return;
    if (!bankId) return;

    const sandbox = await isSandboxBank(bankId);
    if (!sandbox) return;

    const allow = await resolveAllowlistEntry(email);
    if (!allow?.email && !allow?.domain) return;

    await insertUsageEvent(input, rawPath);
  } catch (err) {
    console.warn("[demoTelemetry] usage log skipped", err);
  }
}

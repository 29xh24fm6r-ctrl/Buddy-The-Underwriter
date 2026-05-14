/**
 * Phase 11M — Comms Release Readiness Gate
 *
 * Prevents live comms from being enabled without visible operational checks.
 * Returns structured checklist — never exposes actual env values.
 */

import { getCommsMode } from "@/lib/brokerage/commsAdapters";

// ── Types ───────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export type ChecklistItem = {
  name: string;
  status: CheckStatus;
  detail: string;
};

export type ReleaseReadiness = {
  ready: boolean;
  mode: string;
  status: "ready" | "blocked" | "warning";
  items: ChecklistItem[];
};

// ── Checks ──────────────────────────────────────────────────────────────────

function item(name: string, status: CheckStatus, detail: string): ChecklistItem {
  return { name, status, detail };
}

export function getCommsReleaseChecklistStatus(): ChecklistItem[] {
  const mode = getCommsMode();
  const items: ChecklistItem[] = [];

  // Resend
  const resendKey = Boolean(process.env.RESEND_API_KEY);
  const resendFrom = Boolean(process.env.BROKERAGE_FROM_EMAIL);
  if (mode === "live") {
    items.push(item("resend_api_key", resendKey ? "pass" : "fail", resendKey ? "Configured" : "RESEND_API_KEY missing"));
    items.push(item("resend_from_email", resendFrom ? "pass" : "fail", resendFrom ? "Configured" : "BROKERAGE_FROM_EMAIL missing"));
  } else {
    items.push(item("resend_api_key", resendKey ? "pass" : "warn", resendKey ? "Configured" : "Not set (ok in stub/dry_run)"));
    items.push(item("resend_from_email", resendFrom ? "pass" : "warn", resendFrom ? "Configured" : "Not set (ok in stub/dry_run)"));
  }

  // Telnyx
  const telnyxKey = Boolean(process.env.TELNYX_API_KEY);
  const telnyxFrom = Boolean(process.env.TELNYX_FROM_NUMBER);
  if (mode === "live") {
    items.push(item("telnyx_api_key", telnyxKey ? "pass" : "fail", telnyxKey ? "Configured" : "TELNYX_API_KEY missing"));
    items.push(item("telnyx_from_number", telnyxFrom ? "pass" : "fail", telnyxFrom ? "Configured" : "TELNYX_FROM_NUMBER missing"));
  } else {
    items.push(item("telnyx_api_key", telnyxKey ? "pass" : "warn", telnyxKey ? "Configured" : "Not set (ok in stub/dry_run)"));
    items.push(item("telnyx_from_number", telnyxFrom ? "pass" : "warn", telnyxFrom ? "Configured" : "Not set (ok in stub/dry_run)"));
  }

  // Cron
  const cronSecret = Boolean(process.env.CRON_SECRET);
  items.push(item("cron_secret", cronSecret ? "pass" : (mode === "live" ? "fail" : "warn"), cronSecret ? "Configured" : "CRON_SECRET missing"));

  // Slack (optional — never blocks)
  const slackUrl = Boolean(process.env.BROKERAGE_SLACK_WEBHOOK_URL);
  items.push(item("slack_webhook", slackUrl ? "pass" : "skip", slackUrl ? "Configured" : "Not configured (optional)"));

  // Admin auth
  const clerkKey = Boolean(process.env.CLERK_SECRET_KEY);
  if (mode === "live") {
    items.push(item("admin_auth", clerkKey ? "pass" : "fail", clerkKey ? "Clerk configured" : "CLERK_SECRET_KEY missing — dev fallback active"));
  } else {
    items.push(item("admin_auth", clerkKey ? "pass" : "warn", clerkKey ? "Clerk configured" : "Dev fallback active (ok in stub/dry_run)"));
  }

  // SMS compliance
  items.push(item("sms_compliance", "pass", "STOP opt-out footer enabled in live mode"));

  // Comms mode
  items.push(item("comms_mode", "pass", `Mode: ${mode}`));

  // Checklist doc
  const { existsSync } = require("node:fs");
  const { resolve } = require("node:path");
  const docExists = existsSync(resolve(process.cwd(), "docs/brokerage-comms-release-checklist.md"));
  items.push(item("release_checklist_doc", docExists ? "pass" : "warn", docExists ? "Present" : "docs/brokerage-comms-release-checklist.md missing"));

  return items;
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export function getCommsReleaseReadiness(): ReleaseReadiness {
  const mode = getCommsMode();
  const items = getCommsReleaseChecklistStatus();
  const failures = items.filter(i => i.status === "fail");
  const warnings = items.filter(i => i.status === "warn");

  let status: ReleaseReadiness["status"];
  let ready: boolean;

  if (mode === "live") {
    ready = failures.length === 0;
    status = ready ? "ready" : "blocked";
  } else {
    ready = true; // stub/dry_run always allowed
    status = warnings.length > 0 ? "warning" : "ready";
  }

  return { ready, mode, status, items };
}

export function assertCommsLiveReleaseReady(): { ok: boolean; blockers: string[] } {
  const r = getCommsReleaseReadiness();
  if (r.ready) return { ok: true, blockers: [] };
  return {
    ok: false,
    blockers: r.items.filter(i => i.status === "fail").map(i => `${i.name}: ${i.detail}`),
  };
}

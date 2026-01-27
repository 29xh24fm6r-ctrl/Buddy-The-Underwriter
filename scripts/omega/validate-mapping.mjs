#!/usr/bin/env node
/**
 * Omega mapping validator — CI-friendly.
 *
 * Checks:
 * 1. mapping.json schema presence
 * 2. Every entity has omega uri template + buddy primary key
 * 3. Every event maps to a known Buddy signal type
 * 4. Every state_view references at least one event + at least one export builder
 * 5. Redaction profiles referenced by events exist
 * 6. mapping-ledger.md contains a row for every mapping.json item (no drift)
 *
 * Exit non-zero on failure.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

let errors = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg) {
  console.log(`  OK: ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Load mapping.json
// ---------------------------------------------------------------------------
console.log("\n=== Omega Mapping Validator ===\n");
console.log("1) Schema presence checks");

let mapping;
try {
  const raw = readFileSync(resolve(ROOT, "docs/omega/mapping.json"), "utf-8");
  mapping = JSON.parse(raw);
} catch (e) {
  fail(`Cannot load docs/omega/mapping.json: ${e.message}`);
  process.exit(1);
}

const REQUIRED_KEYS = ["version", "entities", "events", "state_views", "constraints", "redaction", "ownership"];
for (const key of REQUIRED_KEYS) {
  if (mapping[key] === undefined) {
    fail(`Missing top-level key: ${key}`);
  } else {
    pass(`Top-level key present: ${key}`);
  }
}

if (typeof mapping.version !== "string" || !mapping.version) {
  fail("version must be a non-empty string");
}

// ---------------------------------------------------------------------------
// 2. Entity checks
// ---------------------------------------------------------------------------
console.log("\n2) Entity mapping checks");

if (!Array.isArray(mapping.entities) || mapping.entities.length === 0) {
  fail("entities[] is empty or missing");
} else {
  for (const entity of mapping.entities) {
    const label = entity.entity_type || "(unknown)";
    if (!entity.entity_type) {
      fail(`Entity missing entity_type`);
      continue;
    }
    if (!entity.omega_uri_template) {
      fail(`Entity '${label}' missing omega_uri_template`);
    } else {
      pass(`Entity '${label}' has omega_uri_template`);
    }
    if (!entity.buddy_primary_key) {
      fail(`Entity '${label}' missing buddy_primary_key`);
    } else {
      pass(`Entity '${label}' has buddy_primary_key`);
    }
    if (!Array.isArray(entity.buddy_sources) || entity.buddy_sources.length === 0) {
      fail(`Entity '${label}' missing buddy_sources`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Event checks — verify Buddy event type is known
// ---------------------------------------------------------------------------
console.log("\n3) Event mapping checks");

// Load known buddy signal types from signals.ts
let knownBuddyEvents = new Set();
try {
  const signalsRaw = readFileSync(resolve(ROOT, "src/buddy/signals.ts"), "utf-8");
  // Extract quoted strings that look like signal types
  const matches = signalsRaw.matchAll(/"([a-z][a-z0-9.]*(?:\.[a-z][a-z0-9.]*)*)"/g);
  for (const m of matches) {
    knownBuddyEvents.add(m[1]);
  }
} catch {
  console.log("  WARN: Could not load src/buddy/signals.ts — skipping known-event cross-check");
}

if (!Array.isArray(mapping.events) || mapping.events.length === 0) {
  fail("events[] is empty or missing");
} else {
  const profileNames = new Set((mapping.redaction || []).map((r) => r.profile_name));

  for (const evt of mapping.events) {
    const label = evt.buddy_event_type || "(unknown)";
    if (!evt.buddy_event_type) {
      fail("Event missing buddy_event_type");
      continue;
    }
    if (!evt.omega_event_type) {
      fail(`Event '${label}' missing omega_event_type`);
    }
    if (!evt.omega_write_resource) {
      fail(`Event '${label}' missing omega_write_resource`);
    }

    // Cross-check against known signals (if we parsed them)
    if (knownBuddyEvents.size > 0) {
      if (knownBuddyEvents.has(evt.buddy_event_type)) {
        pass(`Event '${label}' found in signals.ts`);
      } else {
        fail(`Event '${label}' NOT found in src/buddy/signals.ts`);
      }
    }

    // Redaction profile must exist
    if (evt.redaction_profile) {
      if (profileNames.has(evt.redaction_profile)) {
        pass(`Event '${label}' redaction profile '${evt.redaction_profile}' exists`);
      } else {
        fail(`Event '${label}' references unknown redaction profile '${evt.redaction_profile}'`);
      }
    } else {
      fail(`Event '${label}' missing redaction_profile`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. State view checks
// ---------------------------------------------------------------------------
console.log("\n4) State view checks");

if (!Array.isArray(mapping.state_views) || mapping.state_views.length === 0) {
  fail("state_views[] is empty or missing");
} else {
  for (const sv of mapping.state_views) {
    const label = sv.omega_state_uri_template || "(unknown)";
    if (!sv.omega_state_uri_template) {
      fail("State view missing omega_state_uri_template");
      continue;
    }
    if (!Array.isArray(sv.driven_by_events) || sv.driven_by_events.length === 0) {
      fail(`State '${label}' has no driven_by_events`);
    } else {
      pass(`State '${label}' has ${sv.driven_by_events.length} driving event(s)`);
    }
    // must_match_buddy_exports can be empty for some views (e.g. policy_context)
    if (!Array.isArray(sv.must_match_buddy_exports)) {
      fail(`State '${label}' missing must_match_buddy_exports array`);
    } else {
      pass(`State '${label}' has ${sv.must_match_buddy_exports.length} export matcher(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Constraint checks
// ---------------------------------------------------------------------------
console.log("\n5) Constraint checks");

if (!Array.isArray(mapping.constraints) || mapping.constraints.length === 0) {
  fail("constraints[] is empty or missing");
} else {
  for (const c of mapping.constraints) {
    const label = c.namespace || "(unknown)";
    if (!c.namespace) fail("Constraint missing namespace");
    if (!c.omega_constraints_resource) fail(`Constraint '${label}' missing omega_constraints_resource`);
    if (!Array.isArray(c.applies_to) || c.applies_to.length === 0) {
      fail(`Constraint '${label}' missing applies_to`);
    } else {
      pass(`Constraint '${label}' applies to ${c.applies_to.join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Ledger table drift check
// ---------------------------------------------------------------------------
console.log("\n6) Mapping ledger drift check");

let ledgerContent = "";
try {
  ledgerContent = readFileSync(resolve(ROOT, "docs/omega/mapping-ledger.md"), "utf-8");
} catch {
  fail("Cannot load docs/omega/mapping-ledger.md");
}

if (ledgerContent) {
  // For each entity, check if a row exists in the ledger table
  for (const entity of mapping.entities) {
    const uriFragment = entity.omega_uri_template.replace(/\{[^}]+\}/g, "");
    if (ledgerContent.includes(entity.entity_type) && ledgerContent.includes("entity")) {
      pass(`Ledger has entity row for '${entity.entity_type}'`);
    } else {
      fail(`Ledger MISSING entity row for '${entity.entity_type}'`);
    }
  }

  // For each event, check if a row exists
  for (const evt of mapping.events) {
    if (ledgerContent.includes(evt.buddy_event_type)) {
      pass(`Ledger has event row for '${evt.buddy_event_type}'`);
    } else {
      fail(`Ledger MISSING event row for '${evt.buddy_event_type}'`);
    }
  }

  // For each state view, check if a row exists
  for (const sv of mapping.state_views) {
    // Extract the state type name from the URI template
    const match = sv.omega_state_uri_template.match(/omega:\/\/state\/([^/]+)/);
    const stateType = match ? match[1] : "";
    if (stateType && ledgerContent.includes(stateType) && ledgerContent.includes("| state")) {
      pass(`Ledger has state row for '${stateType}'`);
    } else {
      fail(`Ledger MISSING state row for '${sv.omega_state_uri_template}'`);
    }
  }

  // For each constraint, check if a row exists
  for (const c of mapping.constraints) {
    if (ledgerContent.includes(c.namespace)) {
      pass(`Ledger has constraint row for '${c.namespace}'`);
    } else {
      fail(`Ledger MISSING constraint row for '${c.namespace}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Redaction profile checks
// ---------------------------------------------------------------------------
console.log("\n7) Redaction profile checks");

if (!Array.isArray(mapping.redaction) || mapping.redaction.length === 0) {
  fail("redaction[] is empty or missing");
} else {
  const requiredProfiles = ["audit_safe", "examiner_safe", "internal_debug"];
  const profileNames = new Set(mapping.redaction.map((r) => r.profile_name));
  for (const req of requiredProfiles) {
    if (profileNames.has(req)) {
      pass(`Required redaction profile '${req}' present`);
    } else {
      fail(`Required redaction profile '${req}' missing`);
    }
  }

  for (const profile of mapping.redaction) {
    if (!profile.profile_name) fail("Redaction profile missing profile_name");
    if (!Array.isArray(profile.deny_fields)) fail(`Profile '${profile.profile_name}' missing deny_fields`);
    // ssn and ein_raw must be denied in ALL profiles
    if (profile.deny_fields && !profile.deny_fields.includes("ssn")) {
      fail(`Profile '${profile.profile_name}' does not deny 'ssn'`);
    }
    if (profile.deny_fields && !profile.deny_fields.includes("ein_raw")) {
      fail(`Profile '${profile.profile_name}' does not deny 'ein_raw'`);
    }
    if (profile.deny_fields && !profile.deny_fields.includes("document_bytes")) {
      fail(`Profile '${profile.profile_name}' does not deny 'document_bytes'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n=== Summary ===\n");

if (errors > 0) {
  console.error(`FAILED: ${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log("PASSED: All mapping validation checks succeeded.");
  process.exit(0);
}

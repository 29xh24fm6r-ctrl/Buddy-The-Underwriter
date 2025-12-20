// scripts/guard-no-legacy-reminder-fields.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Only scan code-ish files; skip deps/build
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".sql"]);
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build", ".git", ".turbo"]);

const ALLOWLIST = [
  // allow the guard scripts themselves
  "scripts/guard-no-legacy-reminder-fields.mjs",
  "scripts/guard-reminder-subscriptions-canonical.mjs",
  // allow docs or migrations if you keep examples there (optional)
  "docs/",
  "supabase/migrations/",
];

const LEGACY_PATTERNS = [
  // legacy boolean flags
  /\b(enabled|is_enabled)\b/g,
  // legacy schedule columns
  /\b(next_send_at|next_at|scheduled_at|run_at)\b/g,
];

function isAllowlisted(rel) {
  return ALLOWLIST.some((p) => rel === p || rel.startsWith(p));
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
      continue;
    }
    const fp = path.join(dir, ent.name);
    const ext = path.extname(fp);
    if (!SCAN_EXT.has(ext)) continue;
    out.push(fp);
  }
}

function fileHasReminderContext(text) {
  // Only flag if reminders table is referenced OR reminder routes/libs are involved.
  // This avoids false positives (enabled flags in unrelated code).
  return (
    text.includes("deal_reminder_subscriptions") ||
    text.includes("/reminder") ||
    text.includes("reminder_")
  );
}

function main() {
  const files = [];
  walk(path.join(ROOT, "src"), files);
  // also scan scripts (guards live here)
  if (fs.existsSync(path.join(ROOT, "scripts"))) walk(path.join(ROOT, "scripts"), files);

  const violations = [];

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (isAllowlisted(rel)) continue;

    const text = fs.readFileSync(abs, "utf8");
    if (!fileHasReminderContext(text)) continue;

    // Check if file uses canonical fields (active AND next_run_at)
    const hasActive = text.includes("active:");
    const hasNextRunAt = text.includes("next_run_at:");
    const usesCanonical = hasActive && hasNextRunAt;

    for (const re of LEGACY_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) {
        const token = m[0];
        // Allow 'enabled' as back-compat if file also uses canonical fields
        if (token === "enabled" && usesCanonical) {
          continue; // skip this violation
        }
        violations.push({ rel, token });
      }
    }
  }

  if (violations.length) {
    console.error("\n❌ Legacy reminder fields detected (canonical is: active + next_run_at)\n");
    for (const v of violations) {
      console.error(` - ${v.rel}  (found: ${v.token})`);
    }
    console.error("\nFix: replace legacy fields with active / next_run_at, or add explicit allowlist entry.\n");
    process.exit(1);
  }

  console.log("✅ Reminder canonical guard passed (no legacy fields detected).");
}

main();

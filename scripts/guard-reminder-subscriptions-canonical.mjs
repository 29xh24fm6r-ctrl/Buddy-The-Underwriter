// scripts/guard-reminder-subscriptions-canonical.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build", ".git", ".turbo"]);

const ALLOWLIST = [
  // allow the guard scripts themselves
  "scripts/guard-reminder-subscriptions-canonical.mjs",
  "scripts/guard-no-legacy-reminder-fields.mjs",
  // allow docs or migrations
  "docs/",
  "supabase/migrations/",
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

function hasReminderSubscriptionUsage(text) {
  return text.includes("deal_reminder_subscriptions");
}

function checkCanonicalUsage(text, filePath) {
  const violations = [];

  // If file doesn't use deal_reminder_subscriptions, skip it
  if (!hasReminderSubscriptionUsage(text)) return violations;

  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Only check lines that have .from("deal_reminder_subscriptions") followed by .insert
    if (line.includes('.from("deal_reminder_subscriptions")') || line.includes(".from('deal_reminder_subscriptions')")) {
      // Look ahead to see if this is an insert operation
      let insertFound = false;
      let hasActive = false;
      let hasNextRunAt = false;
      let foundInsertLine = false;

      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        const nextLine = lines[j];
        
        // Skip if this is a select/update/delete operation
        if (nextLine.includes(".select(") || nextLine.includes(".update(") || nextLine.includes(".delete(")) {
          break;
        }
        
        if (nextLine.includes(".insert(")) {
          insertFound = true;
          foundInsertLine = true;
        }
        if (insertFound) {
          if (nextLine.includes("active:")) hasActive = true;
          if (nextLine.includes("next_run_at:")) hasNextRunAt = true;
          // End of insert block
          if (nextLine.includes("})") && (nextLine.includes(".select") || nextLine.includes(";"))) {
            break;
          }
        }
      }

      if (foundInsertLine && (!hasActive || !hasNextRunAt)) {
        violations.push({
          line: lineNum,
          issue: `Insert into deal_reminder_subscriptions missing canonical fields (need both: active, next_run_at)`,
        });
      }
    }

    // Check for queries using only enabled (must also use active or next_run_at)
    if ((line.includes('.eq("enabled"') || line.includes(".eq('enabled'")) && 
        line.includes("deal_reminder")) {
      // Look for canonical fields in nearby context
      let hasCanonical = false;
      for (let j = Math.max(0, i - 10); j < Math.min(i + 10, lines.length); j++) {
        const contextLine = lines[j];
        if (contextLine.includes('.eq("active"') || contextLine.includes('.lte("next_run_at"') ||
            contextLine.includes(".eq('active'") || contextLine.includes(".lte('next_run_at'")) {
          hasCanonical = true;
          break;
        }
      }
      if (!hasCanonical) {
        violations.push({
          line: lineNum,
          issue: `Query uses .eq("enabled") without canonical fields (active, next_run_at)`,
        });
      }
    }
  }

  return violations;
}

function main() {
  const files = [];
  walk(path.join(ROOT, "src"), files);

  const allViolations = [];

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (isAllowlisted(rel)) continue;

    const text = fs.readFileSync(abs, "utf8");
    const violations = checkCanonicalUsage(text, abs);

    if (violations.length) {
      allViolations.push({ file: rel, violations });
    }
  }

  if (allViolations.length) {
    console.error("\n❌ Reminder subscription canonical violations detected:\n");
    for (const { file, violations } of allViolations) {
      console.error(`\n  ${file}:`);
      for (const v of violations) {
        console.error(`    Line ${v.line}: ${v.issue}`);
      }
    }
    console.error("\nFix: Ensure all inserts include 'active' and 'next_run_at' fields.");
    console.error("Fix: Queries using 'enabled' must also use canonical fields (active, next_run_at).\n");
    process.exit(1);
  }

  console.log("✅ Reminder subscription canonical guard passed.");
}

main();

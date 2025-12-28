import { execSync } from "node:child_process";

const bad = [
  "cloud_upload",
  "auto_awesome",
  "check_circle",
  "arrow_forward_ios",
  "chevron_left",
  "chevron_right",
  "material-icons",
  "material-symbols",
];

let out = "";
try {
  // Escape special regex characters and build pattern
  const pattern = bad.map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  out = execSync(`rg -n "${pattern}" src/app src/components src/lib -S || true`, {
    encoding: "utf8",
  });
} catch (err) {
  // rg not found or error - ignore for now
  console.log("⚠️  ripgrep (rg) not found, skipping icon token check");
  process.exit(0);
}

if (out.trim().length === 0) {
  console.log("✅ No material icon tokens found");
  process.exit(0);
}

console.error("❌ Found icon token/webfont usage. Replace with <Icon name=...> or lucide components.\n");
console.error(out);
process.exit(1);

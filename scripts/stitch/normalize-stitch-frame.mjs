#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const p = path.resolve(process.cwd(), "src/components/stitch/StitchFrame.tsx");
if (!fs.existsSync(p)) {
  console.error(`❌ Not found: ${p}`);
  process.exit(1);
}
let s = fs.readFileSync(p, "utf8");

// Ensure wrapper has predictable layout + no inherited transforms.
const needle = /return\s*\(\s*<div[^>]*>/m;
if (!needle.test(s)) {
  console.error("❌ Could not find StitchFrame return wrapper <div ...>. Open the file and paste the first ~120 lines if this fails.");
  process.exit(1);
}

// Inject normalization styles by augmenting the top-level wrapper div inline style/class handling.
// Strategy: add a data attr + style reset on the wrapper, then apply a scoped CSS block inside the component.
if (!s.includes("data-stitch-root")) {
  s = s.replace(
    needle,
    (m) => m.replace("<div", `<div data-stitch-root`)
  );
}

if (!s.includes("/* STITCH_NORMALIZE_START */")) {
  // Add a scoped style tag near the bodyHtml injection, but inside the component.
  // Find a good insertion point: just before the main content render closes.
  const insertPoint = /(\{\/\*\s*end\s*of\s*tailwind\s*\/\*\s*\}|\}\s*<\/div>\s*\)\s*;)/m;

  // If we can't find a fancy point, insert before the final closing of the returned wrapper div.
  const fallback = /(\s*<\/div>\s*\)\s*;)/m;

  const cssBlock = `
      {/* STITCH_NORMALIZE_START */}
      <style>{\`
        /* Scope all resets to StitchFrame only */
        [data-stitch-root]{
          width: 100%;
          min-height: 100vh;
          max-width: none !important;
          transform: none !important;
          zoom: 1 !important;
        }
        [data-stitch-root] *{
          transform: none;
        }
        /* Prevent parent app styles from constraining Stitch layout */
        [data-stitch-root] .stitch-body{
          width: 100%;
          max-width: none !important;
        }
      \`}</style>
      {/* STITCH_NORMALIZE_END */}
`;

  if (insertPoint.test(s)) {
    s = s.replace(insertPoint, `${cssBlock}\n$1`);
  } else if (fallback.test(s)) {
    s = s.replace(fallback, `${cssBlock}\n$1`);
  } else {
    console.error("❌ Could not find a place to inject normalization CSS. Open StitchFrame.tsx and paste it here.");
    process.exit(1);
  }

  // Ensure we have a predictable class on the inner html container to target.
  // Common pattern: dangerouslySetInnerHTML with a wrapping div; add className="stitch-body" if missing.
  s = s.replace(
    /(<div)([^>]*dangerouslySetInnerHTML=\{)/m,
    (m, a, b) => {
      if (m.includes('className="stitch-body"') || m.includes("className={'stitch-body'") || m.includes("className={`stitch-body")) return m;
      // Insert className before dangerouslySetInnerHTML
      return `${a} className="stitch-body"${b}`;
    }
  );
}

fs.writeFileSync(p, s);
console.log(`✅ Normalized: ${p}`);

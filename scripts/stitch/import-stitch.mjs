import fs from "node:fs";
import path from "node:path";

const read = (f) => fs.readFileSync(f, "utf8");
const strip = (s) => (s ?? "").trim();
const esc = (s) => s.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

function extract(html) {
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);

  const linkHrefs = [];
  const linkRe = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) linkHrefs.push(m[1]);
  const fontLinks = [...new Set(linkHrefs)];

  const tailwindCdnSrc =
    strip(html.match(/<script[^>]*src="(https:\/\/cdn\.tailwindcss\.com[^"]+)"[^>]*><\/script>/i)?.[1]) ||
    "https://cdn.tailwindcss.com?plugins=forms,container-queries";

  const twConfig =
    strip(html.match(/<script[^>]*id="tailwind-config"[^>]*>([\s\S]*?)<\/script>/i)?.[1]) ||
    strip(html.match(/<script[^>]*>([\s\S]*tailwind\.config[\s\S]*?)<\/script>/i)?.[1]) ||
    "";

  const styles = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(html))) styles.push(strip(m[1]));
  const stylesClean = styles.filter(Boolean);

  const bodyInner = strip(html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "");

  return { title, fontLinks, tailwindCdnSrc, twConfig, styles: stylesClean, bodyInner };
}

function buildTsx({ title, fontLinks, tailwindCdnSrc, twConfig, styles, bodyInner }) {
  return `import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = ${JSON.stringify(title || "Buddy")};
const FONT_LINKS = ${JSON.stringify(fontLinks, null, 2)};
const TAILWIND_CDN = ${JSON.stringify(tailwindCdnSrc)};
const TAILWIND_CONFIG_JS = \`${esc(twConfig)}\`;
const STYLES = ${JSON.stringify(styles, null, 2)};
const BODY_HTML = \`${esc(bodyInner)}\`;

export default function Page() {
  return (
    <StitchFrame
      title={TITLE}
      fontLinks={FONT_LINKS}
      tailwindCdnSrc={TAILWIND_CDN}
      tailwindConfigJs={TAILWIND_CONFIG_JS}
      styles={STYLES}
      bodyHtml={BODY_HTML}
    />
  );
}
`;
}

const [,, inHtml, outTsx] = process.argv;
if (!inHtml || !outTsx) {
  console.error("Usage: node scripts/stitch/import-stitch.mjs <input-code.html> <output-page.tsx>");
  process.exit(1);
}

const html = read(inHtml);
const extracted = extract(html);
const tsx = buildTsx(extracted);

fs.mkdirSync(path.dirname(outTsx), { recursive: true });
fs.writeFileSync(outTsx, tsx, "utf8");
console.log(`✅ Generated: ${outTsx}`);

"use client";

import { useEffect, useMemo, useRef, useState, type MouseEventHandler } from "react";
import { useRouter } from "next/navigation";
import { resolveStitchHref } from "@/lib/stitch/resolveStitchHref";
import { installStitchNavigationGuard } from "@/lib/stitch/stitchGuard";

type StitchFrameProps = {
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
  title: string;
  fontLinks?: string[];
  tailwindCdnSrc: string;
  tailwindConfigJs?: string;
  styles?: string[];
  bodyHtml: string;
};

export default function StitchFrame({
  title,
  fontLinks = [],
  tailwindCdnSrc,
  tailwindConfigJs,
  styles = [],
  bodyHtml,
  onClick,
  className,
}: StitchFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const router = useRouter();
  
  // Debug mode (add ?stitchDebug=1 to URL)
  const stitchDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("stitchDebug") === "1";

  // Set mounted flag to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const srcDoc = useMemo(() => {
    // Parent origin (real page origin). We inject this into srcDoc to avoid iframe origin = "null".
    // Only use window.location.origin after mounting to avoid hydration mismatch
    const parentOrigin = mounted && typeof window !== "undefined" ? window.location.origin : "";

    const links = fontLinks.map((href) => `<link rel="stylesheet" href="${href}" />`).join("\n");

    const styleBlock = styles.length
      ? `<style>\n${styles.join("\n\n")}\n</style>`
      : "";

    const tw = tailwindCdnSrc ? `<script src="${tailwindCdnSrc}"></script>` : "";
    const twCfg = tailwindConfigJs ? `<script>${tailwindConfigJs}</script>` : "";

    // Bridge script runs inside iframe; posts its content height to parent.
    // TARGET_ORIGIN is injected from parent to avoid using iframe window.location.origin (often "null").
    const bridge = `
<script>
(function () {
  const TARGET_ORIGIN = ${JSON.stringify(parentOrigin)};
  function postHeight() {
    try {
      var doc = document.documentElement;
      var body = document.body;
      var h = Math.max(
        doc ? doc.scrollHeight : 0,
        body ? body.scrollHeight : 0,
        doc ? doc.offsetHeight : 0,
        body ? body.offsetHeight : 0
      );
      parent.postMessage({ __stitchFrame: true, type: "height", height: h }, TARGET_ORIGIN);
    } catch (e) {}
  }

  // Initial + on resize
  window.addEventListener("load", function () { postHeight(); });
  window.addEventListener("resize", function () { postHeight(); });

  // Observe DOM mutations (Tailwind, collapsibles, async content)
  try {
    var mo = new MutationObserver(function () { postHeight(); });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  } catch (e) {}

  // Also ping periodically for a short window (handles late fonts/images)
  var n = 0;
  var t = setInterval(function () {
    postHeight();
    n++;
    if (n > 30) clearInterval(t);
  }, 250);
})();
</script>`.trim();

    // Navigation interceptor - captures clicks on links and posts to parent
    const navigationScript = `
<script>
(function () {
  const TARGET_ORIGIN = ${JSON.stringify(parentOrigin)};
  
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target) return;
    
    // Find the nearest anchor tag
    var anchor = target.closest ? target.closest("a") : null;
    if (!anchor) return;
    
    var href = anchor.getAttribute("href");
    if (!href) return;
    
    // Post to parent for route resolution
    parent.postMessage({ 
      __stitchFrame: true, 
      type: "navigate", 
      href: href 
    }, TARGET_ORIGIN);
    
    // Prevent default navigation
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
</script>`.trim();

    return [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      links,
      tw,
      twCfg,
      styleBlock,
      "</head>",
      "<body>",
      bodyHtml,
      bridge,
      navigationScript,
      "</body>",
      "</html>",
    ].filter(Boolean).join("\n");
  }, [title, fontLinks, tailwindCdnSrc, tailwindConfigJs, styles, bodyHtml, mounted]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const d = ev.data as any;
      if (!d || d.__stitchFrame !== true) return;

      // Lock to same-origin parent
      if (typeof window !== "undefined" && ev.origin !== window.location.origin) return;

      // Handle height updates
      if (d.type === "height") {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const h = Number(d.height);
        if (!Number.isFinite(h) || h <= 0) return;

        iframe.style.height = `${Math.ceil(h)}px`;
        return;
      }

      // Handle navigation requests from iframe
      if (d.type === "navigate") {
        const href = d.href;
        if (!href) return;

        const resolved = resolveStitchHref(href);
        if (resolved) {
          router.push(resolved);
        } else {
          // External link or unmatched - open in new tab
          if (href.startsWith("http")) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        }
        return;
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  // Install navigation guard on iframe load
  useEffect(() => {
    if (iframeRef.current) {
      installStitchNavigationGuard(iframeRef.current);
    }
  }, []);

  return (
    <div onClick={onClick} className={className}>
      {stitchDebug && (
        <div
          style={{
            position: "fixed",
            bottom: 12,
            left: 12,
            zIndex: 99999,
            padding: 10,
            borderRadius: 8,
            background: "rgba(0,0,0,0.85)",
            color: "white",
            fontSize: 12,
            maxWidth: 520,
            fontFamily: "monospace",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>
            🔍 STITCH_DEBUG
          </div>
          <div>title: {title}</div>
          <div>bodyHtml length: {bodyHtml?.length ?? 0}</div>
          <div>
            srcDoc starts with &lt;!doctype:{" "}
            {String(srcDoc.trimStart().toLowerCase().startsWith("<!doctype"))}
          </div>
          <div>
            srcDoc contains &lt;!doctype (escaped):{" "}
            {String(srcDoc.includes("&lt;!doctype"))}
          </div>
          <div>
            bodyHtml starts with &lt;:{" "}
            {String((bodyHtml ?? "").trimStart().startsWith("<"))}
          </div>
          <div>
            bodyHtml contains &lt; (escaped):{" "}
            {String((bodyHtml ?? "").includes("&lt;"))}
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcDoc}
        style={{ width: "100%", height: 900, border: 0, display: "block" }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      />
    </div>
  );
}

"use client";

import React from "react";

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Minimal markdown renderer (SAFE):
 * - No HTML parsing
 * - Whitelisted formatting only
 */
export function SafeMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");

  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("```")) {
      const fence = line;
      const lang = fence.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="rounded-xl bg-slate-950 text-slate-50 p-4 overflow-x-auto text-sm"
        >
          {lang ? <div className="text-xs text-slate-300 mb-2">{lang}</div> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="text-base font-semibold mt-4">
          {line.slice(4)}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="text-lg font-semibold mt-5">
          {line.slice(3)}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-xl font-semibold mt-6">
          {line.slice(2)}
        </h1>,
      );
      i++;
      continue;
    }

    if (line.trim().startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("- ")) {
        items.push((lines[i] ?? "").trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-6 space-y-1">
          {items.map((it, idx) => (
            <li
              key={idx}
              className="text-sm text-slate-800"
              dangerouslySetInnerHTML={{ __html: inlineFormat(escapeHtml(it)) }}
            />
          ))}
        </ul>,
      );
      continue;
    }

    if (line.trim() === "") {
      blocks.push(<div key={`sp-${blocks.length}`} className="h-3" />);
      i++;
      continue;
    }

    blocks.push(
      <p
        key={`p-${blocks.length}`}
        className="text-sm text-slate-800 leading-6"
        dangerouslySetInnerHTML={{ __html: inlineFormat(escapeHtml(line)) }}
      />,
    );
    i++;
  }

  return <div className="space-y-2">{blocks}</div>;
}

function inlineFormat(s: string) {
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(
    /`(.+?)`/g,
    '<code class="px-1 py-0.5 rounded bg-slate-100 text-slate-900">$1</code>',
  );
  return s;
}

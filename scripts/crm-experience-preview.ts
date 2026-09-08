/** Read-only visual fixture. Not a Next route; never connects to real CRM data. */
import React from "react";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CrmToday } from "../src/components/brokerage/CrmToday";
import { CrmWorkspaceNav } from "../src/components/brokerage/CrmWorkspaceNav";

const css = readFileSync("src/app/admin/brokerage/crm/experience.css", "utf8");
const now = Date.parse("2026-09-02T12:00:00Z");
createServer((req, res) => {
  const state = new URL(req.url || "/", "http://localhost").searchParams.get("state");
  const content = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(CrmWorkspaceNav, { section: "today", pathname: "/admin/brokerage/crm" }),
    React.createElement(CrmToday, {
      now, loading: state === "loading", error: state === "error" ? "Fixture failure" : null, onRetry() {},
      tasks: state === "empty" ? [] : [{ id: "task-demo", title: "Follow up after the introductory call", due_at: "2026-09-01T12:00:00Z", organizationId: "demo", organizationName: "Example Partners" }],
      relationships: state === "empty" ? [] : [{ id: "demo", name: "Example Partners", health: "cooling", lastActivityAt: "2026-07-30T12:00:00Z" }],
      activity: [],
    })));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRM visual fixture</title><style>body{margin:0;background:#f7f5f0;font-family:Arial,sans-serif}main{max-width:1280px;margin:auto;padding:24px;box-sizing:border-box}*{box-sizing:border-box}${css}</style></head><body><main><p>LOCAL VISUAL FIXTURE — synthetic records; static controls</p>${content}</main></body></html>`);
}).listen(4317, "127.0.0.1", () => console.log("CRM visual fixture: http://127.0.0.1:4317 (synthetic, read-only)"));

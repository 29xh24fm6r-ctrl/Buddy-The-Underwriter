type MemoJson = {
  meta: {
    dealId: string;
    memoVersion: string;
    generatedAt: string;
    recommendedDecision: string;
    confidence: number;
  };
  cockpit: {
    keyMetrics: Record<string, string | number>;
    riskRadar: Array<{ category: string; score: number; note: string }>;
    missingItems: Array<{ item: string; why: string }>;
  };
  sections: Array<{
    id: string;
    title: string;
    bullets?: string[];
    body?: string;
    tables?: Array<{
      title?: string;
      columns: string[];
      rows: Array<Array<string | number>>;
    }>;
  }>;
  evidence: Array<{ label: string; source: string; note?: string; confidence?: number }>;
  warnings: string[];
};

function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function metricValue(v: any) {
  if (typeof v === "number") return v.toLocaleString();
  return String(v ?? "");
}

export function buildAdvancedCreditMemoHtml(memo: MemoJson) {
  const { meta, cockpit, sections, evidence, warnings } = memo;

  const css = `
    <style>
      :root{
        --bg:#0b1020;
        --card:#111a33;
        --muted:#98a2b3;
        --text:#e7eaf0;
        --ink:#0b0f1a;
        --paper:#ffffff;
        --line:#e6e8ee;
        --soft:#f6f7fb;
      }
      *{ box-sizing:border-box; }
      body{
        margin:0;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial;
        color:var(--ink);
        background:var(--paper);
      }
      .page{
        width:100%;
      }
      .hero{
        border-radius:18px;
        padding:18px 18px 14px;
        background:linear-gradient(135deg, #0b1020 0%, #0f1a3a 40%, #111a33 100%);
        color:var(--text);
        margin-bottom:14px;
      }
      .heroTop{
        display:flex; gap:12px; align-items:flex-start; justify-content:space-between;
      }
      .title{
        font-size:18px; font-weight:800; letter-spacing:.2px;
      }
      .sub{
        margin-top:4px; color:var(--muted); font-size:11px;
      }
      .decision{
        min-width:260px;
        border-radius:16px;
        background:rgba(255,255,255,.08);
        border:1px solid rgba(255,255,255,.14);
        padding:12px;
      }
      .decisionLabel{ font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.9px; }
      .decisionValue{ font-size:15px; font-weight:800; margin-top:6px; }
      .confidence{ margin-top:8px; font-size:11px; color:var(--muted); }
      .grid{
        display:grid;
        grid-template-columns: 1.1fr .9fr;
        gap:12px;
        margin-top:12px;
      }
      .card{
        border-radius:16px;
        border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.06);
        padding:12px;
      }
      .card h3{
        margin:0 0 8px;
        font-size:11px;
        color:var(--muted);
        text-transform:uppercase;
        letter-spacing:.9px;
      }
      .metrics{
        display:grid;
        grid-template-columns:repeat(3, 1fr);
        gap:8px;
      }
      .metric{
        border-radius:12px;
        background:rgba(255,255,255,.06);
        border:1px solid rgba(255,255,255,.10);
        padding:10px;
        min-height:58px;
      }
      .metric .k{ font-size:10px; color:var(--muted); }
      .metric .v{ margin-top:6px; font-size:13px; font-weight:800; color:var(--text); }
      .radarRow{
        display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
        border-top:1px solid rgba(255,255,255,.10);
        padding-top:8px; margin-top:8px;
      }
      .radarRow:first-child{ border-top:none; padding-top:0; margin-top:0; }
      .radarCat{ font-size:12px; font-weight:700; color:var(--text); }
      .radarNote{ font-size:10px; color:var(--muted); margin-top:2px; }
      .score{
        font-size:12px;
        font-weight:800;
        color:var(--text);
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.08);
        white-space:nowrap;
      }
      .paper{
        margin-top:14px;
      }
      .section{
        border:1px solid var(--line);
        border-radius:16px;
        padding:14px;
        margin:10px 0;
        background:var(--paper);
      }
      .sectionTitle{
        font-size:13px;
        font-weight:900;
        margin:0;
      }
      .sectionBody{
        margin-top:8px;
        font-size:11.5px;
        color:#1f2937;
        line-height:1.45;
        white-space:pre-wrap;
      }
      .bullets{ margin:8px 0 0 18px; font-size:11.5px; color:#1f2937; }
      .tableWrap{ margin-top:10px; border-radius:12px; overflow:hidden; border:1px solid var(--line); }
      table{ border-collapse:collapse; width:100%; font-size:10.5px; }
      thead{ background:var(--soft); }
      th, td{ padding:8px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
      th{ text-align:left; font-weight:800; color:#0f172a; }
      .tableTitle{
        font-size:11px;
        font-weight:800;
        padding:8px 10px;
        background:var(--soft);
        border-bottom:1px solid var(--line);
      }
      .small{
        font-size:10px;
        color:#6b7280;
      }
      .warn{
        border:1px solid #fde68a;
        background:#fffbeb;
        border-radius:14px;
        padding:10px;
        font-size:11px;
        margin-top:10px;
      }
      .evidence{
        border-top:1px dashed var(--line);
        margin-top:12px;
        padding-top:10px;
      }
      .evidenceItem{
        padding:8px 10px;
        border:1px solid var(--line);
        border-radius:12px;
        margin-top:8px;
        font-size:10.5px;
      }
      .evLabel{ font-weight:800; }
      .evSource{ color:#6b7280; margin-top:2px; }
    </style>
  `;

  const metrics = Object.entries(cockpit?.keyMetrics ?? {}).slice(0, 12);

  const metricsHtml = `
    <div class="metrics">
      ${metrics
        .map(
          ([k, v]) => `
          <div class="metric">
            <div class="k">${esc(k)}</div>
            <div class="v">${esc(metricValue(v))}</div>
          </div>
        `
        )
        .join("")}
    </div>
  `;

  const radarHtml = (cockpit?.riskRadar ?? [])
    .slice(0, 10)
    .map(
      (r) => `
      <div class="radarRow">
        <div>
          <div class="radarCat">${esc(r.category)}</div>
          <div class="radarNote">${esc(r.note)}</div>
        </div>
        <div class="score">${esc(r.score)}/5</div>
      </div>
    `
    )
    .join("");

  const missingHtml = (cockpit?.missingItems ?? []).slice(0, 8);
  const missingBlock =
    missingHtml.length === 0
      ? `<div class="small">No critical missing items flagged.</div>`
      : `<ul class="bullets">${missingHtml
          .map((m) => `<li><b>${esc(m.item)}</b> — ${esc(m.why)}</li>`)
          .join("")}</ul>`;

  const sectionHtml = (sections ?? [])
    .map((s) => {
      const bullets = (s.bullets ?? []).length
        ? `<ul class="bullets">${s.bullets!.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
        : "";

      const tables = (s.tables ?? [])
        .map((t) => {
          const title = t.title ? `<div class="tableTitle">${esc(t.title)}</div>` : "";
          const head = `<thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`;
          const body = `<tbody>${t.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody>`;
          return `<div class="tableWrap">${title}<table>${head}${body}</table></div>`;
        })
        .join("");

      return `
        <div class="section">
          <h2 class="sectionTitle">${esc(s.title)}</h2>
          ${s.body ? `<div class="sectionBody">${esc(s.body)}</div>` : ""}
          ${bullets}
          ${tables}
        </div>
      `;
    })
    .join("");

  const warningsHtml =
    (warnings ?? []).length > 0
      ? `<div class="warn"><b>Warnings / Assumptions</b><ul class="bullets">${warnings
          .slice(0, 12)
          .map((w) => `<li>${esc(w)}</li>`)
          .join("")}</ul></div>`
      : "";

  const evidenceHtml =
    (evidence ?? []).length > 0
      ? `
        <div class="evidence">
          <div class="small"><b>Evidence Map (high-level)</b></div>
          ${(evidence ?? []).slice(0, 16).map((e) => `
            <div class="evidenceItem">
              <div class="evLabel">${esc(e.label)}</div>
              <div class="evSource">${esc(e.source)}${e.note ? ` • ${esc(e.note)}` : ""}</div>
            </div>
          `).join("")}
        </div>
      `
      : "";

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        ${css}
      </head>
      <body>
        <div class="page">
          <div class="hero">
            <div class="heroTop">
              <div>
                <div class="title">Advanced Credit Memo • Write-up & Credit Authorization</div>
                <div class="sub">Deal: ${esc(meta.dealId)} • Version: ${esc(meta.memoVersion)} • Generated: ${esc(meta.generatedAt)}</div>
              </div>
              <div class="decision">
                <div class="decisionLabel">Recommended Decision</div>
                <div class="decisionValue">${esc(meta.recommendedDecision)}</div>
                <div class="confidence">Confidence: ${Math.round((meta.confidence ?? 0.6) * 100)}%</div>
              </div>
            </div>

            <div class="grid">
              <div class="card">
                <h3>Key Metrics</h3>
                ${metricsHtml}
              </div>
              <div class="card">
                <h3>Risk Radar</h3>
                ${radarHtml || `<div class="small">No radar provided.</div>`}
                <div style="margin-top:10px;">
                  <h3>Missing Items</h3>
                  ${missingBlock}
                </div>
              </div>
            </div>
          </div>

          <div class="paper">
            ${warningsHtml}
            ${sectionHtml}
            ${evidenceHtml}
          </div>
        </div>
      </body>
    </html>
  `;
}

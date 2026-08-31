"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { US_STATES } from "@/lib/crm/geography";
import { directDealDocumentUpload } from "@/lib/uploads/uploadFile";

/**
 * The brokerage's single deal front door.
 *
 * The two things this fixes are both about the moment a broker loads their
 * own deal. First, there is one form now rather than two rival ones whose
 * difference was invisible from the outside. Second, the financials attach
 * here: the previous flow created a four-field stub and told the broker to
 * go and find the document workspace, which meant the deal sat empty for as
 * long as that took.
 *
 * Files go through directDealDocumentUpload — the canonical signed-URL
 * ingest path every other uploader in the product uses — rather than a new
 * server route, so these documents classify, dedupe, and appear in the deal
 * cockpit exactly like any other upload.
 */

type Organization = { id: string; name: string; organization_type: string };

const PRODUCTS: Array<[string, string]> = [
  ["SBA_7A", "SBA 7(a)"],
  ["SBA_504", "SBA 504"],
  ["SBA_EXPRESS", "SBA Express"],
  ["TERM_LOAN", "Conventional term loan"],
  ["LINE_OF_CREDIT", "Line of credit"],
  ["CRE_OWNER_OCCUPIED", "Owner-occupied CRE"],
  ["CRE_INVESTOR", "Investor CRE"],
];

const INTAKE_MODES: Array<[string, string, string]> = [
  ["self_sourced", "I sourced it", "My own deal, run end to end in Buddy."],
  ["referred", "A partner referred it", "Credit the referral source and track the relationship."],
  ["tracking_only", "Tracking only", "Off-platform deal I only want to distribute and track."],
];

const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  borderRadius: 5,
  border: `1px solid ${c.borderStrong}`,
  background: c.inkHeader,
  color: c.paper,
  fontSize: 13,
};

const labelStyle: React.CSSProperties = { display: "grid", gap: 6, color: c.textSecondary, fontSize: 11.5 };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: `1px solid ${c.border}`, borderRadius: 8, background: c.card, padding: 18 }}>
      <h2 style={{ margin: "0 0 3px", color: c.paper, fontSize: 14.5, fontWeight: 650 }}>{title}</h2>
      {hint && <p style={{ margin: "0 0 14px", color: c.textMuted, fontSize: 11.5 }}>{hint}</p>}
      <div style={{ display: "grid", gap: 14 }}>{children}</div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SelfSourcedDealForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [intakeMode, setIntakeMode] = useState("self_sourced");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/brokerage/crm/organizations")
      .then((res) => res.json())
      .then((json) => {
        if (active && json?.ok) setOrganizations(json.organizations ?? []);
      })
      .catch(() => {
        // A referral source is optional; failing to load the list must not
        // block the broker from saving the deal.
      });
    return () => { active = false; };
  }, []);

  const referralSources = useMemo(
    () => organizations.filter((o) => o.organization_type !== "borrower_business"),
    [organizations],
  );

  const addFiles = useCallback((incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const next = Array.from(incoming);
    setFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}:${f.size}`));
      return [...current, ...next.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProgress("Creating the deal…");

    const fd = new FormData(event.currentTarget);
    const payload = Object.fromEntries(fd.entries());

    let dealId: string;
    try {
      const res = await fetch("/api/admin/brokerage/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not create the deal.");
      dealId = data.dealId;
      if (Array.isArray(data.warnings) && data.warnings.length) {
        // The deal exists — say what did not attach rather than failing.
        setError(data.warnings.join(" "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
      setBusy(false);
      return;
    }

    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`Uploading ${file.name} (${i + 1} of ${files.length})…`);
      const result = await directDealDocumentUpload({ dealId, file, source: "internal" });
      if (!result.ok) failed.push(file.name);
    }

    if (failed.length) {
      // Never strand the broker on this page with a deal that already exists.
      setProgress(null);
      setBusy(false);
      setError(
        `The deal was created, but ${failed.length} file${failed.length === 1 ? "" : "s"} did not upload (${failed.join(", ")}). ` +
        `Open the deal and add ${failed.length === 1 ? "it" : "them"} from its document workspace.`,
      );
      router.push(`/admin/brokerage/pipeline/${dealId}`);
      return;
    }

    router.push(`/admin/brokerage/pipeline/${dealId}`);
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 760, display: "grid", gap: 16 }}>
      <Section title="How this deal reached you" hint="Sets how it is grouped in the pipeline and how the referral is credited.">
        <div style={{ display: "grid", gap: 8 }}>
          {INTAKE_MODES.map(([value, title, description]) => (
            <label
              key={value}
              style={{
                display: "flex",
                gap: 11,
                alignItems: "flex-start",
                padding: "11px 13px",
                borderRadius: 6,
                cursor: "pointer",
                border: `1px solid ${intakeMode === value ? c.brass : c.border}`,
                background: intakeMode === value ? "rgba(184,144,91,.08)" : "transparent",
              }}
            >
              <input
                type="radio"
                name="intakeMode"
                value={value}
                checked={intakeMode === value}
                onChange={() => setIntakeMode(value)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ display: "block", color: c.paper, fontSize: 12.5, fontWeight: 600 }}>{title}</span>
                <span style={{ display: "block", color: c.textMuted, fontSize: 11.5, marginTop: 2 }}>{description}</span>
              </span>
            </label>
          ))}
        </div>

        {intakeMode === "referred" && (
          <label style={labelStyle}>
            Referral source
            <select name="referralOrganizationId" style={input} defaultValue="">
              <option value="">Not recorded</option>
              {referralSources.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        )}

        <label style={labelStyle}>
          How it came to you
          <input name="externalDealSource" maxLength={120} style={input} placeholder="Banker handoff, CPA introduction, walk-in…" />
        </label>
      </Section>

      <Section title="The business">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={labelStyle}>Business or deal name<input name="businessName" required maxLength={160} style={input} placeholder="Gulf Coast Marine" /></label>
          <label style={labelStyle}>Primary borrower / guarantor<input name="borrowerName" required maxLength={160} style={input} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <label style={labelStyle}>
            Entity type
            <select name="entityType" style={input} defaultValue="Unknown">
              <option>Unknown</option><option>LLC</option><option>Corporation</option>
              <option>Partnership</option><option>Sole Proprietorship</option>
            </select>
          </label>
          <label style={labelStyle}>
            State
            <select name="stateCode" style={input} defaultValue="">
              <option value="">Not recorded</option>
              {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>City<input name="city" maxLength={80} style={input} /></label>
        </div>
        <label style={labelStyle}>
          NAICS code
          <input name="naicsCode" maxLength={6} inputMode="numeric" style={input} placeholder="336612 — boat building" />
          <span style={{ color: c.textMuted, fontSize: 10.5 }}>
            Two to six digits. Used to match banks whose appetite names an industry.
          </span>
        </label>
      </Section>

      <Section title="The request">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={labelStyle}>Requested loan amount<input name="loanAmount" type="number" min="1" max="100000000" step="1" required style={input} /></label>
          <label style={labelStyle}>
            Loan program
            <select name="productType" style={input} defaultValue="SBA_7A">
              {PRODUCTS.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Who to talk to" hint="Saved as a contact on the borrower's CRM record, so the relationship and the deal stay one thing.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={labelStyle}>Contact name<input name="contactName" maxLength={160} style={input} /></label>
          <label style={labelStyle}>Title<input name="contactJobTitle" maxLength={120} style={input} placeholder="Owner" /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={labelStyle}>Email<input name="contactEmail" type="email" maxLength={200} style={input} /></label>
          <label style={labelStyle}>Phone<input name="contactPhone" maxLength={40} style={input} /></label>
        </div>
      </Section>

      <Section title="The financials" hint="Tax returns, personal financial statements, debt schedules — anything you already have. They upload into this deal's secure workspace as soon as it is created.">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          style={{
            border: `1.5px dashed ${dragging ? c.brass : c.borderStronger}`,
            background: dragging ? "rgba(184,144,91,.07)" : "transparent",
            borderRadius: 8,
            padding: "26px 20px",
            textAlign: "center",
          }}
        >
          <div style={{ color: c.textSecondary, fontSize: 12.5 }}>Drop files here</div>
          <div style={{ color: c.textMuted, fontSize: 11.5, margin: "4px 0 12px" }}>PDF, images, spreadsheets — or</div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ border: `1px solid ${c.borderStronger}`, background: c.cardHover, color: c.paper, borderRadius: 5, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}
          >
            Choose files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label="Deal documents"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            style={{ display: "none" }}
          />
        </div>

        {files.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {files.map((file) => (
              <li
                key={`${file.name}:${file.size}`}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 11px", border: `1px solid ${c.border}`, borderRadius: 5, fontSize: 12 }}
              >
                <span style={{ color: c.paper, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                <span style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                  <span style={{ color: c.textMuted, fontFamily: "var(--font-brokerage-mono)", fontSize: 11 }}>{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((f) => f !== file))}
                    style={{ background: "none", border: 0, color: c.textMuted, cursor: "pointer", fontSize: 12 }}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes">
        <label style={labelStyle}>
          Anything worth knowing
          <textarea name="notes" maxLength={2000} rows={3} style={{ ...input, resize: "vertical" }} placeholder="Seller financing in place, borrower is buying out a partner…" />
        </label>
      </Section>

      {error && <div role="alert" style={{ color: c.brick, fontSize: 12, border: `1px solid ${c.brick}`, borderRadius: 6, padding: 11 }}>{error}</div>}
      {progress && <div role="status" style={{ color: c.textSecondary, fontSize: 12 }}>{progress}</div>}

      <button
        disabled={busy}
        style={{ justifySelf: "start", border: 0, borderRadius: 5, padding: "11px 18px", background: c.brass, color: c.brassOnBrass, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Working…" : files.length ? `Create deal and upload ${files.length} file${files.length === 1 ? "" : "s"}` : "Create deal"}
      </button>
    </form>
  );
}

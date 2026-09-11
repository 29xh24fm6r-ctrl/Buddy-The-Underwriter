"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CRM_ROOT } from "@/lib/crm/experience";
import { CrmActivityComposer } from "./CrmActivityComposer";
import { CrmTaskControl } from "./CrmTaskControl";
import { confirmCrmDiscard } from "./useCrmDraftGuard";
import { useClerk } from "@clerk/nextjs";
import { BROKERAGE_COMMAND, BROKERAGE_WORKSPACE_LINKS } from "@/lib/brokerage/workspaceNavigation";
import { BrokerageCreateLauncher } from "./BrokerageCreateLauncher";

type RecordTarget = {
  id: string;
  name: string;
  kind: "organization" | "person" | "lead";
};
type SearchTarget = RecordTarget | { id: string; name: string; kind: "deal"; meta: string };
const WorkspaceContext = createContext<{
  openRecord: (record: RecordTarget) => void;
  refresh: () => void;
  revision: number;
} | null>(null);
export const useCrmWorkspace = () => useContext(WorkspaceContext);
const primaryLinks = [
  ["Today", CRM_ROOT, "◈"],
  ["Team tasks", `${CRM_ROOT}#crm-tasks`, "✓"],
  ["Lead pipeline", `${CRM_ROOT}/leads`, "▤"],
  ["Companies", `${CRM_ROOT}?view=relationships`, "▦"],
  ["People", `${CRM_ROOT}/people`, "◎"],
  ["Lender network", `${CRM_ROOT}/buyers`, "◇"],
] as const;
const toolLinks = [
  ["Deal connections", `${CRM_ROOT}/relationships`, "↗"],
  ["Message templates", `${CRM_ROOT}/templates`, "✉"],
  ["Duplicate review", `${CRM_ROOT}/dedup`, "⊞"],
] as const;
const links = [...primaryLinks, ...toolLinks] as const;

export function CrmWorkspaceFrame({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  const [accountError, setAccountError] = useState("");
  const pathname = usePathname();
  const query = useSearchParams();
  const [record, setRecord] = useState<RecordTarget | null>(null);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(false);
  const [guide, setGuide] = useState(false);
  const isOwnerCommand = pathname === BROKERAGE_COMMAND;
  const scrollToTasks = useCallback(() => {
    let attempts = 0;
    const findAndScroll = () => {
      const target = document.getElementById("crm-tasks");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.querySelector<HTMLElement>("button, a, input, [tabindex]")?.focus({ preventScroll: true });
        return;
      }
      if (attempts++ < 20) window.setTimeout(findAndScroll, 100);
    };
    window.setTimeout(findAndScroll, 0);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setSearch(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (pathname === CRM_ROOT && window.location.hash === "#crm-tasks") scrollToTasks();
  }, [pathname, scrollToTasks]);
  const current =
    pathname === CRM_ROOT
      ? pathname +
        (query.get("view") === "relationships" ? "?view=relationships" : "")
      : links.find(
          ([, href]) =>
            href !== CRM_ROOT &&
            !href.includes("?") &&
            (pathname === href || pathname.startsWith(href + "/")),
        )?.[1] || `${CRM_ROOT}?view=relationships`;
  return (
    <WorkspaceContext.Provider
      value={{
        openRecord: setRecord,
        revision,
        refresh: () => setRevision((n) => n + 1),
      }}
    >
      <div className="crm-unified">
        <aside className="crm-rail">
          <Link href={CRM_ROOT} className="crm-brand" aria-label="Buddy SBA CRM home">
            <span>B</span>
            <div>
              buddy<span className="crm-brand-caption">SBA BROKERAGE</span>
            </div>
          </Link>
          <button className="crm-search-launch" onClick={() => setSearch(true)}>
            ⌕ Search CRM <kbd>Ctrl K</kbd>
          </button>
          <p className="crm-rail-label">YOUR BROKERAGE</p>
          <nav aria-label="Buddy SBA workspace">
            {BROKERAGE_WORKSPACE_LINKS.filter(({ href }) => !href.includes("/crm")).map(({ label, href }) => (
              <Link key={href} href={href} prefetch={false} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
            ))}
          </nav>
          <p className="crm-rail-label">CRM & RELATIONSHIPS</p>
          <nav aria-label="CRM workspace">
            {primaryLinks.map(([label, href, icon]) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                aria-current={current === href ? "page" : undefined}
                onClick={label === "Team tasks" ? scrollToTasks : undefined}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
            <details className="crm-rail-tools" open={toolLinks.some(([, href]) => current === href)}>
              <summary>Data & automation</summary>
              {toolLinks.map(([label, href, icon]) => (
                <Link key={href} href={href} prefetch={false} aria-current={current === href ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}</Link>
              ))}
            </details>
          </nav>
          <div className="crm-rail-bottom">
            <Link className="crm-admin-return" href="/admin/brokerage" prefetch={false}>
              <span aria-hidden="true">⌂</span>
              <span><strong>Brokerage HQ</strong><small>Run the business</small></span>
              <span aria-hidden="true">↗</span>
            </Link>
            <button onClick={() => setGuide((v) => !v)}>
              ✧ Getting started
            </button>
            <details>
              <summary>More Buddy tools</summary>
              <nav aria-label="Other Buddy tools">
                {[
                  ["Bank underwriting workspace", "/deals"],
                  ["Bank document library", "/documents"],
                  ["Servicing", "/servicing"],
                  ["Admin", "/admin"],
                  ["Command", "/command"],
                  ["Settings", "/settings"],
                  ["Profile", "/profile"],
                ].map(([label, href]) => (
                  <Link key={href} href={href}>
                    {label}
                  </Link>
                ))}
              </nav>
            </details>
            <p>Built around your relationships.</p>
          </div>
        </aside>
        <div className="crm-workspace-body">
          <div className="crm-topline">
            <span>
              <Link href={BROKERAGE_COMMAND}>Buddy SBA command</Link>{" "}
              <span className="crm-topline-muted">
                / {isOwnerCommand ? "Owner command" : "CRM & relationships"}
              </span>
            </span>
            <div className="crm-account-actions">
              <BrokerageCreateLauncher compact />
              <Link className="crm-admin-home-link" href="/admin/brokerage" prefetch={false}>
                <span aria-hidden="true">⌂</span> Brokerage HQ
              </Link>
              <button onClick={() => setSearch(true)}>
                Find anything <span aria-hidden="true">⌕</span>
              </button>
              <Link href="/profile">My profile</Link>
              <button
                onClick={() => {
                  if (confirmCrmDiscard())
                    void signOut({ redirectUrl: "/" }).catch(() =>
                      setAccountError(
                        "Sign out could not be completed. Please try again.",
                      ),
                    );
                }}
              >
                Sign out
              </button>
            </div>
          </div>
          {accountError && <p role="alert">{accountError}</p>}
          {guide && (
            <section className="crm-onboarding" aria-label="Getting started">
              <div>
                <p className="crm-eyebrow">A SIMPLE WAY TO WORK</p>
                <h2>One simple path from first hello to funded.</h2>
                <p>Start wherever the work is today. Buddy keeps the context connected as it moves forward.</p>
              </div>
              <ol>
                <li>
                  <Link href={`${CRM_ROOT}?view=relationships`}>
                    1. Know the relationship
                  </Link>
                  <p>Add the company and the people involved. This becomes the shared history.</p>
                </li>
                <li>
                  <Link href={`${CRM_ROOT}/leads`}>2. Qualify the opportunity</Link>
                  <p>Capture the first conversation, assign an owner, and name the next action.</p>
                </li>
                <li>
                  <Link href="/admin/brokerage/pipeline">3. Build the deal</Link>
                  <p>Move qualified work into the brokerage pipeline and prepare the borrower file.</p>
                </li>
                <li>
                  <Link href={`${CRM_ROOT}/buyers`}>4. Place and close</Link>
                  <p>Match the right lenders, track every response, and keep follow-ups visible.</p>
                </li>
              </ol>
              <button onClick={() => setGuide(false)}>Close guide</button>
            </section>
          )}
          <div
            key={`${pathname}?${query.toString()}`}
            className="crm-route-content"
          >
            {children}
          </div>
        </div>
        {search && (
          <CrmSearchDialog
            onClose={() => setSearch(false)}
            onSelect={(target) => {
              setSearch(false);
              setRecord(target);
            }}
          />
        )}
        {record && (
          <CrmRecordDrawer
            key={`${record.kind}:${record.id}`}
            target={record}
            onClose={() => setRecord(null)}
            onSaved={() => setRevision((n) => n + 1)}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}

export function CrmModal({
  title,
  className,
  onClose,
  children,
}: {
  title: string;
  className: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  const close = () => {
    if (confirmCrmDiscard(dialog.current)) onClose();
  };
  return (
    <dialog
      ref={dialog}
      className={`crm-modal ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close panel" onClick={close}>
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}

function CrmSearchDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (record: RecordTarget) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchTarget[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        setStatus("");
        return;
      }
      setStatus("Searching…");
      setResults([]);
      try {
        const r = await fetch(
          `/api/admin/brokerage/crm/search?q=${encodeURIComponent(q.trim())}`,
          { signal: controller.signal },
        );
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        if (controller.signal.aborted) return;
        const found: SearchTarget[] = [
          ...j.organizations.map((o: { id: string; name: string }) => ({
            ...o,
            kind: "organization" as const,
          })),
          ...j.people.map(
            (p: {
              id: string;
              first_name?: string;
              last_name?: string;
              email?: string;
            }) => ({
              id: p.id,
              name:
                [p.first_name, p.last_name].filter(Boolean).join(" ") ||
                p.email ||
                "Unnamed person",
              kind: "person" as const,
            }),
          ),
          ...j.deals.map((d: { id: string; display_name?: string; borrower_name?: string; name?: string; loan_amount?: number; brokerage_stage?: string }) => ({
            id: d.id,
            name: d.display_name || d.borrower_name || d.name || "Untitled deal",
            kind: "deal" as const,
            meta: [
              d.brokerage_stage?.replaceAll("_", " "),
              d.loan_amount ? `$${Math.round(d.loan_amount).toLocaleString("en-US")}` : null,
            ].filter(Boolean).join(" · ") || "Active deal",
          })),
        ];
        setResults(found);
        setStatus(
          found.length
            ? `${found.length} results across companies, people, and active deals`
            : "No matches. Try a name, email, or phone number.",
        );
      } catch {
        if (!controller.signal.aborted)
          setStatus("Search unavailable. Try again or use the directory.");
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  return (
    <CrmModal
      title="Find anything in the brokerage"
      className="crm-search-dialog"
      onClose={onClose}
    >
      <input
        autoFocus
        aria-label="Search companies, people, and deals"
        placeholder="Company, person, deal, email or phone…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setResults([]);
          setStatus(e.target.value.trim() ? "Searching…" : "");
        }}
      />
      <p role="status">
        {status ||
          "Search companies, people, and active deals from one place."}
      </p>
      <div className="crm-search-results">
        {results.map((item) => item.kind === "deal" ? (
          <Link key={`deal:${item.id}`} href={`/admin/brokerage/pipeline/${item.id}`} onClick={onClose}>
            <span className="crm-avatar">
              {item.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.meta}</small>
            </span>
            <span>↗</span>
          </Link>
        ) : (
          <button key={`${item.kind}:${item.id}`} onClick={() => onSelect(item)}>
            <span className="crm-avatar">{item.name.slice(0, 2).toUpperCase()}</span>
            <span><strong>{item.name}</strong><small>{item.kind === "person" ? "Person" : "Company"}</small></span>
            <span>↗</span>
          </button>
        ))}
      </div>
      {!q.trim() ? <nav className="crm-search-starts" aria-label="Quick starts">
        <Link href="/admin/brokerage/crm/leads?new=1" onClick={onClose}>✦ New conversation</Link>
        <Link href="/admin/brokerage/pipeline/new" onClick={onClose}>↗ Qualified deal</Link>
        <Link href="/admin/brokerage/pipeline/queues" onClick={onClose}>✓ My work</Link>
        <Link href="/admin/brokerage/crm/buyers" onClick={onClose}>◇ Lender network</Link>
      </nav> : null}
      <footer>
        <Link href={`${CRM_ROOT}?view=relationships`} onClick={onClose}>
          Browse all companies
        </Link>
        <span>Esc to close · Tab to navigate</span>
      </footer>
    </CrmModal>
  );
}

function CrmRecordDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: RecordTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const plural =
    target.kind === "organization"
      ? "organizations"
      : target.kind === "person"
        ? "people"
        : "leads";
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/brokerage/crm/${plural}/${target.id}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        if (!controller.signal.aborted) {
          setData(j);
          setError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Unable to refresh this record. Try again before acting.");
      });
    return () => controller.abort();
  }, [target.id, plural, revision]);
  const entity = data?.[target.kind];
  const refresh = () => {
    setRevision((n) => n + 1);
    onSaved();
  };
  const href =
    target.kind === "organization"
      ? `${CRM_ROOT}/${target.id}`
      : `${CRM_ROOT}/${plural}/${target.id}`;
  return (
    <CrmModal
      title={target.name}
      className="crm-record-drawer"
      onClose={onClose}
    >
      <p className="crm-eyebrow">{target.kind} workspace</p>
      <Link className="crm-text-link" href={href} onClick={onClose}>
        Open full record ↗
      </Link>
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRevision((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!data && !error && <p role="status">Loading relationship context…</p>}
      {entity && (
        <>
          <div className="crm-record-facts">
            <span>
              {entity.organization_type?.replaceAll("_", " ") ||
                entity.job_title ||
                entity.status?.replaceAll("_", " ") ||
                "Relationship"}
            </span>
            <span>
              {[entity.city, entity.state].filter(Boolean).join(", ")}
            </span>
            {entity.contact_status === "do_not_contact" ? (
              <strong>
                Do not contact — logging internal notes is still available.
              </strong>
            ) : (
              <>
                {entity.email && (
                  <a href={`mailto:${entity.email}`}>{entity.email}</a>
                )}
                {entity.phone && (
                  <a href={`tel:${entity.phone}`}>{entity.phone}</a>
                )}
              </>
            )}
          </div>
          <CrmActivityComposer
            readOnly={Boolean(error)}
            organizationId={target.id}
            organizationName={target.name}
            targetKind={target.kind}
            onSaved={refresh}
          />
          <section className="crm-drawer-history">
            <h3>Recent history</h3>
            {(data.activities || []).slice(0, 12).map((a: any) => (
              <article key={a.id}>
                <span className="crm-badge">{a.kind.replaceAll("_", " ")}</span>
                <h4>{a.title || "Activity"}</h4>
                {typeof a.properties?.body === "string" && (
                  <p>{a.properties.body}</p>
                )}
                {a.kind === "task" && (
                  <CrmTaskControl
                    id={a.id}
                    completed={Boolean(a.completed_at)}
                    dueAt={a.due_at}
                    onSaved={refresh}
                  />
                )}
                <small>{new Date(a.happens_at).toLocaleString()}</small>
              </article>
            ))}
            {!data.activities?.length && (
              <p>No activity recorded yet. Start with a note or a follow-up.</p>
            )}
          </section>
        </>
      )}
    </CrmModal>
  );
}

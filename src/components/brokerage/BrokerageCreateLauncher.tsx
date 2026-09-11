"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const STARTS = [
  { href: "/admin/brokerage/crm/leads?new=1", icon: "✦", title: "New conversation", copy: "Start with the person. Qualify before opening a full deal." },
  { href: "/admin/brokerage/pipeline/new", icon: "↗", title: "Qualified deal", copy: "The borrower is ready. Open the brokerage file." },
  { href: "/admin/brokerage/crm?view=relationships&create=organization", icon: "▦", title: "Company", copy: "Add a borrower, referral partner, or other relationship." },
  { href: "/admin/brokerage/crm/people?create=1", icon: "◎", title: "Person", copy: "Add a contact and connect their relationship context." },
  { href: "/admin/brokerage/crm/buyers?create=placement", icon: "◇", title: "Lender placement", copy: "Record a deal sent to a lender and its follow-up." },
] as const;

export function BrokerageCreateLauncher({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <>
      <button type="button" className={compact ? "brokerage-create brokerage-create--compact" : "brokerage-create"} onClick={() => setOpen(true)}>
        <span aria-hidden="true">＋</span> Create
      </button>
      <dialog ref={dialog} className="brokerage-create-dialog" aria-labelledby="brokerage-create-title" onCancel={() => setOpen(false)}>
        <div className="brokerage-create-head">
          <div>
            <span>START IN THE RIGHT PLACE</span>
            <h2 id="brokerage-create-title">What are you adding?</h2>
            <p>Choose what you know today. Buddy keeps the context connected as the work grows.</p>
          </div>
          <button type="button" aria-label="Close create menu" onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="brokerage-create-grid">
          {STARTS.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              <i aria-hidden="true">{item.icon}</i>
              <span><strong>{item.title}</strong><small>{item.copy}</small></span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
        <footer><strong>Not sure?</strong> Start with a new conversation. You can qualify it into a deal without losing the history.</footer>
      </dialog>
    </>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
type Item = { id: string; title: string };
type Link = {
  id: string;
  recipient_name: string | null;
  checklist_item_ids: string[];
  expires_at: string;
  revoked: boolean;
};
export function DocumentHelper({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/portal/deals/${dealId}/share-links`;
  const load = useCallback(async () => {
    const r = await fetch(base, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || !d.ok || !Array.isArray(d.items) || !Array.isArray(d.links))
      throw new Error("Could not load document requests. Please retry.");
    setItems(d.items);
    setLinks(d.links);
  }, [base]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function perform(id?: string) {
    if (!id && (!confirmed || !name.trim() || !selected.length)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(base, {
        method: id ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          id
            ? { id }
            : {
                purpose: "business_financials",
                confirmed,
                checklistItemIds: selected,
                recipientName: name.trim(),
              },
        ),
      });
      const d = await r.json();
      if (!r.ok || !d.ok)
        throw new Error("Could not save this sharing change. Please retry.");
      if (
        !id &&
        typeof d.shareUrl === "string" &&
        d.shareUrl.startsWith("/portal/share/")
      )
        setUrl(window.location.origin + d.shareUrl);
      if (id) setUrl("");
      setConfirmed(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-2xl border bg-white p-5">
      <summary className="cursor-pointer font-semibold">
        Have an accountant or bookkeeper help
      </summary>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Choose business documents they can provide. Their link shows your
        business name and the selected requests. It does not show your existing
        files, answers or owners’ personal financial statements. Links expire
        after seven days and can be revoked here.
      </p>
      {error && (
        <div role="alert" className="mt-3 text-sm text-rose-700">
          {error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() =>
              void load()
                .then(() => setError(""))
                .catch((e) => setError(e.message))
            }
          >
            Retry
          </button>
        </div>
      )}
      {items.length ? (
        <fieldset disabled={busy} className="mt-4 space-y-3">
          <label className="block text-sm">
            Who will help?
            <input
              className="mt-1 block w-full rounded-lg border p-3"
              value={name}
              maxLength={128}
              onChange={(e) => {
                setName(e.target.value);
                setConfirmed(false);
              }}
              placeholder="Name of your accountant or bookkeeper"
            />
          </label>
          {items.map((item) => (
            <label
              key={item.id}
              className="flex min-h-11 items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  );
                  setConfirmed(false);
                }}
              />
              {item.title}
            </label>
          ))}
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I want to create a link for this person to see these requests and
            upload documents.
          </label>
          <button
            type="button"
            disabled={!confirmed || !selected.length || !name.trim()}
            onClick={() => void perform()}
            className="rounded-lg bg-sky-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Create upload link
          </button>
        </fieldset>
      ) : (
        !error && (
          <p className="mt-3 text-sm text-slate-600">
            Eligible business-document requests will appear here when they are
            available for your application.
          </p>
        )
      )}
      {url && (
        <div role="status" className="mt-4 rounded-xl bg-sky-50 p-4">
          <p className="text-sm">
            Link created. Share it privately with your chosen helper; anyone
            holding it can use its limited access. Nothing has been sent.
          </p>
          <input
            readOnly
            aria-label="Private upload link"
            className="mt-2 w-full rounded border p-2 text-sm"
            value={url}
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      {!!links.length && (
        <ul className="mt-4 space-y-3">
          {links.map((link) => (
            <li key={link.id} className="rounded-xl border p-3 text-sm">
              <strong>{link.recipient_name ?? "Document helper"}</strong>
              <p>
                {link.checklist_item_ids
                  .map(
                    (id) =>
                      items.find((item) => item.id === id)?.title ??
                      "Selected document request",
                  )
                  .join(", ")}
              </p>
              <p>
                {link.revoked
                  ? "Revoked"
                  : Date.parse(link.expires_at) <= Date.now()
                    ? "Expired"
                    : `Expires ${new Date(link.expires_at).toLocaleDateString()}`}
              </p>
              {!link.revoked && Date.parse(link.expires_at) > Date.now() && (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 min-h-11 underline"
                  onClick={() => void perform(link.id)}
                >
                  Revoke link for {link.recipient_name ?? "helper"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

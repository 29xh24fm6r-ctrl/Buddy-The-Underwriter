"use client";

import { useEffect, useMemo, useState } from "react";

type Template = {
  id: string;
  bank_id: string;
  title: string;
  category: string | null;
  description: string | null;
  doc_type: string | null;
  year_mode: "optional" | "required" | "forbidden";
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export default function TemplateManager({ bankId }: { bankId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [docType, setDocType] = useState("");
  const [yearMode, setYearMode] = useState<"optional" | "required" | "forbidden">("optional");
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/banks/${bankId}/templates`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTemplates(json.templates || []);
    } catch (e: any) {
      setToast(e?.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const hay = `${t.title} ${t.category || ""} ${t.doc_type || ""} ${t.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [templates, filter]);

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setTitle("");
    setCategory("");
    setDescription("");
    setDocType("");
    setYearMode("optional");
    setSortOrder(0);
    setActive(true);
  }

  function openEdit(t: Template) {
    setCreating(false);
    setEditing(t);
    setTitle(t.title);
    setCategory(t.category || "");
    setDescription(t.description || "");
    setDocType(t.doc_type || "");
    setYearMode(t.year_mode);
    setSortOrder(t.sort_order || 0);
    setActive(!!t.active);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    const payload = {
      title: title.trim(),
      category: category.trim() || null,
      description: description.trim() || null,
      doc_type: docType.trim() || null,
      year_mode: yearMode,
      sort_order: Number(sortOrder) || 0,
      active: !!active,
    };

    if (!payload.title) {
      setToast("Title is required.");
      return;
    }

    try {
      if (creating) {
        const res = await fetch(`/api/banks/${bankId}/templates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setToast("Template created.");
      } else if (editing) {
        const res = await fetch(`/api/banks/${bankId}/templates/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setToast("Template updated.");
      }

      closeModal();
      await load();
    } catch (e: any) {
      setToast(e?.message || "Save failed");
    }
  }

  async function del(t: Template) {
    if (!confirm(`Delete template "${t.title}"?`)) return;
    try {
      const res = await fetch(`/api/banks/${bankId}/templates/${t.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast("Deleted.");
      await load();
    } catch (e: any) {
      setToast(e?.message || "Delete failed");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">Template Library</div>
          <div className="text-sm text-slate-600">Standardize request lists and power learning across deals.</div>
        </div>
        <div className="flex items-center gap-2">
          {toast && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {toast}
            </div>
          )}
          <button
            onClick={openCreate}
            className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            New Template
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <input
            className="w-full max-w-md rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Search templates…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            onClick={load}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            No templates yet.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {filtered.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {t.title} {!t.active ? <span className="text-xs text-slate-500">(inactive)</span> : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-2">
                      {t.category ? <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">{t.category}</span> : null}
                      {t.doc_type ? <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">{t.doc_type}</span> : null}
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">year: {t.year_mode}</span>
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">order: {t.sort_order}</span>
                    </div>
                    {t.description ? <div className="mt-2 text-sm text-slate-700">{t.description}</div> : null}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(t)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => del(t)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-slate-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={closeModal} />
          <div className="absolute inset-x-0 top-16 mx-auto w-full max-w-2xl bg-white shadow-2xl rounded-2xl border border-slate-200">
            <div className="p-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-slate-900">{creating ? "New Template" : "Edit Template"}</div>
                <div className="text-xs text-slate-600 mt-1">These drive deal request generation + learning.</div>
              </div>
              <button
                onClick={closeModal}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Title</div>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">Category</div>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="financials / tax / condition / mitigant / other"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">Doc type (optional)</div>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    placeholder="tax_return / pfs / bank_statement …"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">Year mode</div>
                  <select
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                    value={yearMode}
                    onChange={(e) => setYearMode(e.target.value as any)}
                  >
                    <option value="optional">optional</option>
                    <option value="required">required</option>
                    <option value="forbidden">forbidden</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">Sort order</div>
                  <input
                    type="number"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value))}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    Active
                  </label>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Description (optional)</div>
                <textarea
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

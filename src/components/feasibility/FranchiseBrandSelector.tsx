"use client";

// src/components/feasibility/FranchiseBrandSelector.tsx
// Lets staff search and link a deal to a franchise_brands row. This is the
// write path that activates isFranchise in both the feasibility engine and
// the buddySbaScore pipeline — see the deal_franchises table comment.

import { useCallback, useEffect, useRef, useState } from "react";

interface BrandResult {
  id: string;
  brand_name: string;
  sba_certification_status: string | null;
  has_item_19: boolean;
}

interface Props {
  dealId: string;
  // Notifies the parent so it can re-trigger scoring/feasibility copy that
  // depends on isFranchise. Optional — the selector works standalone too.
  onChange?: (brand: { id: string; name: string } | null) => void;
}

export default function FranchiseBrandSelector({ dealId, onChange }: Props) {
  const [linked, setLinked] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrandResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/franchise`);
      const json = await res.json();
      if (json.ok && json.brandId) {
        setLinked({ id: json.brandId, name: json.brandName ?? "Unknown brand" });
      } else {
        setLinked(null);
      }
    } catch {
      // Non-fatal — selector still usable, just starts unlinked.
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/franchise/search?q=${encodeURIComponent(query.trim())}&limit=8`,
        );
        const json = await res.json();
        setResults((json.brands as BrandResult[] | undefined) ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const selectBrand = useCallback(
    async (brand: BrandResult) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/franchise`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brand_id: brand.id }),
        });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "Failed to link brand");
          return;
        }
        const next = { id: json.brandId, name: json.brandName ?? brand.brand_name };
        setLinked(next);
        setOpen(false);
        setQuery("");
        setResults([]);
        onChange?.(next);
      } catch {
        setError("Network error linking brand");
      } finally {
        setSaving(false);
      }
    },
    [dealId, onChange],
  );

  const unlink = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/franchise`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Failed to unlink brand");
        return;
      }
      setLinked(null);
      onChange?.(null);
    } catch {
      setError("Network error unlinking brand");
    } finally {
      setSaving(false);
    }
  }, [dealId, onChange]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
        Loading franchise link…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
        Franchise brand
      </div>

      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{linked.name}</div>
            <div className="text-xs text-white/50">
              Drives franchise scoring + feasibility comparison for this deal
            </div>
          </div>
          <button
            type="button"
            onClick={unlink}
            disabled={saving}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/5 disabled:opacity-40"
          >
            {saving ? "Unlinking…" : "Unlink"}
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search franchise brands (e.g. Chick-fil-A)…"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none"
          />
          {open && query.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0e1420] shadow-xl">
              {searching && (
                <div className="px-3 py-2 text-xs text-white/40">Searching…</div>
              )}
              {!searching && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-white/40">No matching brands</div>
              )}
              {!searching &&
                results.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => selectBrand(brand)}
                    disabled={saving}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/5 disabled:opacity-40"
                  >
                    <span>{brand.brand_name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                      {brand.sba_certification_status === "certified"
                        ? "SBA certified"
                        : brand.sba_certification_status ?? "unverified"}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

"use client";

// src/components/brokerage/BorrowerFranchiseBrandPicker.tsx
// Borrower-facing counterpart to FranchiseBrandSelector (staff-side).
// Lets a borrower explicitly select "Yes, I'm buying a franchise" and
// search/pick their brand, writing to deal_franchises via the
// session-cookie-gated /api/brokerage/franchise route. This is what
// activates isFranchise for their deal — see deal_franchises table
// comment for the full chain this feeds.

import { useCallback, useEffect, useRef, useState } from "react";

interface BrandResult {
  id: string;
  brand_name: string;
  sba_certification_status: string | null;
}

// No props — ownership is derived server-side from the
// buddy_borrower_session cookie, same as every other /api/brokerage/*
// mutation.
export default function BorrowerFranchiseBrandPicker() {
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState<{ id: string; name: string } | null>(null);
  // Three states: unopened prompt, actively searching, done.
  const [showSearch, setShowSearch] = useState(false);
  const [saidNo, setSaidNo] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrandResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/brokerage/franchise");
      const json = await res.json();
      if (json.ok && json.brandId) {
        setLinked({ id: json.brandId, name: json.brandName ?? "Selected brand" });
      }
    } catch {
      // Non-fatal — picker still usable.
    } finally {
      setLoading(false);
    }
  }, []);

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

  const selectBrand = useCallback(async (brand: BrandResult) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brokerage/franchise", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_id: brand.id }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError("Couldn't save that — try again in a moment.");
        return;
      }
      setLinked({ id: json.brandId, name: json.brandName ?? brand.brand_name });
      setShowSearch(false);
      setQuery("");
      setResults([]);
    } catch {
      setError("Network error — try again in a moment.");
    } finally {
      setSaving(false);
    }
  }, []);

  const changeBrand = useCallback(() => {
    setLinked(null);
    setShowSearch(true);
  }, []);

  if (loading) return null;

  // Already linked — quiet confirmation, not a re-ask.
  if (linked) {
    return (
      <div className="rounded-2xl border border-brand-blue-500/25 bg-brand-blue-500/5 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-blue-500">
              Franchise brand
            </div>
            <div className="mt-0.5 text-sm font-medium text-slate-900">{linked.name}</div>
          </div>
          <button
            type="button"
            onClick={changeBrand}
            className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  // Borrower dismissed the prompt — don't keep nagging.
  if (saidNo && !showSearch) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {!showSearch ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-heading text-sm font-semibold text-slate-900">
              Are you financing a franchise?
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Tell Buddy which brand — it'll pull SBA eligibility and
              certification data straight into your package.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="brand-gradient-cta rounded-lg px-4 py-2 text-xs font-medium text-white hover:brightness-110"
            >
              Yes, select my brand
            </button>
            <button
              type="button"
              onClick={() => setSaidNo(true)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Not a franchise
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <div className="mb-2 font-heading text-sm font-semibold text-slate-900">
            Search for your franchise brand
          </div>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Chick-fil-A, Great Clips, UPS Store…"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
          />
          {query.trim().length >= 2 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {searching && (
                <div className="px-4 py-3 text-xs text-slate-400">Searching…</div>
              )}
              {!searching && results.length === 0 && (
                <div className="px-4 py-3 text-xs text-slate-400">
                  No matches — check the spelling, or contact us if your brand is missing.
                </div>
              )}
              {!searching &&
                results.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => selectBrand(brand)}
                    disabled={saving}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <span>{brand.brand_name}</span>
                    {brand.sba_certification_status === "certified" && (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        SBA certified
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowSearch(false)}
            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
    </div>
  );
}

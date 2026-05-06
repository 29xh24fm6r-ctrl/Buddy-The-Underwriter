"use client";

import { useState } from "react";
import type { DealManagementProfile } from "@/lib/creditMemo/inputs/types";

type Props = {
  dealId: string;
  initial: DealManagementProfile[];
};

type DraftProfile = {
  id?: string;
  person_name: string;
  title: string;
  ownership_pct: string;
  years_experience: string;
  industry_experience: string;
  prior_business_experience: string;
  resume_summary: string;
  credit_relevance: string;
};

function toDraft(p: DealManagementProfile): DraftProfile {
  return {
    id: p.id,
    person_name: p.person_name ?? "",
    title: p.title ?? "",
    ownership_pct: p.ownership_pct === null ? "" : String(p.ownership_pct),
    years_experience: p.years_experience === null ? "" : String(p.years_experience),
    industry_experience: p.industry_experience ?? "",
    prior_business_experience: p.prior_business_experience ?? "",
    resume_summary: p.resume_summary ?? "",
    credit_relevance: p.credit_relevance ?? "",
  };
}

const EMPTY_DRAFT: DraftProfile = {
  person_name: "",
  title: "",
  ownership_pct: "",
  years_experience: "",
  industry_experience: "",
  prior_business_experience: "",
  resume_summary: "",
  credit_relevance: "",
};

export default function ManagementProfilesForm({ dealId, initial }: Props) {
  const [profiles, setProfiles] = useState<DraftProfile[]>(() =>
    initial.map(toDraft),
  );
  const [draft, setDraft] = useState<DraftProfile>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function asPayload(d: DraftProfile) {
    return {
      ...(d.id ? { id: d.id } : {}),
      person_name: d.person_name.trim(),
      title: d.title,
      ownership_pct: d.ownership_pct.trim() === "" ? null : Number(d.ownership_pct),
      years_experience: d.years_experience.trim() === "" ? null : Number(d.years_experience),
      industry_experience: d.industry_experience,
      prior_business_experience: d.prior_business_experience,
      resume_summary: d.resume_summary,
      credit_relevance: d.credit_relevance,
    };
  }

  async function addProfile() {
    if (draft.person_name.trim().length === 0) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "management", ...asPayload(draft) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed");
      setProfiles((p) => [...p, toDraft(json.profile)]);
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(idx: number) {
    const target = profiles[idx];
    if (!target.id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo-inputs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "management", ...asPayload(target) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save_failed");
      setProfiles((p) =>
        p.map((cur, i) => (i === idx ? toDraft(json.profile) : cur)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(idx: number) {
    const target = profiles[idx];
    if (!target.id) {
      setProfiles((p) => p.filter((_, i) => i !== idx));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/memo-inputs?kind=management&id=${encodeURIComponent(
          target.id,
        )}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "delete_failed");
      setProfiles((p) => p.filter((_, i) => i !== idx));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="management" className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">Management & Sponsors</h2>
        <p className="text-xs text-gray-500">
          Add at least one principal/officer with credit-relevant background.
        </p>
      </header>

      <div className="space-y-4">
        {profiles.map((p, idx) => (
          <div key={p.id ?? idx} className="rounded-md border border-gray-200 p-3">
            <ProfileFields
              draft={p}
              onChange={(patch) =>
                setProfiles((cur) =>
                  cur.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
                )
              }
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => saveProfile(idx)}
                disabled={busy}
                className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => removeProfile(idx)}
                disabled={busy}
                className="inline-flex items-center rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <div className="rounded-md border border-dashed border-gray-300 p-3">
          <h3 className="text-sm font-medium text-gray-800">Add new profile</h3>
          <ProfileFields
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={addProfile}
              disabled={busy}
              className="inline-flex items-center rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Add profile
            </button>
            {error ? <span className="text-xs text-rose-700">{error}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProfileFields({
  draft,
  onChange,
}: {
  draft: DraftProfile;
  onChange: (patch: Partial<DraftProfile>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Input label="Name *" value={draft.person_name} onChange={(v) => onChange({ person_name: v })} />
      <Input label="Title" value={draft.title} onChange={(v) => onChange({ title: v })} />
      <Input
        label="Ownership %"
        value={draft.ownership_pct}
        onChange={(v) => onChange({ ownership_pct: v })}
        type="number"
      />
      <Input
        label="Years experience"
        value={draft.years_experience}
        onChange={(v) => onChange({ years_experience: v })}
        type="number"
      />
      <Textarea
        label="Industry experience"
        value={draft.industry_experience}
        onChange={(v) => onChange({ industry_experience: v })}
      />
      <Textarea
        label="Prior business experience"
        value={draft.prior_business_experience}
        onChange={(v) => onChange({ prior_business_experience: v })}
      />
      <Textarea
        label="Resume summary"
        value={draft.resume_summary}
        onChange={(v) => onChange({ resume_summary: v })}
      />
      <Textarea
        label="Credit relevance"
        value={draft.credit_relevance}
        onChange={(v) => onChange({ credit_relevance: v })}
      />
    </div>
  );
}

function Input(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col text-sm text-gray-800">
      <span className="mb-1 font-medium">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
      />
    </label>
  );
}

function Textarea(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col text-sm text-gray-800 md:col-span-2">
      <span className="mb-1 font-medium">{props.label}</span>
      <textarea
        rows={2}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
      />
    </label>
  );
}

"use client";

import { useState } from "react";
import { GUIDED_CHOICES, type GuidedQuestion, type GuidedSnapshot } from "@/lib/borrower/guidedPackage/questions";
import { activityChoices, activityCopy } from "@/lib/borrower/journey/activities";
import { DISCOVERY_CHOICES } from "@/lib/borrower/journey/discovery";
import { factoryActivityFor } from "@/lib/borrower/journey/factoryActivities";
import { saveActivityAnswers } from "@/lib/borrower/journey/saveActivity";

type Drafts = Record<string, { value: string; baseline: string | number | boolean | null; source: "text" | "voice" }>;

/** Small, resumable groups use the existing validated, conflict-checked answer transaction. */
export function FactoryActivityCard({ questions, snapshot, dealId, drafts, disabled, onSaved, onNext, onBusy, onSingle }: {
  questions: GuidedQuestion[];
  snapshot: GuidedSnapshot;
  dealId: string;
  drafts: Drafts;
  disabled: boolean;
  onSaved: (snapshot: GuidedSnapshot) => void;
  onNext: (snapshot: GuidedSnapshot) => void;
  onBusy: (busy: boolean) => void;
  onSingle: (id: string) => void;
}) {
  const [, render] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activity = factoryActivityFor(questions[0]);
  const changed = questions.filter(q => drafts[q.id] && drafts[q.id].value.trim());
  const value = (q: GuidedQuestion) => drafts[q.id]?.value ?? String(q.value ?? "");
  function edit(q: GuidedQuestion, value: string) {
    drafts[q.id] = { value, baseline: drafts[q.id] ? drafts[q.id].baseline : q.value, source: "text" };
    render(n => n + 1);
  }
  async function save() {
    setSaving(true);
    onBusy(true);
    setError("");
    try {
      // Each success is durable. On partial failure, unsaved drafts stay visible;
      // retry never pretends the entire group was atomic or overwrites a changed baseline.
      const latest = await saveActivityAnswers({ questions: changed, snapshot, dealId, drafts, request: fetch, onSaved });
      onNext(latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your unsaved drafts are still here. Please retry.");
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-label={activity.title}>
    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Build together</p>
    <h3 className="mt-2 text-xl font-semibold">{activity.title}</h3>
    <p className="mt-2 text-sm text-slate-600">A few connected details, one save. Buddy reuses your saved answers in your package. Leave anything you don’t know for later.</p>
    <div className="mt-5 space-y-6">
      {questions.map(q => {
        const choices = activityChoices(q) ?? DISCOVERY_CHOICES[q.id] ??
          (q.field && GUIDED_CHOICES[q.field.registryEntry.factPath]) ??
          (q.type === "boolean" ? [["true", "Yes"], ["false", "No"]] : null);
        return <fieldset key={q.id} disabled={disabled || saving} className="space-y-2">
          <legend className="text-sm font-medium">{q.ownerName ? `${q.ownerName}: ` : ""}{activityCopy(q).title}{q.required ? " (required)" : ""}</legend>
          {q.state === "saved" && !drafts[q.id] && <p className="text-xs text-emerald-800">✓ Saved — edit only if something changed</p>}
          {choices ? <div className="grid gap-2 sm:grid-cols-2">
            {choices.map(([key, label]) => <button key={key} type="button" aria-pressed={value(q) === key}
              onClick={() => edit(q, key)} className={`min-h-12 rounded-xl border p-3 text-left text-sm ${value(q) === key ? "border-sky-700 bg-sky-50" : "border-slate-200"}`}>{label}</button>)}
          </div> : ["number", "currency", "date"].includes(q.type) ?
            <input aria-label={activityCopy(q).title} type={q.type === "date" ? "date" : "text"} inputMode={q.type === "date" ? undefined : "decimal"}
              value={value(q)} onChange={e => edit(q, e.target.value)} className="w-full rounded-xl border p-3" /> :
            <textarea aria-label={activityCopy(q).title} rows={2} maxLength={12000} value={value(q)} placeholder="A short answer is fine"
              onChange={e => edit(q, e.target.value)} className="w-full rounded-xl border p-3" />}
          <button type="button" onClick={() => onSingle(q.id)} className="min-h-10 text-sm text-sky-800 underline">Talk it through or answer separately</button>
        </fieldset>;
      })}
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">{error} Answers already saved are safe. The remaining drafts are still here.</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={disabled || saving || !changed.length} onClick={() => void save()}
        className="min-h-12 rounded-xl bg-sky-800 px-5 py-3 font-semibold text-white disabled:opacity-40">{saving ? "Saving your work…" : "Save activity and continue"}</button>
      <button type="button" disabled={saving || questions.some(q => !!drafts[q.id])} onClick={() => onNext(snapshot)}
        className="min-h-12 rounded-xl border px-4 py-3 disabled:opacity-40">Finish this later</button>
      {questions.some(q => !!drafts[q.id]) && <button type="button" disabled={saving} onClick={() => {
        if (!window.confirm("Discard only the unsaved edits in this activity? Saved answers will stay.")) return;
        for (const q of questions) delete drafts[q.id];
        render(n => n + 1);
      }} className="min-h-12 px-3 text-sm underline">Discard unsaved edits</button>}
    </div>
    <p className="mt-3 text-xs text-slate-500">Unknown answers stay unfinished. Saving does not submit your application.</p>
  </section>;
}

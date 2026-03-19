"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SafeBoundary } from "@/components/SafeBoundary";
import DealHealthPanel from "@/components/deals/DealHealthPanel";
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
import TranscriptUploadPanel from "@/components/deals/TranscriptUploadPanel";

const STORY_FIELDS = [
  { key: "use_of_proceeds", label: "Use of Proceeds", placeholder: "What exactly will the loan proceeds purchase or fund? Be specific \u2014 equipment make/model, property address, working capital purpose." },
  { key: "principal_background", label: "Management Background", placeholder: "How long has the principal been in this specific industry? Any prior relevant businesses or exits?" },
  { key: "collateral_description", label: "Collateral", placeholder: "Property address, appraised value, who holds the appraisal, lien position, advance rate used." },
  { key: "banking_relationship", label: "Banking Relationship", placeholder: "How long has this borrower banked here? Existing deposit accounts, prior loan history." },
  { key: "key_strengths", label: "Deal Strengths", placeholder: "What makes this credit compelling? What would you tell the credit committee?" },
  { key: "key_weaknesses", label: "Deal Weaknesses & Mitigants", placeholder: "What concerns you most about this deal, and how is each risk mitigated?" },
] as const;

type Question = { id: string; fact_key: string | null; question: string; source: "missing_fact" | "bie" };

export default function StoryPanel({ dealId }: { dealId: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [hasResearch, setHasResearch] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(`/api/deals/${dealId}/story/questions`)
      .then(r => r.json())
      .then(data => { if (data.ok) { setQuestions(data.questions ?? []); setHasResearch(data.hasResearch ?? false); } })
      .finally(() => setQuestionsLoading(false));
  }, [dealId]);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/memo-overrides`)
      .then(r => r.json())
      .then(data => { if (data.ok) setOverrides(data.overrides ?? {}); })
      .finally(() => setOverridesLoading(false));
  }, [dealId]);

  const saveField = useCallback((key: string, value: string) => {
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key]);
    debounceRefs.current[key] = setTimeout(async () => {
      setSavingKey(key);
      try {
        await fetch(`/api/deals/${dealId}/memo-overrides`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
        setOverrides(prev => ({ ...prev, [key]: value }));
      } finally { setSavingKey(null); }
    }, 800);
  }, [dealId]);

  const saveQuestionAnswer = useCallback((questionId: string, value: string) => {
    setQuestionAnswers(prev => ({ ...prev, [questionId]: value }));
    const key = `buddy_question_${questionId}`;
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key]);
    debounceRefs.current[key] = setTimeout(async () => {
      await fetch(`/api/deals/${dealId}/memo-overrides`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
    }, 800);
  }, [dealId]);

  const glassSection = "rounded-xl border border-white/8 bg-white/[0.02] p-4";
  const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3";

  return (
    <div className="space-y-4">
      {/* Section 1: Buddy's Questions */}
      <div className={glassSection}>
        <div className={sectionLabel}>Buddy&apos;s Questions</div>
        {questionsLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />)}</div>
        ) : questions.length === 0 ? (
          <div className="text-center py-6">
            {hasResearch ? (
              <p className="text-sm text-white/40">No open questions — all items addressed.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/40">Run Research to generate Buddy&apos;s analysis and underwriting questions.</p>
                <a href={`/credit-memo/${dealId}/canonical`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10">
                  <span className="material-symbols-outlined text-[14px]">science</span>
                  Go to Credit Memo to Run Research
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => {
              const savedAnswer = questionAnswers[q.id] ?? overrides[`buddy_question_${q.id}`] ?? "";
              return (
                <div key={q.id} className="rounded-lg border border-white/8 bg-black/20 p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <span className="material-symbols-outlined text-[16px] text-amber-400 mt-0.5 flex-shrink-0">help</span>
                    <p className="text-sm text-white/80 leading-relaxed">{q.question}</p>
                  </div>
                  <textarea value={savedAnswer} onChange={(e) => saveQuestionAnswer(q.id, e.target.value)} placeholder="Type your answer..." rows={2} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/20 resize-none" />
                  {savedAnswer && <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400"><span className="material-symbols-outlined text-[12px]">check_circle</span>Saved</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Deal Story Fields */}
      <div className={glassSection}>
        <div className={sectionLabel}>Deal Story</div>
        <p className="text-xs text-white/35 mb-4 -mt-1">This information feeds directly into the credit memo. Documents cannot provide it — only you can.</p>
        {overridesLoading ? (
          <div className="space-y-3">{STORY_FIELDS.map(f => <div key={f.key} className="h-20 rounded-lg bg-white/5 animate-pulse" />)}</div>
        ) : (
          <div className="space-y-4">
            {STORY_FIELDS.map((field) => {
              const current = overrides[field.key] ?? "";
              const isSaving = savingKey === field.key;
              return (
                <div key={field.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-wide">{field.label}</label>
                    {current && !isSaving && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><span className="material-symbols-outlined text-[12px]">check_circle</span>Saved</span>}
                    {isSaving && <span className="text-[10px] text-white/30 animate-pulse">Saving...</span>}
                  </div>
                  <textarea
                    value={current}
                    onChange={(e) => { const val = e.target.value; setOverrides(prev => ({ ...prev, [field.key]: val })); saveField(field.key, val); }}
                    placeholder={field.placeholder}
                    rows={3}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 resize-none leading-relaxed"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Credit Interview */}
      <div className={glassSection}>
        <div className={sectionLabel}>Credit Interview</div>
        <p className="text-xs text-white/35 mb-4 -mt-1">Start a voice session — Buddy will ask about this deal based on what&apos;s missing. Or paste a call transcript.</p>
        <div className="mb-4"><SafeBoundary><DealHealthPanel dealId={dealId} /></SafeBoundary></div>
        <SafeBoundary><BankerVoicePanel dealId={dealId} /></SafeBoundary>
        <div className="mt-3">
          <button type="button" onClick={() => setShowTranscript(v => !v)} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60">
            <span className="material-symbols-outlined text-[14px]">{showTranscript ? "expand_less" : "expand_more"}</span>
            Or paste a call transcript
          </button>
          {showTranscript && <div className="mt-3"><SafeBoundary><TranscriptUploadPanel dealId={dealId} /></SafeBoundary></div>}
        </div>
      </div>
    </div>
  );
}

"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PackageHandoff } from "./PackageHandoff";
import { UseOfProceedsAnswer } from "./UseOfProceedsAnswer";
import { GuidedPfsSchedules } from "./GuidedPfsSchedules";
import BorrowerVoicePanel from "@/components/brokerage/BorrowerVoicePanel";
import {
  GUIDED_CHOICES,
  type GuidedSnapshot,
  type GuidedQuestion,
} from "@/lib/borrower/guidedPackage/questions";
export function GuidedPackageWorkspace({
  dealId,
  tools,
  onSaved,
}: {
  dealId: string;
  tools: ReactNode;
  onSaved: () => void;
}) {
  const drafts = useRef<
    Record<
      string,
      {
        value: string;
        baseline: string | number | boolean | null;
        source: "text" | "voice";
      }
    >
  >({});
  const [snapshot, setSnapshot] = useState<GuidedSnapshot | null>(null);
  const [error, setError] = useState("");
  const [section, setSection] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showTools, setShowTools] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/brokerage/concierge?dealId=${encodeURIComponent(dealId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "Your application could not be loaded.");
      setSnapshot(data.snapshot);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load answers.");
    }
  }, [dealId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const sections = [
    ...new Set(snapshot?.questions.map((q) => q.section) ?? []),
  ];
  const activeSection = sections.includes(section) ? section : sections[0];
  const visible =
    snapshot?.questions.filter(
      (q) =>
        q.section === activeSection &&
        (!onlyOpen || !["saved", "not_applicable"].includes(q.state)),
    ) ?? [];
  const selected =
    visible.find((q) => q.id === selectedId) ?? visible[0];
  const percent = snapshot?.total
    ? Math.round((snapshot.saved / snapshot.total) * 100)
    : 0;
  return (
    <div className="space-y-5 text-slate-900">
      <header className="rounded-2xl border border-sky-100 bg-white p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">
          Your loan package
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">
            One question at a time. Everything in view.
          </h2>
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={() => {
              if (showTools) void refresh();
              setShowTools((v) => !v);
            }}
          >
            {showTools ? "Back to questions" : "Owners, documents & review"}
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Type your answer or talk with Buddy. Review what was captured, then
          save it to your application.
        </p>
        <div
          className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Answers saved"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-sky-600" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {snapshot
            ? `${snapshot.saved} of ${snapshot.total} answers saved`
            : "Loading your answers…"}{" "}
          · Documents, lender review and signatures are tracked separately.
        </p>
      </header>
      {error && (
        <div role="alert" className="rounded-xl bg-amber-50 p-4">
          {error}{" "}
          <button
            type="button"
            onClick={() => void refresh()}
            className="underline"
          >
            Retry loading
          </button>
        </div>
      )}
      {!!snapshot?.readErrors.length && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4">
          Some saved information is unavailable. Progress is incomplete; retry
          loading before editing.{" "}
          <button onClick={() => void refresh()} className="underline">
            Retry
          </button>
        </p>
      )}
      {showTools ? (
        <div className="space-y-5">
          <div className="rounded-2xl border bg-white p-4">{tools}</div>
          <GuidedPfsSchedules dealId={dealId} />
          <PackageHandoff
            dealId={dealId}
            poster={snapshot?.form722}
            onSaved={refresh}
          />
        </div>
      ) : (
        snapshot && (
          <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <nav
              aria-label="Application sections"
              className="rounded-2xl border border-slate-200 bg-white p-3 lg:sticky lg:top-4"
            >
              <label className="mb-3 flex items-center gap-2 p-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyOpen}
                  onChange={(e) => setOnlyOpen(e.target.checked)}
                />
                Show unanswered questions
              </label>
              {sections.map((s) => {
                const items = snapshot.questions.filter((q) => q.section === s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSection(s);
                      setSelectedId("");
                    }}
                    aria-current={activeSection === s ? "step" : undefined}
                    className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${activeSection === s ? "bg-sky-50 font-semibold text-sky-800" : "hover:bg-slate-50"}`}
                  >
                    <span>{s}</span>
                    <span className="shrink-0 text-xs">
                      {items.filter((q) => q.state === "saved").length}/
                      {items.length}
                    </span>
                  </button>
                );
              })}
              {!snapshot.owners.length && (
                <button
                  type="button"
                  onClick={() => setShowTools(true)}
                  className="mt-3 w-full rounded-lg bg-sky-700 p-3 text-sm text-white"
                >
                  Add your owners to reveal their questions
                </button>
              )}
            </nav>
            <div className="min-w-0 space-y-4">
              <div className="rounded-2xl border bg-white p-4">
                <h3 className="mb-3 font-semibold">{activeSection}</h3>
                <div className="max-h-72 overflow-auto">
                  {visible.map((q) => (
                    <button
                      type="button"
                      key={q.id}
                      onClick={() => setSelectedId(q.id)}
                      className={`mb-1 flex w-full gap-3 rounded-lg p-3 text-left text-sm ${q.id === selected?.id ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-slate-50"}`}
                    >
                      <span aria-hidden="true" className="text-sky-700">
                        {q.state === "saved"
                          ? "✓"
                          : q.state === "not_applicable"
                            ? "–"
                            : "○"}
                      </span>
                      <span className="flex-1">
                        {q.ownerName && (
                          <span className="block text-xs font-semibold text-slate-500">
                            {q.ownerName}
                          </span>
                        )}
                        {q.question}
                      </span>
                      <span className="text-xs text-slate-500">
                        {q.responsibility === "lender"
                          ? "Lender"
                          : q.state.replaceAll("_", " ")}
                      </span>
                    </button>
                  ))}
                  {!visible.length && (
                    <p className="p-3 text-sm text-slate-500">
                      No unanswered questions in this section.
                    </p>
                  )}
                </div>
              </div>
              {selected && (
                <AnswerCard
                  drafts={drafts.current}
                  key={selected.id}
                  question={selected}
                  dealId={dealId}
                  disabled={!!snapshot.readErrors.length}
                  onSaved={(next) => {
                    setSnapshot(next);
                    onSaved();
                  }}
                  onRefresh={refresh}
                  onNext={() => {
                    const index = snapshot.questions.findIndex(q => q.id === selected.id);
                    const next = snapshot.questions.slice(index + 1).find(q => !onlyOpen || !['saved', 'not_applicable'].includes(q.state));
                    if (next) { setSection(next.section); setSelectedId(next.id); }
                    else setShowTools(true);
                  }}
                />
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
function AnswerCard({
  drafts,
  question: q,
  dealId,
  disabled,
  onSaved,
  onRefresh,
  onNext,
}: {
  drafts: Record<
    string,
    {
      value: string;
      baseline: string | number | boolean | null;
      source: "text" | "voice";
    }
  >;
  question: GuidedQuestion;
  dealId: string;
  disabled: boolean;
  onSaved: (s: GuidedSnapshot) => void;
  onRefresh: () => Promise<void>;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState(
    drafts[q.id]?.value ??
      (q.field?.requiresPiiVault
        ? ""
        : q.value === null
          ? ""
          : String(q.value)),
  );
  const [baseline, setBaseline] = useState(drafts[q.id]?.baseline ?? q.value);
  const [dirty, setDirty] = useState(!!drafts[q.id]);
  const [source, setSource] = useState<"text" | "voice">(
    drafts[q.id]?.source ?? "text",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [buddyReview, setBuddyReview] = useState("");
  const [voice, setVoice] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) {
      setBaseline(q.value);
      setDraft(
        q.field?.requiresPiiVault
          ? ""
          : q.value === null
            ? ""
            : String(q.value),
      );
    }
  }, [q.value, q.field?.requiresPiiVault, dirty]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const edit = (value: string) => {
    setDraft(value);
    setDirty(true);
    setMessage("");
    setConfirmed(false);
    setSource("text");
  };
  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const value =
        q.id === "loan.use_of_proceeds"
          ? JSON.parse(draft)
          : q.type === "boolean"
            ? draft === "true"
              ? true
              : draft === "false"
                ? false
                : null
            : draft;
      const response = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "guided_answer",
          dealId,
          questionId: q.id,
          expectedValue: baseline,
          value,
          source,
          confirmed,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "Unable to save your answer.");
      setDirty(false);
      setMessage("Saved to your application.");
      onSaved(data.snapshot);
      if (q.field?.requiresPiiVault) setDraft("");
      else {
        setBuddyReview("Buddy is reviewing your saved answer…");
        void fetch("/api/brokerage/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "guided_review",
            dealId,
            questionId: q.id,
          }),
        })
          .then(async (response) => {
            const review = await response.json();
            setBuddyReview(
              review.ok
                ? review.message
                : "Your answer is saved. Buddy's review is temporarily unavailable.",
            );
          })
          .catch(() =>
            setBuddyReview(
              "Your answer is saved. Buddy's review is temporarily unavailable.",
            ),
          );
      }
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Unable to save. Your draft is still here.",
      );
      void onRefresh();
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (dirty && !q.field?.requiresPiiVault)
      drafts[q.id] = { value: draft, baseline, source };
    else delete drafts[q.id];
  }, [drafts, q.id, q.field?.requiresPiiVault, dirty, draft, baseline, source]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const inputClass =
    "mt-3 w-full rounded-xl border border-slate-300 bg-white p-3 text-base focus:outline-none focus:ring-2 focus:ring-sky-500";
  const choices = q.field && GUIDED_CHOICES[q.field.registryEntry.factPath];
  const locked =
    disabled || q.responsibility === "lender" || q.state === "not_applicable";
  return (
    <section
      className="rounded-2xl border bg-white p-5 sm:p-7"
      aria-label="Answer the selected question"
    >
      <p className="text-xs font-medium text-sky-700">
        {q.ownerName ?? "Your application"}
        {q.required
          ? " · Required for an applicable form"
          : " · Supporting information"}
      </p>
      <h3 id="guided-question-label" className="mt-2 text-xl font-semibold">
        {q.question}
      </h3>
      {q.field && (
        <p className="mt-2 text-xs text-slate-500">
          Used in {q.field.registryEntry.appliesToForms.join(", ")}.
        </p>
      )}
      {q.reason && <p className="mt-2 text-sm text-slate-500">{q.reason}</p>}
      {q.responsibility === "lender" ? (
        <p className="mt-4 text-sm">
          Your lender completes this field during review or closing.
        </p>
      ) : (
        <>
          {q.id === "loan.use_of_proceeds" ? (
            <UseOfProceedsAnswer
              value={draft}
              onChange={edit}
              disabled={locked}
            />
          ) : q.id === "loan.sba_program" ? (
            <select
              className={inputClass}
              aria-labelledby="guided-question-label"
              value={draft}
              onChange={(e) => edit(e.target.value)}
              disabled={locked}
            >
              <option value="">Choose a program</option>
              <option value="7A">SBA 7(a)</option>
              <option value="504">SBA 504</option>
            </select>
          ) : choices ? (
            <select
              className={inputClass}
              aria-labelledby="guided-question-label"
              value={draft}
              onChange={(e) => edit(e.target.value)}
              disabled={locked}
            >
              <option value="">Choose an answer</option>
              {choices.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : q.type === "boolean" ? (
            <select
              aria-labelledby="guided-question-label"
              className={inputClass}
              value={draft}
              onChange={(e) => edit(e.target.value)}
              disabled={locked}
            >
              <option value="">Choose an answer</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : q.field?.requiresPiiVault || q.type === "date" ? (
            <input
              aria-labelledby="guided-question-label"
              className={inputClass}
              type={q.field?.requiresPiiVault ? "password" : "date"}
              autoComplete="off"
              value={draft}
              onChange={(e) => edit(e.target.value)}
              disabled={locked}
            />
          ) : (
            <textarea
              aria-labelledby="guided-question-label"
              className={inputClass}
              rows={5}
              maxLength={12000}
              value={draft}
              placeholder="Your answer…"
              onChange={(e) => edit(e.target.value)}
              disabled={locked}
            />
          )}
          {q.field?.requiresExplicitConfirmation && (
            <label className="mt-3 flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm this answer is accurate.
            </label>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {dirty
              ? "Unsaved draft. It stays here while you work through other questions."
              : q.state === "saved"
                ? "Saved answer loaded from your application."
                : "You can return to this question later."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                locked ||
                saving ||
                !draft.trim() ||
                (dirty && baseline !== q.value) ||
                (!!q.field?.requiresExplicitConfirmation && !confirmed)
              }
              onClick={() => void save()}
              className="rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save answer"}
            </button>
            <button
              type="button"
              disabled={dirty || saving}
              onClick={onNext}
              className="rounded-lg border px-4 py-2.5 text-sm disabled:opacity-40"
            >
              Next question
            </button>
            {!q.field?.requiresPiiVault && (
              <button
                type="button"
                onClick={() => setVoice((v) => !v)}
                className="rounded-lg border px-4 py-2.5 text-sm"
              >
                {voice ? "Close voice" : "Talk with Buddy"}
              </button>
            )}
          </div>
          {dirty && baseline !== q.value && (
            <div
              role="alert"
              className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"
            >
              <p>
                This answer changed while you were editing. Your draft is
                preserved.
              </p>
              <p className="mt-2 whitespace-pre-wrap">
                Latest saved answer:{" "}
                {q.value === null ? "No answer" : String(q.value)}
              </p>
              <button
                type="button"
                className="mt-2 underline"
                onClick={() => setBaseline(q.value)}
              >
                I reviewed the change; let me save my draft
              </button>
            </div>
          )}
          {message && (
            <p role="status" className="mt-3 rounded-lg bg-sky-50 p-3 text-sm">
              {message}
            </p>
          )}
          {buddyReview && (
            <div
              className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"
              role="status"
            >
              <p className="mb-1 font-semibold">Buddy</p>
              {buddyReview}
            </div>
          )}
          {voice && (
            <div className="mt-5">
              <BorrowerVoicePanel
                dealId={dealId}
                question={`${q.ownerName ? "For " + q.ownerName + ": " : ""}${q.question}`}
                onUserAnswer={(text) => {
                  setTranscript((previous) =>
                    previous ? previous + " " + text : text,
                  );
                  if (
                    !choices &&
                    ![
                      "boolean",
                      "number",
                      "currency",
                      "date",
                      "select",
                    ].includes(q.type) &&
                    q.id !== "loan.use_of_proceeds"
                  ) {
                    setDraft((previous) =>
                      previous ? previous + " " + text : text,
                    );
                    setDirty(true);
                  }
                  setSource("voice");
                  setConfirmed(false);
                }}
                onAssistantTurn={() => {
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => void onRefresh(), 2500);
                }}
              />
              {transcript && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-sky-50 p-3 text-sm">
                  Your spoken answer: {transcript}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Review and correct the transcript above before saving. For a
                Yes/No or numeric field, enter the final answer in that format.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

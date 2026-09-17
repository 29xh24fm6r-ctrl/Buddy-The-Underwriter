"use client";
import { readGuidedResponse } from "@/lib/borrower/journey/response";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ListChecks,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { LenderPackageReview } from "./LenderPackageReview";
import { PackageHandoff } from "./PackageHandoff";
import { UseOfProceedsAnswer } from "./UseOfProceedsAnswer";
import { GuidedPfsSchedules } from "./GuidedPfsSchedules";
import { OwnershipEditor } from "./OwnershipEditor";
import { IntakeOwnershipStep } from "./IntakeOwnershipStep";
import { PortalUploadDropzone } from "./PortalUploadDropzone";
import { UploadedDocumentsList } from "./UploadedDocumentsList";
import { IdentityVerificationPanel } from "./IdentityVerificationPanel";
import { SealPackageCard } from "@/components/brokerage/SealPackageCard";
import { SigningPanel } from "@/components/brokerage/SigningPanel";
import { FloatingConcierge } from "./FloatingConcierge";
import { JourneyHelp } from "./JourneyHelp";
import { useCapture } from "@/components/analytics/useCapture";
import { ProgramOptions } from "./ProgramOptions";
import BorrowerVoicePanel from "@/components/brokerage/BorrowerVoicePanel";
import {
  GUIDED_CHOICES,
  type GuidedSnapshot,
  type GuidedQuestion,
} from "@/lib/borrower/guidedPackage/questions";
import {
  DISCOVERY_CHOICES,
  choiceLabel,
} from "@/lib/borrower/journey/discovery";
import {
  CHAPTERS,
  chapterFor,
  orderedQuestions,
  recommendedQuestions,
  nextQuestion,
  questionHelp,
  type Chapter,
} from "@/lib/borrower/journey/presentation";
type Drafts = Record<
  string,
  {
    value: string;
    baseline: string | number | boolean | null;
    source: "text" | "voice";
  }
>;
export function GuidedPackageWorkspace({
  dealId,
  onSaved,
  borrowerName = null,
  initialGoal = "",
}: {
  dealId: string;
  onSaved: () => void;
  borrowerName?: string | null;
  initialGoal?: string;
}) {
  const capture = useCapture();
  const drafts = useRef<Drafts>({});
  const [snapshot, setSnapshot] = useState<GuidedSnapshot | null>(null);
  const [error, setError] = useState("");
  const [chapter, setChapter] = useState<Chapter>("plan");
  const [selectedId, setSelectedId] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [help, setHelp] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [protectedDirty, setProtectedDirty] = useState(false);
  const [uploadVersion, setUploadVersion] = useState(0);
  const [goalPending, setGoalPending] = useState(initialGoal);
  const [goalSaving, setGoalSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const initialized = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/brokerage/concierge?dealId=${encodeURIComponent(dealId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(
          "We couldn’t load your application. Your saved answers are safe; please retry.",
        );
      setSnapshot(readGuidedResponse(data, dealId));
      setError("");
      if (!initialized.current) {
        initialized.current = true;
        // Resume the first unfinished task from confirmed server data, never from a guessed percentage.
        const next = CHAPTERS.flatMap((c) =>
          recommendedQuestions(readGuidedResponse(data, dealId), c.id),
        ).find((q) => q.state !== "saved");
        if (next && !initialGoal) {
          setChapter(chapterFor(next));
          setSelectedId(next.id);
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load your application.",
      );
    }
  }, [dealId, initialGoal]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(drafts.current).length || protectedDirty || reviewDirty)
        e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [protectedDirty, reviewDirty]);
  function navigate(next: Chapter, questionId = "") {
    if (protectedDirty || reviewDirty) {
      setError(
        "Save your current protected answer or financial draft before changing tasks.",
      );
      return;
    }
    capture("borrower_journey_task_opened", { chapter: next });
    setChapter(next);
    setSelectedId(questionId);
    setShowOptions(false);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function saveWelcomeGoal() {
    const question = snapshot?.questions.find((q) => q.id === "A11");
    if (!question) return;
    setGoalSaving(true);
    try {
      const r = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "guided_answer",
          dealId,
          questionId: "A11",
          expectedValue: question.value,
          value: goalPending,
          source: "text",
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok)
        throw new Error(
          data.error || "Your goal could not be saved. Please retry.",
        );
      setSnapshot(readGuidedResponse(data, dealId));
      setGoalPending("");
      onSaved();
      navigate("plan", "A01");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setGoalSaving(false);
    }
  }
  const questions = snapshot ? recommendedQuestions(snapshot, chapter) : [];
  const selected =
    snapshot?.questions.find(
      (q) => q.id === selectedId && chapterFor(q) === chapter,
    ) ?? nextQuestion(questions);
  const current = CHAPTERS.find((c) => c.id === chapter)!;
  const all = snapshot?.questions ?? [];
  const goal = all.find((q) => q.id === "A11")?.value;
  return (
    <div className="space-y-7 pb-12 text-slate-900">
      <header className="flex flex-wrap items-end justify-between gap-4 py-4">
        <div>
          <p className="text-sm font-medium text-sky-800">
            {borrowerName
              ? `${borrowerName}’s application`
              : "Your application"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {goal ? choiceLabel("A11", goal) : "Let’s build your next chapter."}
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            A little at a time. Your saved answers stay with your application.
          </p>
        </div>
        <button
          onClick={() => setShowMap((v) => !v)}
          aria-expanded={showMap}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium"
        >
          <ListChecks className="h-4 w-4" />
          {showMap ? "Close application map" : "View application map"}
        </button>
      </header>
      <nav
        aria-label="Your application journey"
        className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 sm:grid sm:grid-cols-5"
      >
        {CHAPTERS.map((c, i) => {
          const qs = snapshot ? orderedQuestions(snapshot, c.id) : [];
          const saved = qs.filter((q) => q.state === "saved").length;
          return (
            <button
              key={c.id}
              aria-current={chapter === c.id ? "step" : undefined}
              onClick={() => navigate(c.id)}
              className={`min-h-20 min-w-32 shrink-0 rounded-xl p-3 text-left sm:min-w-0 ${chapter === c.id ? "bg-sky-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <span className="block text-xs opacity-80">STEP {i + 1}</span>
              <span className="mt-1 block text-sm font-semibold">
                {c.title}
              </span>
              {saved > 0 && (
                <span className="mt-1 block text-xs">
                  {saved} answers saved
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {error && (
        <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">
          {error}{" "}
          <button onClick={() => void refresh()} className="min-h-11 underline">
            Reload saved information
          </button>
        </div>
      )}
      {!!snapshot?.readErrors.length && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4">
          Some saved information is unavailable. Editing is paused until it can
          be reloaded.
        </p>
      )}
      {goalPending && snapshot && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <p className="flex-1">
            You chose <strong>{choiceLabel("A11", goalPending)}</strong>.{" "}
            {goal
              ? "Replace your saved goal with this choice?"
              : "Save this goal to this application?"}
          </p>
          <button
            disabled={goalSaving || !!snapshot.readErrors.length}
            onClick={() => void saveWelcomeGoal()}
            className="min-h-11 rounded-xl bg-sky-800 px-4 text-white disabled:opacity-50"
          >
            {goalSaving ? "Saving…" : "Save my goal"}
          </button>
          <button
            disabled={goalSaving}
            onClick={() => setGoalPending("")}
            className="min-h-11 underline"
          >
            Keep current application
          </button>
        </div>
      )}
      {showMap && snapshot && (
        <section
          aria-label="Complete application map"
          className="rounded-2xl border border-slate-200 bg-white p-6"
        >
          <h2 className="text-xl font-semibold">
            Your application, at a glance
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {snapshot.saved} answers saved. Requirements can change with your
            project. Documents, signatures and lender review have their own
            checks.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {CHAPTERS.map((c) => (
              <details key={c.id} className="rounded-xl bg-slate-50 p-4">
                <summary className="cursor-pointer font-semibold">
                  {c.title}
                </summary>
                <ul className="mt-3 space-y-1">
                  {orderedQuestions(snapshot, c.id).map((q) => (
                    <li key={q.id}>
                      <button
                        onClick={() => {
                          navigate(c.id, q.id);
                          setShowMap(false);
                        }}
                        className="flex min-h-11 w-full items-start gap-2 rounded-lg p-2 text-left text-sm hover:bg-white"
                      >
                        <span aria-hidden="true">
                          {q.state === "saved" ? "✓" : "○"}
                        </span>
                        <span>
                          {q.ownerName && `${q.ownerName}: `}
                          {q.id === "loan.sba_program"
                            ? "Has a program been selected for your application?"
                            : q.question}
                          <span className="block text-xs text-slate-500">
                            {q.state === "saved"
                              ? "Saved"
                              : q.state === "needs_confirmation"
                                ? "Please confirm"
                                : "To do"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-sm font-semibold text-sky-800">
              {current.title}
            </p>
            <h2
              ref={heading}
              tabIndex={-1}
              className="mt-2 text-2xl font-semibold outline-none"
            >
              {current.subtitle}
            </h2>
          </div>
          {!snapshot && (
            <p role="status" className="rounded-2xl bg-white p-8">
              Loading your saved application…
            </p>
          )}
          {chapter === "plan" && (
            <button
              onClick={() => {
                if (protectedDirty || reviewDirty) {
                  setError(
                    "Save your current protected answer or financial draft before changing tasks.",
                  );
                  return;
                }
                setShowOptions((v) => !v);
              }}
              aria-expanded={showOptions}
              className="flex min-h-12 items-center gap-2 text-sm font-semibold text-sky-800"
            >
              {showOptions ? "Back to your plan" : "Explore financing options"}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {showOptions && snapshot ? (
            <ProgramOptions snapshot={snapshot} />
          ) : selected && snapshot ? (
            <AnswerCard
              key={selected.id}
              drafts={drafts.current}
              question={selected}
              dealId={dealId}
              disabled={!!snapshot.readErrors.length}
              onProtectedDirty={setProtectedDirty}
              onSaved={(next) => {
                setSelectedId(selected.id);
                setSnapshot(next);
                onSaved();
              }}
              onRefresh={refresh}
              onNext={() => {
                const index = questions.findIndex((q) => q.id === selected.id);
                const next = questions
                  .slice(index + 1)
                  .find((q) => q.state !== "saved");
                if (next) setSelectedId(next.id);
                else if (chapter === "plan") setShowOptions(true);
                else
                  navigate(
                    CHAPTERS[
                      Math.min(
                        CHAPTERS.findIndex((c) => c.id === chapter) + 1,
                        4,
                      )
                    ].id,
                  );
              }}
            />
          ) : (
            snapshot && (
              <p className="rounded-2xl bg-white p-6">
                No questions are available in this section yet. You can use the
                tasks below or explore another chapter.
              </p>
            )
          )}
          {/* Keep work panels mounted after first visit so changing chapters cannot discard drafts. */}
          <JourneyPanels
            chapter={chapter}
            dealId={dealId}
            borrowerName={borrowerName}
            snapshot={snapshot}
            uploadVersion={uploadVersion}
            onUpload={() => {
              setUploadVersion((v) => v + 1);
              onSaved();
              void refresh();
            }}
            onSaved={() => {
              onSaved();
              void refresh();
            }}
            refresh={refresh}
            onReviewDirty={setReviewDirty}
          />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-sky-100 bg-white p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-800 font-semibold text-white">
              B
            </span>
            <h2 className="mt-4 font-semibold">A little help from Buddy</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {selected ? questionHelp(selected) : current.help}
            </p>
            <button
              onClick={() => setHelp((v) => !v)}
              aria-expanded={help}
              className="mt-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-sky-800"
            >
              <MessageCircle className="h-4 w-4" />
              {help ? "Close Buddy" : "Ask Buddy"}
            </button>
            {help && (
              <FloatingConcierge
                inline
                dealId={dealId}
                borrowerName={borrowerName}
              />
            )}
          </div>
          <JourneyHelp dealId={dealId} />
          <div className="rounded-2xl bg-sky-50 p-5">
            <ShieldCheck className="h-5 w-5 text-sky-800" />
            <p className="mt-3 text-sm leading-6 text-slate-700">
              You’re in control. Review and correct your answers before
              submitting. Saving an answer does not submit your application.
            </p>
          </div>
          {snapshot && snapshot.saved > 0 && (
            <div role="status" className="rounded-2xl bg-emerald-50 p-5">
              <Check className="h-5 w-5 text-emerald-800" />
              <p className="mt-2 text-sm text-emerald-900">
                {snapshot.saved} answers are saved to your application. That’s
                work you can return to.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
function JourneyPanels({
  chapter,
  dealId,
  borrowerName,
  snapshot,
  uploadVersion,
  onUpload,
  onSaved,
  refresh,
  onReviewDirty,
}: {
  chapter: Chapter;
  dealId: string;
  borrowerName: string | null;
  snapshot: GuidedSnapshot | null;
  uploadVersion: number;
  onUpload: () => void;
  onSaved: () => void;
  refresh: () => Promise<void>;
  onReviewDirty: (dirty: boolean) => void;
}) {
  const [visited, setVisited] = useState<Chapter[]>([chapter]);
  if (!visited.includes(chapter)) setVisited([...visited, chapter]);
  return (
    <>
      {visited.includes("business") && (
        <div hidden={chapter !== "business"} className="space-y-5">
          <details className="rounded-2xl border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer py-2 font-semibold">
              People & ownership
            </summary>
            <div className="mt-4">
              {snapshot?.owners.length ? (
                <OwnershipEditor token={dealId} onChanged={onSaved} />
              ) : (
                <IntakeOwnershipStep
                  dealId={dealId}
                  borrowerName={borrowerName}
                  onContinue={onSaved}
                />
              )}
            </div>
          </details>
        </div>
      )}
      {visited.includes("numbers") && (
        <div hidden={chapter !== "numbers"} className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-xl font-semibold">
              Bring what you have. We’ll keep it organized.
            </h3>
            <p className="my-3 text-sm leading-6 text-slate-600">
              Start with business tax returns, a recent profit and loss
              statement, and a balance sheet if available. You can add more
              later. Uploading is separate from processing and acceptance.
            </p>
            <PortalUploadDropzone
              dealId={dealId}
              token={dealId}
              onUploadComplete={onUpload}
            />
            <UploadedDocumentsList token={dealId} refreshKey={uploadVersion} />
          </section>
          <details className="rounded-2xl border bg-white p-5">
            <summary className="cursor-pointer py-2 font-semibold">
              Personal financial schedules
            </summary>
            <div className="mt-4">
              <GuidedPfsSchedules dealId={dealId} />
            </div>
          </details>
        </div>
      )}
      {visited.includes("application") && (
        <div hidden={chapter !== "application"}>
          <LenderPackageReview dealId={dealId} onDirtyChange={onReviewDirty} />
        </div>
      )}
      {visited.includes("review") && (
        <div hidden={chapter !== "review"} className="space-y-5">
          <section className="rounded-2xl border bg-white p-6">
            <h3 className="text-xl font-semibold">Before you move forward</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Check your saved answers in the application map, review your
              documents, and complete any required identity and signature tasks.
              Preparing a package does not mean it has been shared or approved.
            </p>
          </section>
          <PackageHandoff
            dealId={dealId}
            poster={snapshot?.form722}
            onSaved={refresh}
          />
          <IdentityVerificationPanel token={dealId} />
          <SealPackageCard dealId={dealId} />
          <SigningPanel dealId={dealId} />
        </div>
      )}
    </>
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
  onProtectedDirty,
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
  onProtectedDirty: (dirty: boolean) => void;
}) {
  const capture = useCapture();
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
      readGuidedResponse(data, dealId);
      capture("borrower_journey_answer_saved", {
        chapter: chapterFor(q),
        input_method: source,
      });
      delete drafts[q.id];
      setDirty(false);
      setMessage("Saved to your application.");
      onSaved(readGuidedResponse(data, dealId));
      if (q.field?.requiresPiiVault) setDraft("");
    } catch (e) {
      capture("borrower_journey_save_failed", { chapter: chapterFor(q) });
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
  useEffect(() => {
    onProtectedDirty(dirty && !!q.field?.requiresPiiVault);
    return () => onProtectedDirty(false);
  }, [dirty, q.field?.requiresPiiVault, onProtectedDirty]);
  const askReview = async () => {
    setBuddyReview("Buddy is reviewing your saved answer…");
    try {
      const response = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "guided_review",
          dealId,
          questionId: q.id,
        }),
      });
      const data = await response.json();
      setBuddyReview(
        response.ok && data.ok
          ? data.message
          : "Your answer is saved. Buddy’s review is temporarily unavailable; you can keep going.",
      );
    } catch {
      setBuddyReview(
        "Your answer is saved. Buddy’s review is temporarily unavailable; you can keep going.",
      );
    }
  };
  const inputClass =
    "mt-3 w-full rounded-xl border border-slate-300 bg-white p-3 text-base focus:outline-none focus:ring-2 focus:ring-sky-500";
  const choices =
    DISCOVERY_CHOICES[q.id] ??
    (q.field && GUIDED_CHOICES[q.field.registryEntry.factPath]);
  const locked =
    disabled || q.responsibility === "lender" || q.state === "not_applicable";
  return (
    <section
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      aria-label="Answer the selected question"
    >
      <p className="text-xs font-medium text-sky-700">
        {q.ownerName ?? "Your application"}
        {q.required
          ? " · Required for an applicable form"
          : " · Supporting information"}
      </p>
      <h3 id="guided-question-label" className="mt-2 text-xl font-semibold">
        {q.id === "loan.sba_program"
          ? "Has a program been selected for your application?"
          : q.question}
      </h3>
      {q.field && (
        <p className="mt-2 text-xs text-slate-500">
          This answer carries into your applicable application forms.
        </p>
      )}
      {q.reason && !q.reason.startsWith("Package narrative") && (
        <p className="mt-2 text-sm text-slate-500">{q.reason}</p>
      )}
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
          ) : q.id === "A11" && choices ? (
            <div
              role="group"
              aria-labelledby="guided-question-label"
              className="mt-5 grid gap-3 sm:grid-cols-2"
            >
              {choices.map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  disabled={locked}
                  aria-pressed={draft === key}
                  onClick={() => edit(key)}
                  className={`min-h-16 rounded-xl border p-4 text-left text-sm font-medium ${draft === key ? "border-sky-700 bg-sky-50 text-sky-900" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
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
          ) : ["number", "currency"].includes(q.type) ? (
            <input
              aria-labelledby="guided-question-label"
              className={inputClass}
              inputMode="decimal"
              value={draft}
              onChange={(e) => edit(e.target.value)}
              disabled={locked}
              placeholder={
                q.type === "currency" ? "Amount in USD" : "Enter a number"
              }
            />
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
              ? q.field?.requiresPiiVault
                ? "Unsaved protected value. Save it before changing questions."
                : "Unsaved draft. It stays here while you work through other questions."
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
              {q.state === "saved" ? "Continue" : "Return later"}
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
          {q.state === "saved" && !dirty && !q.field?.requiresPiiVault && (
            <button
              type="button"
              onClick={() => void askReview()}
              className="mt-3 min-h-11 text-sm font-semibold text-sky-800 underline"
            >
              Ask Buddy to review this answer
            </button>
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
                question={`${q.ownerName ? "For " + q.ownerName + ": " : ""}${q.id === "loan.sba_program" ? "Has a program been selected for your application?" : q.question}`}
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

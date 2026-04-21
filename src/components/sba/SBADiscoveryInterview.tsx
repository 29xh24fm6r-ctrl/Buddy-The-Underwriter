"use client";

// src/components/sba/SBADiscoveryInterview.tsx
// God Tier Business Plan — Step 4
// One-question-at-a-time conversational capture of the borrower's voice and
// vision. Six screens, each with a single open-ended question, a helper
// explaining why we're asking, and a "Skip" / "Next" pair. Each answer is
// saved to the borrower-story API on Next so a borrower can leave mid-flow
// and return later. When the full story already exists, the component
// renders a compact summary card with an Edit affordance instead.

import { useCallback, useEffect, useMemo, useState } from "react";

interface BorrowerStory {
  dealId: string;
  originStory: string | null;
  competitiveInsight: string | null;
  idealCustomer: string | null;
  growthStrategy: string | null;
  biggestRisk: string | null;
  personalVision: string | null;
}

type StoryField =
  | "originStory"
  | "competitiveInsight"
  | "idealCustomer"
  | "growthStrategy"
  | "biggestRisk"
  | "personalVision";

interface Screen {
  field: StoryField;
  title: string;
  question: string;
  helper: string;
  placeholder: string;
  suggestedMin: number;
  suggestedMax: number;
}

const SCREENS: Screen[] = [
  {
    field: "originStory",
    title: "Tell us your story",
    question:
      "What led you to this business? What moment, experience, or insight made you decide this was the path for you?",
    helper:
      "There's no wrong answer. Whether it was a lifelong dream, an opportunity you spotted, or a skill you've perfected — your story is the foundation of your business plan.",
    placeholder:
      "Walk us through it. When did you first get into this line of work? What pulled you toward it?",
    suggestedMin: 100,
    suggestedMax: 500,
  },
  {
    field: "competitiveInsight",
    title: "What's your edge?",
    question:
      "What do you know about this industry or market that most people don't? What insight or advantage do you bring that your competitors are missing?",
    helper:
      "Think about what you've seen from the inside. Maybe it's a relationship, a process, a geographic advantage, or an underserved customer group.",
    placeholder:
      "What have you learned that outsiders never see? Where do your competitors consistently fall short?",
    suggestedMin: 100,
    suggestedMax: 500,
  },
  {
    field: "idealCustomer",
    title: "Who is your customer?",
    question:
      "Describe your ideal customer. Not demographics — the actual person. Who are they, what's their problem, and why do they choose you?",
    helper:
      "The more specific you are, the sharper your marketing plan will be. 'Office managers who are tired of unreliable vendors' is better than 'businesses.'",
    placeholder:
      "Picture a real one. What do they do for a living, what keeps them up at night, and what finally makes them pick up the phone?",
    suggestedMin: 100,
    suggestedMax: 500,
  },
  {
    field: "growthStrategy",
    title: "How will you grow?",
    question:
      "What specific actions will you take to grow this business over the next 1-3 years? Think about new customers, new services, new locations, partnerships, or marketing channels.",
    helper:
      "Your financial projections will be built from these specific actions. '8% growth' doesn't help you — 'add 2 new clients per quarter through broker referrals' does.",
    placeholder:
      "List the concrete moves. Where are new customers coming from? What are you adding to earn more per customer?",
    suggestedMin: 100,
    suggestedMax: 500,
  },
  {
    field: "biggestRisk",
    title: "What keeps you up at night?",
    question:
      "What's the biggest risk to this business? What could go wrong, and what would you do about it?",
    helper:
      "Every business has risks. The best business plans don't hide them — they confront them with specific contingency plans. This honesty builds trust.",
    placeholder:
      "Be honest. What's the thing that could actually hurt you, and what's your plan if it happens?",
    suggestedMin: 100,
    suggestedMax: 500,
  },
  {
    field: "personalVision",
    title: "What does success look like?",
    question:
      "Imagine it's 3 years from now and everything went right. What does your business look like? What does your life look like?",
    helper:
      "This isn't just for the plan — this is your north star. Financial independence? Building something to pass to your children? This is what you're working toward.",
    placeholder:
      "Paint the picture. How big is the business, what are you doing day-to-day, what has changed for your family?",
    suggestedMin: 100,
    suggestedMax: 500,
  },
];

interface Props {
  dealId: string;
  initialStory: BorrowerStory | null;
  onComplete?: () => void;
}

export default function SBADiscoveryInterview({
  dealId,
  initialStory,
  onComplete,
}: Props) {
  const [story, setStory] = useState<BorrowerStory | null>(initialStory);
  const [editing, setEditing] = useState<boolean>(!initialStory);
  const [screenIdx, setScreenIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<StoryField, string>>(() => ({
    originStory: initialStory?.originStory ?? "",
    competitiveInsight: initialStory?.competitiveInsight ?? "",
    idealCustomer: initialStory?.idealCustomer ?? "",
    growthStrategy: initialStory?.growthStrategy ?? "",
    biggestRisk: initialStory?.biggestRisk ?? "",
    personalVision: initialStory?.personalVision ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentScreen = SCREENS[screenIdx];
  const isSummary = screenIdx >= SCREENS.length;
  const storyHasAnyAnswer = useMemo(
    () => Object.values(answers).some((a) => a.trim().length > 0),
    [answers],
  );

  const saveField = useCallback(
    async (field: StoryField, value: string) => {
      setSaving(true);
      setError(null);
      try {
        const resp = await fetch(
          `/api/deals/${dealId}/sba/borrower-story`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: value }),
          },
        );
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          throw new Error(data.error || `http_${resp.status}`);
        }
        if (data.story) setStory(data.story as BorrowerStory);
      } catch (err) {
        console.error("[SBADiscoveryInterview] save error:", err);
        setError("Couldn't save that answer. Try again in a moment.");
      } finally {
        setSaving(false);
      }
    },
    [dealId],
  );

  const handleNext = useCallback(async () => {
    if (!currentScreen) return;
    const value = answers[currentScreen.field].trim();
    if (value.length > 0) {
      await saveField(currentScreen.field, value);
    }
    setScreenIdx((i) => i + 1);
  }, [currentScreen, answers, saveField]);

  const handleSkip = useCallback(() => {
    setScreenIdx((i) => i + 1);
  }, []);

  const handleBack = useCallback(() => {
    setScreenIdx((i) => Math.max(0, i - 1));
  }, []);

  const handleStartEdit = useCallback(() => {
    setEditing(true);
    setScreenIdx(0);
  }, []);

  const handleFinish = useCallback(() => {
    setEditing(false);
    if (onComplete) onComplete();
  }, [onComplete]);

  // When editing is toggled off while no answers exist, reset to screen 0 so
  // the user lands on a clean slate the next time they open the interview.
  useEffect(() => {
    if (!editing && !storyHasAnyAnswer) setScreenIdx(0);
  }, [editing, storyHasAnyAnswer]);

  // ─── Compact summary view (story already captured) ───────────────────────
  if (!editing && story) {
    return (
      <SummaryCard story={story} onEdit={handleStartEdit} />
    );
  }

  // ─── Final summary screen (after 6 questions) ────────────────────────────
  if (isSummary) {
    return (
      <FinalSummary
        answers={answers}
        dealId={dealId}
        saving={saving}
        onEdit={(idx) => setScreenIdx(idx)}
        onFinish={handleFinish}
      />
    );
  }

  // ─── Active question screen ──────────────────────────────────────────────
  const currentValue = answers[currentScreen.field];
  const charCount = currentValue.length;
  const meetsMin = charCount >= currentScreen.suggestedMin;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300 text-sm font-semibold">
            B
          </div>
          <div className="text-xs font-medium text-white/50 uppercase tracking-wide">
            Discovery Interview
          </div>
        </div>
        <div className="text-xs text-white/40 font-mono">
          {screenIdx + 1} / {SCREENS.length}
        </div>
      </div>

      <div className="mb-2 h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${((screenIdx + 1) / SCREENS.length) * 100}%` }}
        />
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-semibold text-white mb-3">
          {currentScreen.title}
        </h3>
        <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4 mb-4">
          <p className="text-sm text-white/90 leading-relaxed">
            {currentScreen.question}
          </p>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-4">
          {currentScreen.helper}
        </p>

        <textarea
          value={currentValue}
          onChange={(e) =>
            setAnswers((prev) => ({
              ...prev,
              [currentScreen.field]: e.target.value,
            }))
          }
          placeholder={currentScreen.placeholder}
          rows={7}
          className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/60 resize-y min-h-[140px]"
        />

        <div className="mt-2 flex items-center justify-between text-xs">
          <span
            className={
              charCount === 0
                ? "text-white/30"
                : meetsMin
                  ? "text-green-400/80"
                  : "text-white/40"
            }
          >
            {charCount === 0
              ? `Suggested ${currentScreen.suggestedMin}-${currentScreen.suggestedMax} characters`
              : `${charCount} characters`}
          </span>
          {error && <span className="text-amber-400">{error}</span>}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={screenIdx === 0 || saving}
            className="text-sm text-white/50 hover:text-white/80 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSkip}
              disabled={saving}
              className="text-sm text-white/50 hover:text-white/80 disabled:opacity-30"
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={saving}
              className="rounded-lg bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/40 px-5 py-2 text-sm font-medium text-white transition-colors"
            >
              {saving
                ? "Saving…"
                : screenIdx === SCREENS.length - 1
                  ? "Review"
                  : "Next"}
            </button>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-white/40 leading-relaxed">
        Completing all six questions takes about 10 minutes and makes your
        business plan dramatically better. You can skip any question and come
        back later.
      </p>
    </div>
  );
}

// ─── Summary card when story already exists ───────────────────────────────

function SummaryCard({
  story,
  onEdit,
}: {
  story: BorrowerStory;
  onEdit: () => void;
}) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Your story", value: story.originStory },
    { label: "Your edge", value: story.competitiveInsight },
    { label: "Your customer", value: story.idealCustomer },
    { label: "Your growth plan", value: story.growthStrategy },
    { label: "Biggest risk", value: story.biggestRisk },
    { label: "Success in 3 years", value: story.personalVision },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Your Story
          </h3>
          <p className="text-xs text-white/50 mt-1">
            Captured from your discovery interview. Used to shape every section
            of your business plan.
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-white/15 hover:border-white/30 px-3 py-1.5 text-xs text-white/80"
        >
          Edit
        </button>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="text-xs">
            <div className="text-white/50 font-medium mb-0.5">{row.label}</div>
            <div className="text-white/80 leading-relaxed">
              {row.value && row.value.trim().length > 0 ? (
                <span className="line-clamp-3">{row.value}</span>
              ) : (
                <span className="text-white/30 italic">Not yet captured</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Final summary / review screen ────────────────────────────────────────

function FinalSummary({
  answers,
  dealId,
  saving,
  onEdit,
  onFinish,
}: {
  answers: Record<StoryField, string>;
  dealId: string;
  saving: boolean;
  onEdit: (idx: number) => void;
  onFinish: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Make sure the final state is on the server. The individual saves on
      // each Next should have handled this, but send one reconciling PUT so
      // editing a screen and finishing without Next'ing still persists.
      const resp = await fetch(
        `/api/deals/${dealId}/sba/borrower-story`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(answers),
        },
      );
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || `http_${resp.status}`);
      onFinish();
    } catch (err) {
      console.error("[SBADiscoveryInterview] finish error:", err);
      setError("Couldn't save your answers. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }, [answers, dealId, onFinish]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-white mb-1">
          Review your answers
        </h3>
        <p className="text-xs text-white/50">
          Edit anything that doesn't feel right. When you're ready, generate
          your business plan.
        </p>
      </div>

      <div className="space-y-4">
        {SCREENS.map((screen, idx) => {
          const value = answers[screen.field];
          const hasValue = value.trim().length > 0;
          return (
            <div
              key={screen.field}
              className="rounded-xl border border-white/10 bg-black/20 p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-sm font-semibold text-white">
                  {screen.title}
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(idx)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Edit
                </button>
              </div>
              {hasValue ? (
                <p className="text-xs text-white/75 leading-relaxed whitespace-pre-wrap">
                  {value}
                </p>
              ) : (
                <p className="text-xs text-white/30 italic">
                  Skipped — you can come back to this.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-4 text-xs text-amber-400">{error}</p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onEdit(0)}
          disabled={submitting || saving}
          className="text-sm text-white/50 hover:text-white/80 disabled:opacity-30"
        >
          ← Start over
        </button>
        <button
          type="button"
          onClick={handleFinish}
          disabled={submitting || saving}
          className="rounded-lg bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/40 px-5 py-2 text-sm font-medium text-white"
        >
          {submitting ? "Saving…" : "Continue to assumptions"}
        </button>
      </div>
    </div>
  );
}

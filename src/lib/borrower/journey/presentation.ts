import type {
  GuidedQuestion,
  GuidedSnapshot,
} from "../guidedPackage/questions";
import { choiceLabel, DISCOVERY_ORDER } from "./discovery";
export const CHAPTERS = [
  {
    id: "plan",
    title: "Shape your idea",
    subtitle: "Start with what you want to accomplish.",
    reward: "Your project outline",
    help: "You don’t need to know a loan program. Tell us about your goal; we’ll explain paths worth exploring.",
  },
  {
    id: "business",
    title: "Tell your story",
    subtitle: "The people and story behind your business.",
    reward: "Your business profile",
    help: "These details help the lender understand who owns and operates the business. Owner questions appear when owners are added.",
  },
  {
    id: "numbers",
    title: "Build your budget",
    subtitle: "Let’s organize your financial picture.",
    reward: "Your financial picture",
    help: "Upload what you have. A saved upload is separate from a reviewed financial fact. You can come back with more documents.",
  },
  {
    id: "application",
    title: "Prepare your package",
    subtitle: "Bring your answers and documents together.",
    reward: "Your lender-ready draft",
    help: "Your reviewed assumptions feed the existing financial model. Preparing documents does not submit an application or approve a loan.",
  },
  {
    id: "review",
    title: "Make it ready",
    subtitle: "Check the details before you move forward.",
    reward: "Your review checklist",
    help: "Review your information, signatures and sharing choices. Your lender decides credit approval and any closing requirements.",
  },
] as const;
export type Chapter = (typeof CHAPTERS)[number]["id"];

export function chapterProgress(snapshot: GuidedSnapshot, chapter: Chapter) {
  const questions = recommendedQuestions(snapshot, chapter);
  const saved = questions.filter((q) => q.state === "saved").length;
  return {
    saved,
    total: questions.length,
    complete: questions.length > 0 && saved === questions.length,
  };
}

export function projectCard(snapshot: GuidedSnapshot) {
  const value = (id: string) =>
    snapshot.questions.find((q) => q.id === id)?.value;
  const text = (id: string) => {
    const found = value(id);
    return found === null || found === undefined || found === ""
      ? null
      : String(found);
  };
  const business = text("business.dba") ?? text("business.legal_name");
  const city = text("business.address_city");
  const state = text("business.address_state");
  const amount = value("loan.amount_requested");
  const numericAmount =
    typeof amount === "number" ? amount : Number(String(amount ?? ""));
  return {
    business,
    goal: value("A11") ? choiceLabel("A11", value("A11")) : null,
    location: [city, state].filter(Boolean).join(", ") || null,
    timeline: text("A07"),
    projectCost: text("A04"),
    fundsNeeded:
      Number.isFinite(numericAmount) && String(amount ?? "") !== ""
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(numericAmount)
        : null,
  };
}
export function chapterFor(q: GuidedQuestion): Chapter {
  if (q.id === "loan.sba_program") return "application";
  const s = q.section.trim();
  if (
    /request|Acquisition|Real estate|Franchise/.test(s) ||
    ["loan.amount_requested", "loan.use_of_proceeds"].includes(q.id)
  )
    return "plan";
  if (/Business|Owners/.test(s)) return "business";
  if (/financial|finances|debts|Equity|Projections|Supporting evidence/.test(s))
    return "numbers";
  if (/disclosures|Final|Signatures|Review, consent/.test(s)) return "review";
  return "application";
}
export function orderedQuestions(snapshot: GuidedSnapshot, chapter: Chapter) {
  const replaced: Record<string, string[]> = {
    A03: ["loan.amount_requested"],
    A05: ["loan.use_of_proceeds"],
    B01: ["business.legal_name", "business.dba"],
    B03: ["business.ein"],
    B04: [
      "business.address_street",
      "business.address_city",
      "business.address_state",
      "business.address_zip",
    ],
    B11: ["business.employee_count"],
  };
  return snapshot.questions
    .filter(
      (q) =>
        (!replaced[q.id] ||
          q.state === "saved" ||
          !replaced[q.id].every((id) =>
            snapshot.questions.some((field) => field.id === id),
          )) &&
        chapterFor(q) === chapter &&
        q.responsibility === "borrower" &&
        q.state !== "not_applicable",
    )
    .sort((a, b) => {
      const rank = (id: string) => {
        const i = DISCOVERY_ORDER.indexOf(id);
        return i < 0 ? 100 : i;
      };
      return rank(a.id) - rank(b.id);
    });
}
export function nextQuestion(questions: GuidedQuestion[], selectedId?: string) {
  return (
    questions.find((q) => q.id === selectedId) ??
    questions.find((q) => q.state !== "saved") ??
    questions[0]
  );
}
export function questionHelp(q: GuidedQuestion) {
  if (q.field?.requiresPiiVault)
    return "Use this protected field for the identifying number. Do not put it in chat or an ordinary answer.";
  if (q.id === "loan.sba_program")
    return "You can leave this for now. The options in Your plan explain possible paths; choosing a program here changes the forms in your application and does not establish eligibility.";
  if (q.id === "loan.amount_requested")
    return "Enter your current requested amount in USD. If you are unsure, choose Return later; you can organize the project budget first.";
  if (q.ownerName)
    return `This answer belongs to ${q.ownerName}. Check the person before saving.`;
  return CHAPTERS.find((c) => c.id === chapterFor(q))!.help;
}

/** Only defer optional topic prompts on explicit answers; never hide required form questions. */
export function recommendedQuestions(
  snapshot: GuidedSnapshot,
  chapter: Chapter,
) {
  const value = (id: string) =>
    snapshot.questions.find((q) => q.id === id)?.value;
  const goal = value("A11");
  return orderedQuestions(snapshot, chapter).filter((q) => {
    if (q.required || q.state === "saved") return true;
    if (
      /^I\d{2}$/.test(q.id) &&
      goal &&
      !["acquisition", "mixed"].includes(String(goal))
    )
      return false;
    if (
      /^J\d{2}$/.test(q.id) &&
      goal &&
      !["property", "equipment", "mixed", "acquisition", "refinance"].includes(
        String(goal),
      )
    )
      return false;
    if (/^K\d{2}$/.test(q.id) && value("business.is_franchise") === false)
      return false;
    return true;
  });
}

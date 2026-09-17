import type {
  GuidedQuestion,
  GuidedSnapshot,
} from "../guidedPackage/questions";
import { DISCOVERY_ORDER } from "./discovery";
export const CHAPTERS = [
  {
    id: "plan",
    title: "Your plan",
    subtitle: "Start with what you want to accomplish.",
    help: "You don’t need to know a loan program. Tell us about your goal; we’ll explain paths worth exploring.",
  },
  {
    id: "business",
    title: "Your business",
    subtitle: "The people and story behind your business.",
    help: "These details help the lender understand who owns and operates the business. Owner questions appear when owners are added.",
  },
  {
    id: "numbers",
    title: "Your numbers",
    subtitle: "Let’s organize your financial picture.",
    help: "Upload what you have. A saved upload is separate from a reviewed financial fact. You can come back with more documents.",
  },
  {
    id: "application",
    title: "Your application",
    subtitle: "Bring your answers and documents together.",
    help: "Your reviewed assumptions feed the existing financial model. Preparing documents does not submit an application or approve a loan.",
  },
  {
    id: "review",
    title: "Review & next steps",
    subtitle: "Check the details before you move forward.",
    help: "Review your information, signatures and sharing choices. Your lender decides credit approval and any closing requirements.",
  },
] as const;
export type Chapter = (typeof CHAPTERS)[number]["id"];
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

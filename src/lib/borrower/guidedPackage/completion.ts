import { packageRecoveryItems } from "./packageRecovery";
import type { GuidedSnapshot } from "./questions";

export type PackageCompletionItem = { id: string; label: string; questionId?: string };

/** Shared by the status UI, POST admission and durable workflow. Never infer consent. */
export function packageCompletionItems(snapshot: Pick<GuidedSnapshot, "questions" | "form722" | "form159">): PackageCompletionItem[] {
  const items = snapshot.questions
    .filter(q => q.responsibility === "borrower" && q.required && !["saved", "not_applicable"].includes(q.state))
    .map(q => ({ id: q.id, questionId: q.id, label: `${q.ownerName ? q.ownerName + ": " : ""}${q.question}` }));
  if (!snapshot.form722?.posterAvailable || !snapshot.form722?.acknowledged) items.push({
    id: "form722", questionId: "", label: snapshot.form722?.posterAvailable
      ? "Review the SBA equal opportunity poster below and acknowledge receipt."
      : "The SBA equal opportunity poster is unavailable. Buddy must restore it before preparation can continue.",
  });
  if (snapshot.questions.some(q => q.id === "loan.agent_used" && q.value === true) && snapshot.form159?.complete !== true) items.push({
    id: "form159", questionId: "", label: "The agent’s fee disclosure needs recorded fees and agent contact details before Buddy can prepare Form 159. Contact Buddy support if those details are missing; do not change your agent answer to skip this form.",
  });
  return items;
}

/** Only allowlisted explanations leave the server; raw renderer errors may contain private data. */
export function borrowerPackageFailure(error: unknown): string {
  const text = typeof error === "string" ? error : "";
  if (/budget exceeded|budget_unavailable|run_allowance_exceeded/i.test(text))
    return "Package preparation is paused because processing capacity is unavailable. Your answers and documents are saved. Please wait for capacity to reset; retrying immediately will not help.";
  const recovery = packageRecoveryItems(text);
  if (recovery.length) return "Package checks found items to resolve. Review the guidance below before preparing again.";
  const items: string[] = [];
  if (text.includes("SBA_1919") && text.includes("position")) items.push("Add each owner’s title or role in Tell your story.");
  if (text.includes("SBA_159")) items.push(text.includes("agent_used")
    ? "Answer the agent or packager question in Prepare your package."
    : "The agent’s fee disclosure is incomplete. Buddy needs the recorded fees and agent details before Form 159 can be prepared.");
  if (text.includes("SBA_722")) items.push("Review the equal opportunity poster in Prepare your package and acknowledge receipt.");
  if (items.length) return items.join("\n");
  if (text.includes("sba_form_dispatch_failed")) return "An application form is incomplete. Review the required answers and form checklist before retrying. If no missing items appear, contact Buddy support so the form requirements can be corrected.";
  return "Package preparation could not finish. Retry once; if it fails again, contact Buddy support.";
}

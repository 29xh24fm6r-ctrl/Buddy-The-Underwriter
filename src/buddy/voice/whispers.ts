type Role = "borrower" | "banker" | "builder";

type LastAction = null | {
  ts: number;
  testid?: string;
  action?: string;
  text?: string;
  path?: string;
};

const GENERIC: Record<Role, string[]> = {
  borrower: ["Got it.", "Perfect — I see it.", "Okay, I’ve got that.", "Thanks — checking it now."],
  banker: ["Got it.", "Okay.", "Tracking."],
  builder: ["ok", "tracking"],
};

const UPLOAD: Record<Role, string[]> = {
  borrower: [
    "Nice — I see the upload.",
    "Got it — I’m checking that file now.",
    "Perfect. Give me one second to verify it.",
  ],
  banker: ["Upload received.", "Got it — verifying.", "Tracking the upload now."],
  builder: ["upload seen", "verifying upload"],
};

const NAV: Record<Role, string[]> = {
  borrower: ["Yep — I’m on that page now.", "Okay, I’m here with you.", "Got it — I’m following along."],
  banker: ["On it.", "Yep — I’m on that screen.", "Tracking this step."],
  builder: ["nav ok", "route change"],
};

const UNDERWRITE: Record<Role, string[]> = {
  borrower: ["Okay — I’m lining everything up.", "Got it — I’m checking what’s needed next."],
  banker: ["Underwriting flow started.", "Got it — watching for blockers."],
  builder: ["underwrite start", "watching signals"],
};

function pick(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function classify(lastAction: LastAction): "upload" | "nav" | "underwrite" | "generic" {
  if (!lastAction) return "generic";
  const t = `${lastAction.action ?? ""} ${lastAction.testid ?? ""} ${lastAction.text ?? ""}`.toLowerCase();

  if (
    t.includes("upload") ||
    t.includes("file") ||
    t.includes("drop") ||
    t.includes("attach") ||
    t.includes("commit") ||
    t.includes("portal")
  )
    return "upload";

  if (t.includes("underwrite") || t.includes("start_underwriting") || t.includes("start-underwriting")) {
    return "underwrite";
  }

  if (t.includes("nav") || t.includes("menu") || t.includes("dashboard") || t.includes("back") || t.includes("next")) {
    return "nav";
  }

  return "generic";
}

export function pickContextualWhisper(role: Role, lastAction: LastAction) {
  const kind = classify(lastAction);
  if (kind === "upload") return pick(UPLOAD[role]);
  if (kind === "nav") return pick(NAV[role]);
  if (kind === "underwrite") return pick(UNDERWRITE[role]);
  return pick(GENERIC[role]);
}

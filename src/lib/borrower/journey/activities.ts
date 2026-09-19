import type { GuidedQuestion } from "../guidedPackage/questions";

type Choice = readonly [value: string, label: string];

const ACTIVITY_CHOICES: Record<string, readonly Choice[]> = {
  K02: [
    ["New franchise location", "Open a new location"],
    ["Purchase of an operating franchise location", "Buy an operating location"],
    ["Expansion of an existing franchise business", "Expand my franchise business"],
    ["Franchise transaction not yet decided", "Still exploring"],
  ],
  A02: [
    ["Starting a business", "Start a business"],
    ["Buying an existing business", "Buy a business"],
    ["Expanding an existing business", "Expand my business"],
    ["Buying or improving property", "Buy or improve property"],
    ["Buying equipment", "Buy equipment"],
    ["Refinancing business debt", "Refinance debt"],
    ["Combining several purposes", "A combination"],
  ],
  A07: [
    ["Within 3 months", "Within 3 months"],
    ["Within 3 to 6 months", "3–6 months"],
    ["Within 6 to 12 months", "6–12 months"],
    ["More than 12 months from now", "More than a year"],
    ["Still exploring the timeline", "Still exploring"],
  ],
  B07: [
    ["The business is already operating", "Already operating"],
    ["The business is preparing to open", "Preparing to open"],
    ["The business is being acquired", "Buying an existing business"],
    ["The timing is still being explored", "Still exploring"],
  ],
  L01: [
    ["Within 3 months", "Within 3 months"],
    ["Within 3 to 6 months", "3–6 months"],
    ["Within 6 to 12 months", "6–12 months"],
    ["More than 12 months from now", "More than a year"],
    ["Still exploring the timeline", "Still exploring"],
  ],
};

const FRIENDLY_QUESTIONS: Record<string, { title: string; hint: string }> = {
  K01: {
    title: "Which franchise and proposed location are you working with?",
    hint: "Share the brand and the city or site, if known. We’ll keep your company’s legal name separate.",
  },
  K02: {
    title: "What does buying this franchise mean for your project?",
    hint: "A new location and an existing operating business need different follow-ups. Choose what fits.",
  },
  A01: {
    title: "What are we helping you make happen?",
    hint: "Tell Buddy the outcome in your own words. A sentence or two is enough.",
  },
  A02: {
    title: "What kind of project is this?",
    hint: "Choose the closest answer. We’ll ask only the follow-ups that fit.",
  },
  A07: {
    title: "When would you like this project to happen?",
    hint: "A rough target is perfect. You can add a firm deadline or explain it in your own words.",
  },
  B07: {
    title: "Where is the business in its journey?",
    hint: "Choose the closest stage. You can clarify the timing afterward.",
  },
  L01: {
    title: "When do you expect to fund, open, or complete the purchase?",
    hint: "A rough target is fine. Buddy will use it to shape the opening plan and projections.",
  },
};

export function activityChoices(q: GuidedQuestion): readonly Choice[] | null {
  return ACTIVITY_CHOICES[q.id] ?? null;
}

export function activityCopy(q: GuidedQuestion) {
  return (
    FRIENDLY_QUESTIONS[q.id] ?? {
      title: q.question,
      hint: q.reason?.startsWith("Package narrative")
        ? "A short answer is enough. Buddy will carry it into the right part of your package."
        : null,
    }
  );
}

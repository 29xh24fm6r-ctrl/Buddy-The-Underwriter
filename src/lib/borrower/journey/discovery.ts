/** Presentation choices, not eligibility rules. Stored by the existing answer transaction. */
export const DISCOVERY_CHOICES: Record<
  string,
  readonly (readonly [string, string])[]
> = {
  A11: [
    ["acquisition", "Buy a business"],
    ["property", "Buy or improve property"],
    ["equipment", "Buy equipment"],
    ["growth", "Grow my business"],
    ["working_capital", "Manage cash flow"],
    ["refinance", "Refinance business debt"],
    ["startup", "Start a business"],
    ["mixed", "A combination / help me decide"],
  ],
  A12: [
    ["operating", "Already operating"],
    ["startup", "Getting ready to open"],
    ["acquiring", "Buying an existing business"],
    ["unsure", "Still exploring"],
  ],
  A13: [
    ["cash", "Keep more cash available"],
    ["payment", "Manage monthly payments"],
    ["predictability", "Predictable terms"],
    ["flexibility", "Flexible access to funds"],
    ["timing", "Meet a deadline"],
    ["unsure", "Help me compare"],
  ],
  A14: [
    ["business", "My business will use it"],
    ["rental", "Primarily renting it to others"],
    ["mixed", "My business and other tenants"],
    ["none", "No property involved"],
    ["unsure", "Not sure yet"],
  ],
  A15: [
    ["general", "None of these"],
    ["manufacturing", "Manufacturing"],
    ["export", "Exporting / international orders"],
    ["seasonal", "Seasonal inventory or contracts"],
    ["disaster", "Disaster recovery"],
    ["grant", "Looking for a grant"],
    ["unsure", "Not sure"],
  ],
};
export const DISCOVERY_QUESTIONS = [
  {
    id: "A11",
    section: " Your request and project",
    question: "What’s next for your business?",
  },
  {
    id: "A12",
    section: " Your request and project",
    question: "Where are you in your business journey?",
  },
  {
    id: "A13",
    section: " Your request and project",
    question: "What matters most to you in your financing?",
  },
  {
    id: "A14",
    section: " Your request and project",
    question: "If property is involved, who will use it?",
  },
  {
    id: "A15",
    section: " Your request and project",
    question: "Does your project involve any of these needs?",
  },
];
export const DISCOVERY_ORDER = [
  "A11",
  "A01",
  "A12",
  "loan.amount_requested",
  "A07",
  "A13",
  "A14",
  "A15",
];
export function choiceLabel(id: string, value: unknown): string {
  return (
    DISCOVERY_CHOICES[id]?.find(([key]) => key === value)?.[1] ??
    String(value ?? "Not answered yet")
  );
}

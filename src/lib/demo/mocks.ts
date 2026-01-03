import type { DemoState } from "./demoMode";

/**
 * Demo Mode Mocks
 * 
 * Generates realistic mock data for demo scenarios
 */

export type MockChecklistResponse = {
  ok: boolean;
  state?: "empty" | "building" | "ready";
  items?: Array<{
    id: string;
    checklist_key: string;
    status: "satisfied" | "missing" | "pending";
    required: boolean;
    title: string;
  }>;
  error?: string;
};

export function mockChecklistData(state: DemoState): MockChecklistResponse {
  if (state === "empty") {
    return {
      ok: true,
      state: "empty",
      items: [],
    };
  }

  if (state === "blocked") {
    return {
      ok: false,
      error: "Borrower consent required before proceeding",
    };
  }

  const items = [
    {
      id: "1",
      checklist_key: "bus_tax_return_2023",
      status: "satisfied",
      required: true,
      title: "Business Tax Return (2023)",
    },
    {
      id: "2",
      checklist_key: "bus_tax_return_2022",
      status: "satisfied",
      required: true,
      title: "Business Tax Return (2022)",
    },
    {
      id: "3",
      checklist_key: "pfs",
      status: state === "ready" ? "satisfied" : "missing",
      required: true,
      title: "Personal Financial Statement",
    },
    {
      id: "4",
      checklist_key: "operating_agreement",
      status: state === "ready" ? "satisfied" : "pending",
      required: false,
      title: "Operating Agreement",
    },
  ] as const;

  return {
    ok: true,
    state: state === "ready" ? "ready" : "building",
    items: items as any,
  };
}

export type MockTimelineResponse = {
  ok: boolean;
  events: Array<{
    id: string;
    ts: string;
    kind: string;
    title: string;
    detail?: string;
  }>;
};

export function mockTimelineData(state: DemoState): MockTimelineResponse {
  const now = new Date();
  const ago = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000).toISOString();

  const events = [
    {
      id: "1",
      ts: ago(5),
      kind: "checklist",
      title: "Checklist updated (2 items)",
      detail: state === "ready" ? "All items satisfied" : "Remaining uploads: 2",
    },
    {
      id: "2",
      ts: ago(15),
      kind: "upload",
      title: "2 documents uploaded",
    },
    {
      id: "3",
      ts: ago(30),
      kind: "auto_seed",
      title: "Checklist auto-seeded",
      detail: "4 checklist items created",
    },
    {
      id: "4",
      ts: ago(45),
      kind: "upload",
      title: "1 document uploaded",
    },
  ];

  return {
    ok: true,
    events,
  };
}

export type MockStatusResponse = {
  ok: boolean;
  stage: "reviewing" | "needs_more" | "complete" | "blocked";
  message: string;
  detail?: string;
  nextBestUpload?: {
    title: string;
    why: string;
    required: boolean;
  };
  lastActivity?: string;
};

export function mockBorrowerStatus(state: DemoState): MockStatusResponse {
  const now = new Date();
  const ago = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000).toISOString();

  if (state === "blocked") {
    return {
      ok: true,
      stage: "blocked",
      message: "Action required",
      detail: "Please review and sign the borrower consent form.",
      lastActivity: ago(120),
    };
  }

  if (state === "ready") {
    return {
      ok: true,
      stage: "complete",
      message: "All set — we have what we need",
      detail: "I'll keep you updated as we move forward.",
      lastActivity: ago(10),
    };
  }

  if (state === "converging") {
    return {
      ok: true,
      stage: "needs_more",
      message: "Almost done — 2 items left",
      detail: "Upload what you have — I'll tell you what's next.",
      nextBestUpload: {
        title: "Personal Financial Statement",
        why: "This shows your personal assets and liabilities.",
        required: true,
      },
      lastActivity: ago(15),
    };
  }

  // empty state
  return {
    ok: true,
    stage: "reviewing",
    message: "I'm reviewing your uploads",
    detail: "Building your checklist and organizing everything automatically.",
    lastActivity: ago(5),
  };
}

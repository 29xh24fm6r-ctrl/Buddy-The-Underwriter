export const PIPELINE_COPY = {
  working: {
    short: "Working…",
    long: "Buddy is actively working on this deal",
  },
  waiting: {
    short: "Waiting",
    long: "Waiting for required information",
  },
  done: {
    short: "Up to date",
    long: "Everything is up to date",
  },
} as const;

export type PipelineUiState = keyof typeof PIPELINE_COPY;

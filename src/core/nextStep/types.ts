export type NextAction =
  | { key: "complete_intake"; missing: string[]; deepLink: string }
  | {
      key: "request_docs";
      missingDocCodes: string[];
      deepLink: string;
      templateId?: string;
    }
  | { key: "run_pricing"; deepLink: string }
  | { key: "open_underwriting"; deepLink: string };

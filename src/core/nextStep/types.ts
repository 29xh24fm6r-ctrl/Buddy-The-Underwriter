export type NextAction =
  | { key: "complete_intake"; missing: string[]; deepLink: string }
  | {
      key: "request_docs";
      missingDocCodes: string[];
      deepLink: string;
      templateId?: string;
    }
  | { key: "set_pricing_assumptions"; deepLink: string }
  | { key: "open_underwriting"; deepLink: string };

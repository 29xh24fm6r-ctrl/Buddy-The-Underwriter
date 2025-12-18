export function buildSubmissionPackage(input: {
  filledForms: any;
  narrative: any;
  attachments: any[];
  metadata: {
    application_id: string;
    business_name: string;
    loan_amount: number;
  };
}) {
  const narrativeText = Object.entries(input.narrative)
    .map(([key, value]) => {
      const title = key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      return `\n\n=== ${title} ===\n\n${value}`;
    })
    .join("\n");

  const manifest = {
    generated_at: new Date().toISOString(),
    system: "Buddy SBA Underwriting Engine",
    version: "1.0.0",
    application_id: input.metadata.application_id,
    business_name: input.metadata.business_name,
    loan_amount: input.metadata.loan_amount,
    files: {
      forms: Object.keys(input.filledForms ?? {}),
      attachments: input.attachments.length,
      narrative: "Credit_Memo.txt",
    },
  };

  return {
    files: [
      {
        name: "Credit_Memo.txt",
        content: narrativeText,
        type: "NARRATIVE",
      },
      {
        name: "Package_Manifest.json",
        content: JSON.stringify(manifest, null, 2),
        type: "MANIFEST",
      },
      ...input.attachments.map((a: any) => ({
        name: a.stored_name ?? a.file_key,
        file_key: a.file_key,
        type: "ATTACHMENT",
      })),
    ],
    manifest,
    summary: {
      total_files: 2 + input.attachments.length,
      ready_for_submission: true,
    },
  };
}

import "server-only";

export type ScreenArtifactContent = {
  header: {
    title: string;
    subtitle: string;
  };
  sections: Array<{
    type: "cards" | "table" | "form" | "text" | "list";
    title: string;
    items?: Array<{
      label: string;
      value: string;
      status?: "neutral" | "good" | "warn" | "bad";
    }>;
    actions?: Array<{
      label: string;
      action: string;
    }>;
  }>;
};

export function generateScreenFromPrompt(args: {
  prompt: string;
  role?: string | null;
}): {
  title: string;
  layoutType: string;
  content: ScreenArtifactContent;
} {
  const promptLower = args.prompt.toLowerCase();
  const role = args.role || null;

  // Template selection rules (deterministic, no AI)
  if (
    promptLower.includes("upload") ||
    promptLower.includes("document") ||
    promptLower.includes("missing")
  ) {
    return borrowerChecklistTemplate(args.prompt, role);
  }

  if (
    promptLower.includes("review") ||
    promptLower.includes("underwrite") ||
    promptLower.includes("condition")
  ) {
    return underwriterDashboardTemplate(args.prompt, role);
  }

  if (role === "Banker") {
    return bankerDashboardTemplate(args.prompt, role);
  }

  // Default dashboard template
  return defaultDashboardTemplate(args.prompt, role);
}

function borrowerChecklistTemplate(
  prompt: string,
  role: string | null
): ReturnType<typeof generateScreenFromPrompt> {
  return {
    title: "Document Upload Checklist",
    layoutType: "dashboard",
    content: {
      header: {
        title: "Document Upload Checklist",
        subtitle: "Upload the following documents to complete your application",
      },
      sections: [
        {
          type: "list",
          title: "Required Documents",
          items: [
            { label: "Personal Tax Returns (2 years)", value: "Pending", status: "warn" },
            { label: "Business Tax Returns (2 years)", value: "Pending", status: "warn" },
            { label: "Bank Statements (3 months)", value: "Pending", status: "warn" },
            { label: "Profit & Loss Statement", value: "Pending", status: "warn" },
            { label: "Balance Sheet", value: "Pending", status: "warn" },
          ],
          actions: [
            { label: "Upload Documents", action: "upload" },
            { label: "Save Progress", action: "save" },
          ],
        },
        {
          type: "text",
          title: "Next Steps",
          items: [
            {
              label: "Instructions",
              value:
                "Please upload all required documents. Once uploaded, our underwriting team will review them within 2-3 business days.",
              status: "neutral",
            },
          ],
        },
      ],
    },
  };
}

function underwriterDashboardTemplate(
  prompt: string,
  role: string | null
): ReturnType<typeof generateScreenFromPrompt> {
  return {
    title: "Underwriting Dashboard",
    layoutType: "dashboard",
    content: {
      header: {
        title: "Underwriting Dashboard",
        subtitle: "Active deals requiring attention",
      },
      sections: [
        {
          type: "cards",
          title: "Pipeline Summary",
          items: [
            { label: "Active Deals", value: "12", status: "good" },
            { label: "Needs Review", value: "4", status: "warn" },
            { label: "Approved Today", value: "2", status: "good" },
            { label: "Pending Conditions", value: "6", status: "neutral" },
          ],
        },
        {
          type: "table",
          title: "Deals Requiring Action",
          items: [
            { label: "ABC Corp", value: "Missing tax returns", status: "warn" },
            { label: "XYZ LLC", value: "Ready for approval", status: "good" },
            { label: "Acme Inc", value: "Awaiting appraisal", status: "neutral" },
            { label: "Smith Enterprises", value: "Conditions satisfied", status: "good" },
          ],
          actions: [
            { label: "Review All", action: "review" },
            { label: "Export Report", action: "export" },
          ],
        },
      ],
    },
  };
}

function bankerDashboardTemplate(
  prompt: string,
  role: string | null
): ReturnType<typeof generateScreenFromPrompt> {
  return {
    title: "Banker Command Center",
    layoutType: "dashboard",
    content: {
      header: {
        title: "Banker Command Center",
        subtitle: "Your portfolio at a glance",
      },
      sections: [
        {
          type: "cards",
          title: "Portfolio Health",
          items: [
            { label: "Total Loans", value: "$2.4M", status: "good" },
            { label: "Active Deals", value: "8", status: "neutral" },
            { label: "This Month", value: "+3", status: "good" },
            { label: "Avg Close Time", value: "14 days", status: "good" },
          ],
        },
        {
          type: "list",
          title: "Recent Activity",
          items: [
            { label: "ABC Corp - Approved", value: "2 hours ago", status: "good" },
            { label: "XYZ LLC - Docs uploaded", value: "5 hours ago", status: "neutral" },
            { label: "Acme Inc - Started", value: "1 day ago", status: "neutral" },
          ],
          actions: [
            { label: "View All Deals", action: "deals" },
            { label: "New Application", action: "new" },
          ],
        },
      ],
    },
  };
}

function defaultDashboardTemplate(
  prompt: string,
  role: string | null
): ReturnType<typeof generateScreenFromPrompt> {
  return {
    title: "Dashboard",
    layoutType: "dashboard",
    content: {
      header: {
        title: "Welcome to Buddy Underwriter",
        subtitle: "Your AI-powered credit intelligence platform",
      },
      sections: [
        {
          type: "cards",
          title: "Overview",
          items: [
            { label: "Status", value: "Active", status: "good" },
            { label: "Generated", value: "Just now", status: "neutral" },
            { label: "Type", value: "Dashboard", status: "neutral" },
          ],
        },
        {
          type: "text",
          title: "Getting Started",
          items: [
            {
              label: "Info",
              value:
                "This is a generated screen based on your prompt. Use the 'Continue' button to iterate or 'Save' to claim this screen.",
              status: "neutral",
            },
          ],
          actions: [
            { label: "Continue", action: "continue" },
            { label: "Save", action: "save" },
          ],
        },
      ],
    },
  };
}

// src/lib/voice/feasibilityVoiceSchema.ts
// Phase God Tier Feasibility — Voice Schema (step 14/16).
// Drives the voice-guided feasibility discovery flow. Unlike the SBA
// assumption interview, Buddy LEADS here with what it already knows
// and asks the borrower to CONFIRM. Each step declares whether Buddy
// opens with a finding or asks the borrower first.

export interface FeasibilityVoiceStep {
  id: string;
  buddyLeads: boolean;
  prompt: string;
  extractionFields: string[];
}

export interface FeasibilityVoiceSchema {
  preamble: string;
  steps: FeasibilityVoiceStep[];
  conclusion: string;
}

export const FEASIBILITY_VOICE_SCHEMA: FeasibilityVoiceSchema = {
  preamble:
    "I've already done significant research on your business concept and your market. Let me walk you through what I've found, and you can confirm or correct anything along the way.",
  steps: [
    {
      id: "concept_confirm",
      buddyLeads: true,
      prompt:
        "Based on what I know, you're looking to [open/expand] a [business type] in [city, state]. Is that correct?",
      extractionFields: ["confirmed_concept", "corrections"],
    },
    {
      id: "location_detail",
      buddyLeads: true,
      prompt:
        "Have you identified a specific location or property yet? If so, tell me about it — address, square footage, lease terms if you know them.",
      extractionFields: [
        "property.hasIdentifiedLocation",
        "property.squareFootage",
        "property.monthlyRent",
      ],
    },
    {
      id: "experience",
      buddyLeads: false,
      prompt:
        "Tell me about your background. How many years have you been in this industry, and what roles have you held?",
      extractionFields: [
        "managementTeam[0].yearsInIndustry",
        "managementTeam[0].bio",
      ],
    },
    {
      id: "capital",
      buddyLeads: false,
      prompt:
        "How much personal capital are you prepared to invest in this venture?",
      extractionFields: ["equityAvailable"],
    },
    {
      id: "research_walkthrough",
      buddyLeads: true,
      prompt:
        "Let me share what I've found about your market. [Buddy presents key findings from BIE research — competitive landscape, demographics, industry outlook]. Does any of this surprise you or differ from what you've observed?",
      extractionFields: ["borrower_market_corrections"],
    },
  ],
  conclusion:
    "Based on everything we've discussed and the research I've conducted, I'm going to run a comprehensive feasibility analysis. This will score your venture across four dimensions — market demand, financial viability, operational readiness, and location suitability — and give you a clear recommendation. Let me generate that now.",
};

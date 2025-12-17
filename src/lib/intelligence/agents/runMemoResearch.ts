export type ResearchResult = {
  company?: string;
  industry?: string;
  owner?: string;
  sources?: { title: string; url?: string }[];
};

export async function runMemoResearch(entityName: string): Promise<ResearchResult> {
  // Placeholder for LLM + search
  return {
    company: "Company research pending.",
    industry: "Industry overview pending.",
    owner: "Owner background pending.",
    sources: [],
  };
}
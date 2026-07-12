import "server-only";
import { z } from "zod";

/**
 * SPEC S4 C-2 — SAM.gov exclusions check (System for Award Management).
 * Public API: https://api.sam.gov/entity-information/v3/exclusions
 *
 * Documented assumption (no network access to sam.gov from this
 * environment to confirm the exact response envelope — proxy policy
 * blocks it, same as sba.gov/irs.gov in earlier phases): the response
 * schema below is kept intentionally permissive (only `totalRecords` and
 * an `exclusionDetails` array with a handful of fields we actually use are
 * required) so a real-world response with additional/renamed fields still
 * parses. Whoever wires this up against a live key should tighten the
 * schema against the confirmed response shape.
 */

const SAM_GOV_BASE_URL = "https://api.sam.gov/entity-information/v3/exclusions";

const SamExclusionRecordSchema = z
  .object({
    classificationCode: z.string().optional(),
    exclusionProgram: z.string().optional(),
    excludingAgencyName: z.string().optional(),
    activeDate: z.string().optional(),
    terminationDate: z.string().optional(),
    samNumber: z.string().optional(),
  })
  .passthrough();

const SamExclusionsResponseSchema = z
  .object({
    totalRecords: z.number().optional(),
    exclusionDetails: z.array(SamExclusionRecordSchema).optional(),
  })
  .passthrough();

export type SamExclusionRecord = z.infer<typeof SamExclusionRecordSchema>;

export async function fetchSamExclusions(args: { name: string; ein?: string | null }): Promise<SamExclusionRecord[]> {
  const params = new URLSearchParams({ q: args.name });
  if (args.ein) params.set("ein", args.ein);
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (apiKey) params.set("api_key", apiKey);

  const res = await fetch(`${SAM_GOV_BASE_URL}?${params.toString()}`, { method: "GET" });

  if (res.status === 429) {
    throw new Error("SAM.gov API rate-limited (429). Retry later or configure SAM_GOV_API_KEY for a higher quota.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SAM.gov exclusions API failed: ${res.status} ${res.statusText} — ${body}`);
  }

  const parsed = SamExclusionsResponseSchema.parse(await res.json());
  return parsed.exclusionDetails ?? [];
}

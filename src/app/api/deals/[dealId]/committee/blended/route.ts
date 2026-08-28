import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import {
  retrieveBankPolicyChunks,
  blendEvidence,
} from "@/lib/retrieval/policy";
import { getOpenAI, getModel } from "@/lib/ai/openaiClient";
import { insertAiEvent, insertAiCitations } from "@/lib/ai/trace";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { assertGroundedCommitteeCitations } from "@/lib/committee/grounding";

type Params = Promise<{ dealId: string }>;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_QUESTION_LENGTH = 4_000;

const BlendedAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(20_000),
  citations: z
    .array(
      z.object({
        source_kind: z.enum(["deal_doc_chunk", "bank_policy_chunk"]),
        chunk_id: z.string().trim().min(1),
        quote: z.string().trim().min(10).max(500),
      }),
    )
    .min(1)
    .max(18),
});

export async function POST(req: NextRequest, context: { params: Params }) {
  try {
    const { dealId } = await context.params;
    const access = await requireDealAccess(dealId);
    const body = await req.json().catch(() => ({}));
    const question = String(body?.question || "").trim();
    const requestedBankId = String(body?.bank_id || "").trim();

    if (!question || question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: "invalid_question" },
        { status: 400, headers: NO_STORE },
      );
    }

    // Policy scope is authoritative from the authenticated deal. A caller may
    // not choose another bank's policy corpus by changing request JSON.
    if (requestedBankId && requestedBankId !== access.bankId) {
      return NextResponse.json(
        { ok: false, error: "bank_scope_mismatch" },
        { status: 403, headers: NO_STORE },
      );
    }
    const bankId = access.bankId;

    const [deal, policy] = await Promise.all([
      retrieveTopChunks({ dealId, question, k: 20 }),
      retrieveBankPolicyChunks({ bankId, question, k: 12 }),
    ]);

    const blended = blendEvidence({ deal, policy, maxDeal: 10, maxPolicy: 8 });
    if (blended.deal.length === 0 && blended.policy.length === 0) {
      return NextResponse.json(
        { ok: false, error: "committee_evidence_required" },
        { status: 409, headers: NO_STORE },
      );
    }

    const openai = getOpenAI();
    const model = getModel();

    const ctx = [
      "DEAL EVIDENCE CHUNKS:",
      ...blended.deal.map(
        (chunk, index) =>
          `DEAL ${index + 1}\nchunk_id: ${chunk.chunk_id}\ntext: ${chunk.content
            .replace(/\s+/g, " ")
            .trim()}\n`,
      ),
      "",
      "BANK POLICY CHUNKS:",
      ...blended.policy.map(
        (chunk, index) =>
          `POLICY ${index + 1}\nchunk_id: ${chunk.chunk_id}\nlabel: ${chunk.source_label}\ntext: ${chunk.content
            .replace(/\s+/g, " ")
            .trim()}\n`,
      ),
    ].join("\n");

    const system = [
      "You are an underwriting committee assistant.",
      "Answer using ONLY the provided deal evidence and policy chunks.",
      "If policy conflicts with deal evidence, call it out explicitly.",
      "Every quote must be copied verbatim from its referenced chunk.",
      "Return ONLY JSON:",
      '{"answer":"...","citations":[{"source_kind":"deal_doc_chunk|bank_policy_chunk","chunk_id":"...","quote":"..."}]}',
    ].join("\n");

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Question: ${question}\n\n${ctx}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = response.choices[0]?.message?.content?.trim();
    const answer = BlendedAnswerSchema.parse(JSON.parse(raw || "{}"));

    assertGroundedCommitteeCitations(answer.citations, [
      ...blended.deal.map((chunk) => ({
        source_kind: "deal_doc_chunk" as const,
        chunk_id: chunk.chunk_id,
        content: chunk.content,
      })),
      ...blended.policy.map((chunk) => ({
        source_kind: "bank_policy_chunk" as const,
        chunk_id: chunk.chunk_id,
        content: chunk.content,
      })),
    ]);

    const aiEventId = await insertAiEvent({
      deal_id: dealId,
      bank_id: bankId,
      kind: "committee.blended",
      model,
      input: { dealId, bankId, question },
      output: answer,
      meta: { deal_k: deal.length, policy_k: policy.length },
    });

    const dealById = new Map(deal.map((row) => [row.chunk_id, row]));
    const policyById = new Map(policy.map((row) => [row.chunk_id, row]));

    await insertAiCitations(
      answer.citations.map((citation) => {
        if (citation.source_kind === "bank_policy_chunk") {
          return {
            ai_event_id: aiEventId,
            deal_id: dealId,
            bank_id: bankId,
            source_kind: "bank_policy_chunk" as const,
            chunk_id: citation.chunk_id,
            upload_id: null,
            excerpt: citation.quote,
            similarity:
              policyById.get(citation.chunk_id)?.similarity ?? null,
            page_start: null,
            page_end: null,
            document_id: null,
            page_number: null,
            bbox: null,
          };
        }

        const source = dealById.get(citation.chunk_id);
        return {
          ai_event_id: aiEventId,
          deal_id: dealId,
          bank_id: bankId,
          source_kind: "deal_doc_chunk" as const,
          chunk_id: citation.chunk_id,
          upload_id: source?.upload_id || null,
          excerpt: citation.quote,
          similarity: source?.similarity ?? null,
          page_start: source?.page_start ?? null,
          page_end: source?.page_end ?? null,
          document_id: null,
          page_number: null,
          bbox: null,
        };
      }),
    );

    return NextResponse.json(
      { ok: true, ...answer, ai_event_id: aiEventId },
      { headers: NO_STORE },
    );
  } catch (error: unknown) {
    rethrowNextErrors(error);
    console.error("[committee/blended POST]", error);
    return NextResponse.json(
      { ok: false, error: "committee_blended_unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}

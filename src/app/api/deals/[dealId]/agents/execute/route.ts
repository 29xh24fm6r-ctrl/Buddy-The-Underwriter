/**
 * API Route: Execute SBA Agent Swarm
 * 
 * POST /api/deals/[dealId]/agents/execute
 * 
 * Executes the full SBA underwriting agent pipeline for a deal.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { orchestrator } from '@/lib/agents';
import type { AgentName } from '@/lib/agents';

interface ExecuteAgentsRequest {
  agents?: AgentName[]; // Optional: specify which agents to run
  force_refresh?: boolean; // Force re-execution even if recent findings exist
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const bankId = await getCurrentBankId();
    
    if (!bankId) {
      return Response.json(
        { ok: false, error: 'Bank ID required' },
        { status: 400 }
      );
    }
    
    const body = (await req.json()) as ExecuteAgentsRequest;
    
    // Default: run full SBA pipeline
    const result = body.agents
      ? await orchestrator.executeAgents(body.agents, {
          deal_id: dealId,
          bank_id: bankId,
          force_refresh: body.force_refresh,
        })
      : await orchestrator.executeSBAUnderwritingPipeline({
          deal_id: dealId,
          bank_id: bankId,
          force_refresh: body.force_refresh,
        });
    
    return Response.json({
      ok: true,
      data: result,
    });
    
  } catch (error) {
    console.error('[Execute Agents] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

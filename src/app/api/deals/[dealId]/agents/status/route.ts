/**
 * API Route: Get Agent Status
 * 
 * GET /api/deals/[dealId]/agents/status
 * 
 * Returns the status of all agents for a deal.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { orchestrator } from '@/lib/agents';

export async function GET(
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
    
    const status = await orchestrator.getExecutionStatus(dealId);
    
    return Response.json({
      ok: true,
      data: status,
    });
    
  } catch (error) {
    console.error('[Agent Status] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

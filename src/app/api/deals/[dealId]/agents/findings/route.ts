/**
 * API Route: Get Agent Findings
 * 
 * GET /api/deals/[dealId]/agents/findings
 * 
 * Returns all findings from agents for a deal.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AgentName } from '@/lib/agents';

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
    
    const { searchParams } = new URL(req.url);
    const agentName = searchParams.get('agent') as AgentName | null;
    
    const sb = supabaseAdmin();
    
    let query = sb
      .from('agent_findings')
      .select('*')
      .eq('deal_id', dealId)
      .eq('bank_id', bankId)
      .order('created_at', { ascending: false });
    
    // Filter by agent if specified
    if (agentName) {
      query = query.eq('agent_name', agentName);
    }
    
    const { data: findings, error } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch findings: ${error.message}`);
    }
    
    return Response.json({
      ok: true,
      data: findings || [],
    });
    
  } catch (error) {
    console.error('[Agent Findings] Error:', error);
    
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 10;

const FALLBACK_COLUMNS =
  'id, brand_name, franchisor_legal_name, sba_eligible, sba_certification_status, sba_addendum_required, sba_programs, sba_notes, franchise_fee_min, franchise_fee_max, initial_investment_min, initial_investment_max, royalty_pct, net_worth_requirement, liquidity_requirement, has_item_19';

/**
 * GET /api/franchise/search?q=chick-fil-a&limit=10
 *
 * Fuzzy search franchise brands by name. Returns SBA eligibility, certification
 * status, investment range. Used by Buddy Voice for real-time franchise queries.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') || '10', 10),
    50
  );

  if (!q || q.trim().length < 2) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required (min 2 chars)' },
      { status: 400 }
    );
  }

  const sb = supabaseAdmin();
  const searchTerm = q.trim();

  const { data, error } = await sb.rpc('search_franchise_brands', {
    search_term: searchTerm,
    result_limit: limit,
  });

  if (!error && data) {
    return NextResponse.json({ brands: data, search_method: 'trigram' });
  }

  const { data: fallbackData, error: fallbackError } = await sb
    .from('franchise_brands')
    .select(FALLBACK_COLUMNS)
    .ilike('brand_name', `%${searchTerm}%`)
    .eq('canonical', true)
    .order('brand_name')
    .limit(limit);

  if (fallbackError) {
    return NextResponse.json({ error: fallbackError.message }, { status: 500 });
  }

  return NextResponse.json({ brands: fallbackData, search_method: 'ilike' });
}

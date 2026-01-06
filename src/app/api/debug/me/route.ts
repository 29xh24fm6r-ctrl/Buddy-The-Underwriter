import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug endpoint to show current user info and auto-provision bank membership
 */
export async function GET() {
  try {
    const { userId } = await clerkAuth();
    
    if (!userId) {
      return NextResponse.json({ 
        error: "Not authenticated",
        userId: null 
      });
    }

    const sb = supabaseAdmin();

    // Check existing memberships
    const { data: memberships } = await sb
      .from("bank_memberships")
      .select("bank_id, role")
      .eq("clerk_user_id", userId);

    // Check profile
    const { data: profile } = await sb
      .from("profiles")
      .select("bank_id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    // If no memberships, auto-provision
    let autoProvisioned = false;
    if (!memberships || memberships.length === 0) {
      // Ensure default bank exists
      const { data: bank } = await sb
        .from("banks")
        .upsert({
          id: 'bedf308d-b3f8-4e97-a900-202dd5e27035',
          code: 'OGB',
          name: 'Octagon Bank (Default)'
        }, { onConflict: 'code' })
        .select('id')
        .single();

      // Create membership
      await sb
        .from("bank_memberships")
        .insert({
          bank_id: 'bedf308d-b3f8-4e97-a900-202dd5e27035',
          clerk_user_id: userId,
          role: 'admin'
        });

      autoProvisioned = true;
    }

    return NextResponse.json({
      userId,
      memberships: memberships || [],
      profile: profile || null,
      autoProvisioned,
      message: autoProvisioned 
        ? "✅ Auto-provisioned bank membership! Refresh the app."
        : "Already has bank membership"
    });
  } catch (e: any) {
    return NextResponse.json({ 
      error: e.message 
    }, { status: 500 });
  }
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Usage limits
export const FREE_CONTINUES_LIMIT = 3; // Free users get 3 continues

/**
 * Check if user can continue (has not exceeded free limit)
 * Returns { allowed: boolean, usage: object }
 */
export async function checkContinueLimit(userId: string): Promise<{
  allowed: boolean;
  usage: {
    plan: string;
    continues_used: number;
    continues_remaining: number;
  };
}> {
  const sb = supabaseAdmin();

  // Get or create usage record
  let { data: usage, error } = await sb
    .from("user_usage")
    .select("plan, free_continues_used")
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = not found
    throw error;
  }

  // Create usage record if doesn't exist
  if (!usage) {
    const { data: newUsage, error: insertError } = await sb
      .from("user_usage")
      .insert({
        user_id: userId,
        plan: "free",
        free_continues_used: 0,
      })
      .select("plan, free_continues_used")
      .single();

    if (insertError) throw insertError;
    usage = newUsage;
  }

  const plan = usage?.plan || "free";
  const continuesUsed = usage?.free_continues_used || 0;

  // Pro users have unlimited continues
  if (plan === "pro") {
    return {
      allowed: true,
      usage: {
        plan,
        continues_used: continuesUsed,
        continues_remaining: -1, // unlimited
      },
    };
  }

  // Free users have limit
  const allowed = continuesUsed < FREE_CONTINUES_LIMIT;
  const remaining = Math.max(0, FREE_CONTINUES_LIMIT - continuesUsed);

  return {
    allowed,
    usage: {
      plan,
      continues_used: continuesUsed,
      continues_remaining: remaining,
    },
  };
}

/**
 * Increment continue usage for user
 */
export async function incrementContinueUsage(userId: string): Promise<void> {
  const sb = supabaseAdmin();

  // Increment free_continues_used
  const { error } = await sb.rpc("increment_continue_usage", {
    p_user_id: userId,
  });

  if (error) {
    // Fallback to manual increment if function doesn't exist
    const { error: updateError } = await sb
      .from("user_usage")
      .update({
        free_continues_used: sb.raw("free_continues_used + 1"),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) throw updateError;
  }
}

/**
 * Upgrade user to pro plan
 */
export async function upgradeUserToPro(userId: string): Promise<void> {
  const sb = supabaseAdmin();

  const { error } = await sb
    .from("user_usage")
    .upsert(
      {
        user_id: userId,
        plan: "pro",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id",
      }
    );

  if (error) throw error;
}

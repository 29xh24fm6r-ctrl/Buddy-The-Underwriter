import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  try {
    const supabase = getSupabaseServerClient();

    // Try a simple query to test connectivity
    // Using a basic query that should work on any Supabase instance
    const { data, error } = await supabase.from("deals").select("id").limit(1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          env,
          connectivity: "query_failed",
          error: error.message,
          hint: "Env vars are present but query failed. Check table name 'deals' exists or RLS policies.",
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        env,
        connectivity: "ok",
        message: "Successfully connected to Supabase and queried deals table",
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        env,
        connectivity: "client_init_failed",
        error: e?.message || "unknown_error",
        hint: "Failed to create Supabase client. Check env vars in Codespaces Secrets or .env.local",
      },
      { status: 500 },
    );
  }
}

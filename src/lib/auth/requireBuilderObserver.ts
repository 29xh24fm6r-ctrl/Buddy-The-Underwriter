import "server-only";

import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";

type BuilderGate =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Non-throwing builder-mode gate for App-Router API routes.
 * Returns { ok: false, error, status } instead of throwing a NextResponse
 * so the caller can return its own JSON shape.
 */
export async function requireBuilderObserver(
  req?: Request,
): Promise<BuilderGate> {
  if (process.env.BUDDY_BUILDER_MODE !== "1") {
    return { ok: false, error: "builder_mode_disabled", status: 403 };
  }

  // If a Request is provided, validate the builder token header.
  // If not provided (e.g. server-only health checks), skip token check.
  if (req) {
    try {
      mustBuilderToken(req);
    } catch {
      return { ok: false, error: "unauthorized", status: 401 };
    }
  }

  return { ok: true };
}

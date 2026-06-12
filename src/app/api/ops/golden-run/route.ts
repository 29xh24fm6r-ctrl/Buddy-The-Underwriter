// Static segment takes precedence over the /api/ops/[...path] catch-all,
// so this route owns POST /api/ops/golden-run without touching the
// dispatcher. Handler lives with its siblings in _handlers/.
export { POST } from "../[...path]/_handlers/golden-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The run is single-digit seconds (direct inserts, stubbed trident), but
// give the same headroom as the rest of the ops namespace.
export const maxDuration = 60;

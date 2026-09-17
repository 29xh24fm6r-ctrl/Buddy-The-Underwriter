import type { GuidedSnapshot } from "../guidedPackage/questions";
/** A successful HTTP response alone is not proof of a usable, correctly scoped workspace. */
export function readGuidedResponse(
  data: unknown,
  dealId: string,
): GuidedSnapshot {
  const result = data as {
    ok?: boolean;
    dealId?: string;
    snapshot?: GuidedSnapshot;
  } | null;
  if (
    !result?.ok ||
    result.dealId !== dealId ||
    !Array.isArray(result.snapshot?.questions) ||
    !Array.isArray(result.snapshot.owners) ||
    !Array.isArray(result.snapshot.readErrors)
  )
    throw new Error(
      "We couldn’t safely load this application. Reload your saved information and try again.",
    );
  return result.snapshot;
}

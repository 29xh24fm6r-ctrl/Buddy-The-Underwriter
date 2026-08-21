/**
 * Collapse repeat copies of the same document into one entry.
 *
 * WHY THIS EXISTS.
 *
 * Upload dedupe is keyed on sha256, and sha256 is only populated for
 * uploads made since the client started hashing. Every row written before
 * that has `sha256` NULL, so dedupe has nothing to compare and the rows sit
 * there forever. Deal b296dec2 holds SIX rows for one file:
 *
 *   2025_TaxReturn.pdf   1,013,618 bytes   sha256 NULL   ×6
 *
 * The borrower opens Chapter 4 and sees six copies of their tax return.
 * They cannot tell which one "counted", which is exactly the anxiety that
 * produced copies two through six in the first place.
 *
 * THE FALLBACK KEY. When two rows on the same deal share an identical
 * filename AND an identical byte count, they are the same file. Byte-exact
 * size collision across two genuinely different documents with the same
 * name on one deal is not a realistic scenario; a borrower re-uploading
 * the same attachment is the everyday one. Rows WITH a sha256 are keyed on
 * that instead — a real content hash always beats a heuristic.
 *
 * A row with no filename or no size falls back to its own id, so it is
 * never collapsed into anything. Uncertainty means show it.
 *
 * This hides nothing: the collapsed row reports how many copies it stands
 * for, and every duplicate id is carried along so callers can still act on
 * them. It is a VIEW-level fix — no rows are deleted, no history is lost,
 * and the banker-facing surfaces are untouched.
 */

export type CollapsibleDocument = {
  id: string;
  filename?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  uploadedAt?: string | null;
};

export type CollapsedDocument<T extends CollapsibleDocument> = T & {
  /** How many rows this entry stands for, including itself. Always ≥ 1. */
  copies: number;
  /** Ids of the other rows folded into this one, newest first. */
  duplicateIds: string[];
};

function contentKey(doc: CollapsibleDocument): string {
  const sha = (doc.sha256 ?? "").trim();
  if (sha) return `sha:${sha}`;

  const name = (doc.filename ?? "").trim().toLowerCase();
  const size = doc.sizeBytes;
  if (!name || size == null || size <= 0) return `id:${doc.id}`;
  return `name-size:${name}:${size}`;
}

function uploadedTime(doc: CollapsibleDocument): number {
  if (!doc.uploadedAt) return 0;
  const t = new Date(doc.uploadedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Collapse `documents` into one entry per distinct file, preserving the
 * input order of the entries that survive.
 *
 * The KEPT row is the most recently uploaded copy: it is the one whose
 * classification and checklist assignment reflect the borrower's latest
 * intent, and it is the one the deal's other surfaces are most likely to
 * have processed.
 */
export function collapseDuplicateDocuments<T extends CollapsibleDocument>(
  documents: readonly T[],
): Array<CollapsedDocument<T>> {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const doc of documents) {
    const key = contentKey(doc);
    const group = groups.get(key);
    if (group) {
      group.push(doc);
    } else {
      groups.set(key, [doc]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = groups.get(key) ?? [];
    const sorted = [...group].sort((a, b) => uploadedTime(b) - uploadedTime(a));
    const [kept, ...duplicates] = sorted;
    return {
      ...kept,
      copies: group.length,
      duplicateIds: duplicates.map((d) => d.id),
    };
  });
}

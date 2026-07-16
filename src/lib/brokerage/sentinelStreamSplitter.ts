/**
 * Splits a growing text stream into "safe to show the user" content and a
 * trailing structured payload, on either side of a fixed delimiter that can
 * arrive split across chunk boundaries. Used by the concierge route to
 * stream Buddy's reply to the browser while holding back the structured
 * facts JSON that follows CONCIERGE_FACTS_SENTINEL until the model has
 * finished.
 *
 * Standard streaming-delimiter algorithm: never flush the last
 * `sentinel.length` characters of what's arrived so far, since they could
 * be an in-progress prefix of the sentinel — only once more text confirms
 * they aren't (or the sentinel is found) do they become safe to release.
 */
export function createSentinelSplitter(sentinel: string) {
  let full = "";
  let sentPos = 0;
  let sentinelIdx = -1;

  return {
    /** Feed a new text delta. Returns the portion now safe to show the user (may be ""). */
    feed(delta: string): string {
      full += delta;
      if (sentinelIdx !== -1) return "";

      const idx = full.indexOf(sentinel);
      if (idx !== -1) {
        sentinelIdx = idx;
        const toSend = full.slice(sentPos, idx);
        sentPos = idx;
        return toSend;
      }

      const safeUpTo = Math.max(sentPos, full.length - sentinel.length);
      if (safeUpTo <= sentPos) return "";
      const toSend = full.slice(sentPos, safeUpTo);
      sentPos = safeUpTo;
      return toSend;
    },

    /**
     * Call once the underlying stream has ended.
     * - If the sentinel was found: `messageText` is everything before it
     *   (trimmed), `factsRaw` is everything after it (untrimmed — caller's
     *   job to clean up fences/whitespace), `trailingToShow` is "".
     * - If the sentinel never arrived (stream died early, or the source
     *   deviated from the expected format): `factsRaw` is null,
     *   `trailingToShow` is whatever was still held back and must still be
     *   shown to the user, `messageText` is the full trimmed text.
     */
    finish(): { messageText: string; trailingToShow: string; factsRaw: string | null } {
      if (sentinelIdx !== -1) {
        return {
          messageText: full.slice(0, sentinelIdx).trim(),
          trailingToShow: "",
          factsRaw: full.slice(sentinelIdx + sentinel.length),
        };
      }
      return {
        messageText: full.trim(),
        trailingToShow: full.slice(sentPos),
        factsRaw: null,
      };
    },
  };
}

/**
 * Whether a chapter move should be PERSISTED as the borrower's resume
 * pointer, or only reflected in the view.
 *
 * `borrower_intake_progress.current_chapter` answers "where do we put this
 * borrower when they come back". The review screen's "Resolve now" buttons
 * deep-link BACKWARD (chapter 3 for Ownership & Identity, 4 for Financials)
 * to let the borrower look at and fix one item. That is a request to view an
 * earlier chapter, not a statement that they have retreated to it.
 *
 * Persisting it anyway overwrote a borrower sitting on review at chapter 5
 * with chapter 3, so every later resume dropped them mid-funnel — and the
 * only route back to review was walking forward through every chapter again.
 *
 * Forward moves always persist: that is the fail-closed rule the funnel is
 * built on. A backward move that CARRIES DATA still persists, because the
 * data has to be written and the borrower really is editing that chapter.
 */
export function shouldPersistChapterMove(args: {
  from: number;
  to: number;
  hasData: boolean;
}): boolean {
  if (args.hasData) return true;
  return args.to >= args.from;
}

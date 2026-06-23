-- SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 (follow-up)
-- reviewer_user_id holds the app user id from auth (Clerk: e.g. "user_2ab..."), which is NOT a
-- UUID. Widen the column from uuid to text so non-UUID app user ids can be stored.
ALTER TABLE public.classic_spread_review_actions
  ALTER COLUMN reviewer_user_id TYPE text USING reviewer_user_id::text;

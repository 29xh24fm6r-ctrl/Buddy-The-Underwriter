-- Atomic batch claim RPC for intake outbox consumption.
--
-- Uses FOR UPDATE SKIP LOCKED to allow concurrent consumers without
-- row contention. Only claims rows with kind = 'intake.process'.
--
-- Called by: /api/workers/intake-outbox (Vercel Cron, every 1 min)
-- NOT called by: buddy-core-worker (Pulse forwarding — excludes intake.process)

CREATE OR REPLACE FUNCTION claim_intake_outbox_batch(
  p_claim_owner text,
  p_claim_ttl_seconds int DEFAULT 120,
  p_limit int DEFAULT 5
)
RETURNS TABLE (id uuid, deal_id uuid, bank_id uuid, payload jsonb, attempts int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH to_claim AS (
    SELECT boe.id
    FROM buddy_outbox_events boe
    WHERE boe.kind = 'intake.process'
      AND boe.delivered_at IS NULL
      AND boe.dead_lettered_at IS NULL
      AND (boe.claimed_at IS NULL
           OR boe.claimed_at < now() - make_interval(secs => p_claim_ttl_seconds))
      AND (boe.next_attempt_at IS NULL OR boe.next_attempt_at <= now())
    ORDER BY boe.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE buddy_outbox_events boe
    SET claimed_at = now(), claim_owner = p_claim_owner
    FROM to_claim tc
    WHERE boe.id = tc.id
    RETURNING boe.id, boe.deal_id, boe.bank_id, boe.payload, boe.attempts
  )
  SELECT claimed.id, claimed.deal_id, claimed.bank_id, claimed.payload, claimed.attempts
  FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_intake_outbox_batch TO authenticated;
GRANT EXECUTE ON FUNCTION claim_intake_outbox_batch TO service_role;

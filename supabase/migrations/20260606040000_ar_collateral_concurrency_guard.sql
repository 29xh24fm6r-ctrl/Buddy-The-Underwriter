-- AR collateral concurrency guard.
-- Partial unique index: at most one in-flight ('extracting') report per source_document_id.
-- Historical 'pending' / 'complete' / 'failed' rows are not constrained, so retries that
-- replace a terminal report keep working. Concurrent runs lose the race at the DB layer
-- with a duplicate-key error, which the application's existing reportErr path handles.

CREATE UNIQUE INDEX IF NOT EXISTS ar_aging_reports_one_extracting_per_document
  ON public.ar_aging_reports(source_document_id)
  WHERE extraction_status = 'extracting';

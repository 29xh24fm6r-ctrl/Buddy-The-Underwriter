begin;

-- Stores normalized word boxes (0..1) + char offsets within page_text.
-- This is the key to deterministic highlight rectangles.
create table if not exists public.document_ocr_words (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  attachment_id uuid not null,
  page_number int not null,
  word_index int not null, -- order on the page
  content text not null,

  -- normalized bounding box [0..1] relative to page width/height
  x1 numeric not null,
  y1 numeric not null,
  x2 numeric not null,
  y2 numeric not null,

  -- char offsets into document_ocr_page_map.page_text
  page_char_start int not null default 0,
  page_char_end int not null default 0,

  created_at timestamptz not null default now(),
  unique(deal_id, attachment_id, page_number, word_index)
);

create index if not exists idx_ocr_words_deal_attachment on public.document_ocr_words(deal_id, attachment_id);
create index if not exists idx_ocr_words_page on public.document_ocr_words(deal_id, attachment_id, page_number);
create index if not exists idx_ocr_words_char_range on public.document_ocr_words(deal_id, attachment_id, page_number, page_char_start, page_char_end);

commit;

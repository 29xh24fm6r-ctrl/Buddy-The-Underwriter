export type RetrievedChunk = {
  chunk_id: string;
  upload_id: string;
  page_start: number | null;
  page_end: number | null;
  content: string;
  similarity: number;
};

export type Citation = {
  chunk_id: string;
  upload_id: string;
  chunk_index?: number;
  page_start?: number | null;
  page_end?: number | null;
  // OCR span fields (for real doc/page citations)
  document_id?: string | null;
  page_number?: number | null;
  bbox?: any | null; // {x,y,w,h} normalized coords
  snippet: string;
  similarity?: number;
};

export type CommitteeAnswer = {
  answer: string;
  citations: Citation[];
  debug?: {
    retrieved: RetrievedChunk[];
    selectedChunkIds: string[];
  };
};

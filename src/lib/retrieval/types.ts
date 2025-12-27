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

import { db, type PdfArtifact } from "./store";

function nowISO() {
  return new Date().toISOString();
}

function id() {
  return `PDF_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function savePdfArtifact(params: {
  dealId: string;
  template: string;
  filePath: string;
  meta?: Record<string, any>;
}): PdfArtifact {
  const artifact: PdfArtifact = {
    id: id(),
    createdAt: nowISO(),
    ...params,
  };
  db.pdfs.set(artifact.id, artifact);
  return artifact;
}

export function getPdfArtifact(pdfId: string): PdfArtifact | null {
  return db.pdfs.get(pdfId) ?? null;
}

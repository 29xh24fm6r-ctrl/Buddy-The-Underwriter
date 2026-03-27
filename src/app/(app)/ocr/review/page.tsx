import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="ocr_review_data_validation"
      title="OCR Review & Data Validation"
      mode="iframe"
    />
  );
}

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export async function generateFormPdf(input: {
  formName: string;
  filledFields: Record<string, string>;
  metadata: {
    business_name: string;
    loan_amount: number;
    generated_at: string;
  };
}): Promise<Buffer> {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const { width, height } = page.getSize();
  let yPosition = height - 50;

  // Header
  page.drawText(input.formName, {
    x: 50,
    y: yPosition,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;
  page.drawText(`Generated: ${new Date(input.metadata.generated_at).toLocaleString()}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  yPosition -= 40;

  // Fields
  for (const [fieldName, fieldValue] of Object.entries(input.filledFields)) {
    if (yPosition < 100) {
      // Add new page if running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPosition = height - 50;
    }

    // Field label
    page.drawText(`${fieldName}:`, {
      x: 50,
      y: yPosition,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    // Field value
    const displayValue = String(fieldValue || '[Not Provided]');
    page.drawText(displayValue, {
      x: 250,
      y: yPosition,
      size: 11,
      font: font,
      color: rgb(0, 0, 0),
    });

    yPosition -= 25;
  }

  // Footer
  page.drawText('Buddy SBA Underwriting Engine - Automated Form Generation', {
    x: 50,
    y: 30,
    size: 8,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

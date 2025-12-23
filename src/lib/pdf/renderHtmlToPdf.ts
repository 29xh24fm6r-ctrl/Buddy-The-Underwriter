import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

function nowSlug() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function renderHtmlToPdf(params: {
  html: string;
  outDir?: string; // default /mnt/data/buddy_pdfs
  fileNamePrefix?: string; // e.g. CREDIT_MEMO
}): Promise<{ filePath: string }> {
  const outDir = params.outDir ?? "/mnt/data/buddy_pdfs";
  await fs.mkdir(outDir, { recursive: true });

  const fileNamePrefix = params.fileNamePrefix ?? "BUDDY_PDF";
  const filePath = path.join(outDir, `${fileNamePrefix}_${nowSlug()}.pdf`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Load HTML into a blank page
  await page.setContent(params.html, { waitUntil: "networkidle" });

  await page.pdf({
    path: filePath,
    format: "Letter",
    printBackground: true,
    margin: {
      top: "18mm",
      bottom: "18mm",
      left: "14mm",
      right: "14mm",
    },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="font-size:9px; width:100%; padding:0 14mm; color:#666; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial;">
        <span>Buddy The Underwriter • Advanced Credit Memo</span>
      </div>
    `,
    footerTemplate: `
      <div style="font-size:9px; width:100%; padding:0 14mm; color:#666; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial;">
        <span style="float:left;">Confidential</span>
        <span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `,
  });

  await browser.close();
  return { filePath };
}

"use client";

/**
 * SPEC-CREDIT-MEMO-PDF-EXPORT-VIA-PRINT-1
 *
 * Opens the full CanonicalMemoTemplate print page in a new window and
 * triggers window.print(). The print page renders all 20 sections at
 * full fidelity with Letter page CSS, narrative overlay, and SpreadsAppendix.
 */
export default function ExportCanonicalMemoPdfButton({
  dealId,
  className,
  label = "Export PDF",
}: {
  dealId: string;
  className?: string;
  label?: string;
}) {
  function handleExport() {
    if (!dealId) return;
    const printUrl = `/credit-memo/${dealId}/canonical/print`;
    const printWindow = window.open(printUrl, "_blank");
    if (!printWindow) return;

    // Wait for page load then trigger print dialog
    printWindow.addEventListener("load", () => {
      setTimeout(() => {
        printWindow.print();
      }, 1000); // 1s for fonts/styles to settle
    });
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className={
        className ??
        "inline-flex items-center rounded-md bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-gray-900"
      }
    >
      {label}
    </button>
  );
}

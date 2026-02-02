import "server-only";

import CanonicalMemoTemplate from "@/components/creditMemo/CanonicalMemoTemplate";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { requireRole } from "@/lib/auth/requireRole";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CanonicalCreditMemoPrintPage(props: {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await props.params;
  const searchParams = (props.searchParams ? await props.searchParams : {}) as Record<
    string,
    string | string[] | undefined
  >;

  const tokenFromQuery = typeof searchParams.token === "string" ? searchParams.token : undefined;
  const tokenFromHeader = (await headers()).get("x-pdf-render-token") ?? undefined;
  const token = tokenFromHeader || tokenFromQuery;
  const secret = process.env.PDF_RENDER_SECRET;

  // If token is present and matches, bypass Clerk entirely (used by Playwright server-side PDF export).
  if (!token || !secret || token !== secret) {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
  }

  let bankId: string | undefined;
  if (!(token && secret && token === secret)) {
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) redirect("/select-bank");
    bankId = bankPick.bankId;
  }
  const res = await buildCanonicalCreditMemo({ dealId, bankId });

  if (!res.ok) {
    return (
      <html>
        <body className="bg-white">
          <div className="p-8 text-sm">Unable to build memo: {res.error}</div>
        </body>
      </html>
    );
  }

  return (
    <html>
      <head>
        <style>{`
          @page { size: Letter; margin: 0.5in; }
          @media print {
            body { background: white !important; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
          }
        `}</style>
      </head>
      <body className="bg-white">
        <div className="mx-auto max-w-[900px] min-h-[1100px] p-[40px]">
          <CanonicalMemoTemplate memo={res.memo} />
        </div>
      </body>
    </html>
  );
}

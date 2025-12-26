import MemoTemplate from "@/components/memo/MemoTemplate";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function MemoPreviewPage({
  params,
}: {
  params: Promise<{ dealId: string; docId: string }>;
}) {
  const { dealId, docId } = await params;
const supabase = supabaseAdmin();

  const { data: doc, error } = await supabase
    .from("generated_documents")
    .select("id, deal_id, doc_type, content_json")
    .eq("id", docId)
    .single();

  if (error || !doc || doc.deal_id !== dealId) {
    return <div className="p-8">Not found</div>;
  }

  return (
    <html>
      <head>
        <style>{`
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
        <div className="print-container mx-auto max-w-[900px] min-h-[1100px] p-[40px]">
          <MemoTemplate memo={(doc.content_json as any) ?? {}} />
        </div>
      </body>
    </html>
  );
}

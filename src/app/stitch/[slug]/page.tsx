import { getStrippedStitchHtml } from "@/lib/stitch/getStrippedStitchHtml";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bodyHtml = await getStrippedStitchHtml(slug);

  return (
    <div className="relative min-h-[calc(100vh-56px)] bg-[#0b0d10] overflow-auto">
      <div data-stitch-embedded="true" className="min-h-full w-full">
        <style>{`
          /* Hide Stitch-exported side chrome when embedded in app */
          [data-stitch-embedded] nav.w-[72px] { display: none !important; }
          [data-stitch-embedded] aside.w-[280px] { display: none !important; }
          [data-stitch-embedded] aside.w-[360px] { display: none !important; }

          /* Expand content */
          [data-stitch-embedded] .flex { width: 100% !important; }
        `}</style>

        <div
          className="stitch-root min-h-full w-full"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
    </div>
  );
}

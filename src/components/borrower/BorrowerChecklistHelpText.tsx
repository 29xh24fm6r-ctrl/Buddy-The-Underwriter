"use client";

type HelpContent = {
  why: string;
  formats: string;
  examples: string;
  scans: string;
};

export function BorrowerChecklistHelpText({
  content,
}: {
  content: HelpContent;
}) {
  return (
    <div className="grid gap-3 rounded-[1rem] border border-stone-200 bg-stone-50/80 p-4 sm:grid-cols-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          Why Buddy needs this
        </div>
        <p className="mt-1 text-sm leading-6 text-stone-700">{content.why}</p>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          Accepted formats
        </div>
        <p className="mt-1 text-sm leading-6 text-stone-700">{content.formats}</p>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          Typical file examples
        </div>
        <p className="mt-1 text-sm leading-6 text-stone-700">{content.examples}</p>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          Scans or phone photos
        </div>
        <p className="mt-1 text-sm leading-6 text-stone-700">{content.scans}</p>
      </div>
    </div>
  );
}

import "server-only";

import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";
import { getStitchSurfaceConfig, type StitchSurfaceKey } from "@/stitch/stitchSurfaceRegistry";

type StitchSurfaceProps = {
  surfaceKey: StitchSurfaceKey;
  dealId?: string;
  title?: string;
  mode?: "iframe" | "new_tab" | "panel";
  reasonIfBlocked?: string;
  activationToken?: string | null;
};

function resolveHref(template: string | undefined, dealId?: string) {
  if (!template) return null;
  if (!dealId) return template;
  return template.replace(/:dealId/g, dealId).replace(/\[dealId\]/g, dealId);
}

export default async function StitchSurface({
  surfaceKey,
  dealId,
  title,
  mode,
  reasonIfBlocked,
  activationToken,
}: StitchSurfaceProps) {
  if (reasonIfBlocked) {
    return null;
  }

  const config = getStitchSurfaceConfig(surfaceKey);
  if (!config) return null;

  const resolvedMode = mode ?? config.mode;
  const openHref =
    resolveHref(config.openHref, dealId) ??
    (config.slug ? `/stitch/${config.slug}` : null);

  if (resolvedMode === "iframe") {
    if (!config.slug) return null;
    const activationContext =
      config.activation === "token"
        ? { token: activationToken ?? null }
        : config.activation === "dealId"
          ? { dealId: dealId ?? null }
          : undefined;

    return (
      <div
        data-testid="stitch-surface"
        data-surface-key={surfaceKey}
        className="stitch-embed"
      >
        <StitchRouteBridge
          slug={config.slug}
          activationContext={activationContext}
        />
      </div>
    );
  }

  if (resolvedMode === "new_tab") {
    if (!openHref) return null;
    return (
      <div
        data-testid="stitch-surface"
        data-surface-key={surfaceKey}
        className="rounded-2xl border border-neutral-200 bg-white p-6"
      >
        <div className="text-lg font-semibold text-neutral-900">
          {title ?? "Stitch Surface"}
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          This view opens in a new tab.
        </p>
        <a
          href={openHref}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          Open Stitch in new tab
        </a>
      </div>
    );
  }

  return (
    <div
      data-testid="stitch-surface"
      data-surface-key={surfaceKey}
      className="rounded-2xl border border-neutral-200 bg-white p-6"
    >
      <div className="text-lg font-semibold text-neutral-900">
        {title ?? "Stitch Surface"}
      </div>
      <p className="mt-2 text-sm text-neutral-600">
        This surface is available in Stitch.
      </p>
    </div>
  );
}

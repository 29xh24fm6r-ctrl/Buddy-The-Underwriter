import { UploadPageClient } from "./client";
import {
  consumeBorrowerPortalLink,
  PortalLinkError,
} from "@/lib/portal/portalLinkState";

const TERMINAL_COPY: Record<string, { title: string; body: string }> = {
  link_not_found: {
    title: "Invalid link",
    body: "This upload link is not recognized. Please contact your lender for a fresh link.",
  },
  link_expired: {
    title: "Link expired",
    body: "This upload link has expired. Please contact your lender for a fresh link.",
  },
  link_consumed: {
    title: "Link already used",
    body: "This upload link has already been used. Please contact your lender for a fresh link.",
  },
  link_revoked: {
    title: "Link no longer valid",
    body: "A newer upload link was issued. Please use the most recent link your lender sent you.",
  },
  portal_link_rpc_failed: {
    title: "Something went wrong",
    body: "We couldn't validate this link. Please try again, or contact your lender.",
  },
};

function ErrorPanel({ code }: { code: string }) {
  const copy = TERMINAL_COPY[code] ?? TERMINAL_COPY.portal_link_rpc_failed;
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
      <div className="rounded-2xl bg-white text-neutral-900 p-6 shadow-lg max-w-md">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-neutral-600">{copy.body}</p>
      </div>
    </div>
  );
}

export default async function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    await consumeBorrowerPortalLink(token);
  } catch (err) {
    if (err instanceof PortalLinkError) {
      return <ErrorPanel code={err.code} />;
    }
    return <ErrorPanel code="portal_link_rpc_failed" />;
  }

  return <UploadPageClient token={token} />;
}

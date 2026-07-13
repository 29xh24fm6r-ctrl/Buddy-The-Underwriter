import { UploadPageClient } from "./client";
import { PortalLinkError } from "@/lib/portal/portalLinkState";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

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
    <div className="brand-hero-bg flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-md rounded-[1.75rem] bg-white p-7 text-slate-900 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100">
          <span className="text-lg font-bold text-rose-600">!</span>
        </div>
        <h1 className="mt-4 font-heading text-lg font-bold text-slate-900">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{copy.body}</p>
      </div>
    </div>
  );
}

export default async function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    // Validate the token against EITHER token table (invite or portal link)
    // without consuming it — the borrower still needs it for prepare + commit.
    await resolveBorrowerToken(token);
  } catch (err) {
    if (err instanceof PortalLinkError) {
      return <ErrorPanel code={err.code} />;
    }
    // A bare invite token that isn't a portal link surfaces as link_not_found.
    return <ErrorPanel code="link_not_found" />;
  }

  return <UploadPageClient token={token} />;
}

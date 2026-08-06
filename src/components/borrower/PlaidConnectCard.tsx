"use client";

/**
 * SPEC-M5 CONVERSATIONAL-INTAKE-1 — surfaces the already-live Plaid bank
 * connection backend (createLinkToken/exchangePublicToken/syncTransactions,
 * src/lib/integrations/plaid/*, wired to /api/borrower/plaid/[action])
 * inside the conversational interview UI. There was no working frontend
 * caller of that backend before this — src/components/connect/
 * ConnectAccountsPanel.tsx is explicitly orphaned (targets different, dead
 * tables; see its own doc comment) and was never mounted anywhere.
 *
 * Loads Plaid Link from Plaid's CDN rather than adding the `react-plaid-link`
 * npm package — this repo's AI-gateway invariant favors fetch-only/no-new-
 * SDK footprints where a thin script-tag integration does the same job, and
 * this is a one-button, one-flow widget with no need for the React wrapper's
 * extra surface area.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type PlaidLinkHandler = {
  open: () => void;
  destroy: () => void;
};

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: unknown) => void;
        onExit?: (err: unknown) => void;
      }) => PlaidLinkHandler;
    };
  }
}

const PLAID_LINK_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const PLAID_LINK_SCRIPT_ID = "plaid-link-initialize";

function loadPlaidScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Plaid) return Promise.resolve();

  const existing = document.getElementById(PLAID_LINK_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Plaid script failed to load")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = PLAID_LINK_SCRIPT_ID;
    script.src = PLAID_LINK_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plaid script failed to load"));
    document.body.appendChild(script);
  });
}

export type PlaidConnectStatus = "idle" | "connecting" | "connected" | "error" | "unavailable";

/**
 * Pure presentational body — no fetching, no window/Plaid access. Split out
 * the same way GlassBoxPanel/FixCardsPanel are (SPEC-M3/M4) so every render
 * state is testable via renderToStaticMarkup without needing to drive a
 * live Plaid Link session.
 */
export function PlaidConnectCardBody({
  status,
  errorMessage,
  onConnect,
}: {
  status: PlaidConnectStatus;
  errorMessage: string | null;
  onConnect: () => void;
}) {
  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        <span aria-hidden>✓</span>
        <span>Bank account connected — Buddy will use it instead of asking you to upload statements.</span>
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-200">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">Bank connection coming soon</p>
            <p className="text-xs text-slate-400">
              You can skip this for now — enter your revenue above and upload statements later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">Skip the uploads — connect your bank</p>
          <p className="text-xs text-slate-500">
            Faster than uploading statements, and Buddy can verify cash flow automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onConnect}
          disabled={status === "connecting"}
          className="brand-gradient-cta whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {status === "connecting" ? "Connecting…" : "Connect bank"}
        </button>
      </div>
      {status === "error" && errorMessage && (
        <p className="mt-2 text-xs text-red-600">{errorMessage}</p>
      )}
    </div>
  );
}

/** Fetching wrapper — resolves a link token, drives Plaid Link, exchanges the public token. */
export function PlaidConnectCard({
  dealId,
  onConnected,
}: {
  dealId: string;
  onConnected?: () => void;
}) {
  const [status, setStatus] = useState<PlaidConnectStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const handlerRef = useRef<PlaidLinkHandler | null>(null);

  useEffect(() => {
    return () => {
      handlerRef.current?.destroy();
    };
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const tokenRes = await fetch("/api/borrower/plaid/link-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownership_entity_id: "" }),
        credentials: "include",
      });
      const tokenBody = await tokenRes.json();
      if (tokenBody?.errorCode === "plaid_not_configured") {
        setStatus("unavailable");
        return;
      }
      if (!tokenRes.ok || !tokenBody?.ok || !tokenBody?.link_token) {
        throw new Error(tokenBody?.error ?? "Could not start bank connection");
      }

      await loadPlaidScript();
      if (!window.Plaid) throw new Error("Plaid Link failed to load");

      const handler = window.Plaid.create({
        token: tokenBody.link_token,
        onSuccess: (publicToken, metadata) => {
          void (async () => {
            try {
              const exchangeRes = await fetch("/api/borrower/plaid/exchange", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  public_token: publicToken,
                  metadata,
                  deal_id: dealId,
                  consent_acknowledged: true,
                }),
                credentials: "include",
              });
              const exchangeBody = await exchangeRes.json();
              if (!exchangeRes.ok || !exchangeBody?.ok) {
                throw new Error(exchangeBody?.error ?? "Could not finish connecting your bank");
              }
              setStatus("connected");
              onConnected?.();
            } catch (e) {
              setErrorMessage(e instanceof Error ? e.message : String(e));
              setStatus("error");
            }
          })();
        },
        onExit: () => {
          setStatus((s) => (s === "connecting" ? "idle" : s));
        },
      });
      handlerRef.current = handler;
      handler.open();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [dealId, onConnected]);

  return <PlaidConnectCardBody status={status} errorMessage={errorMessage} onConnect={connect} />;
}

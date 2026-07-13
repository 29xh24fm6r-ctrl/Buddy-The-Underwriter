import "server-only";
import https from "node:https";

/**
 * SPEC S5 B-4 — real SBA E-Tran POST with mutual TLS. Kept in its own
 * "server-only" file so submitter.ts (which needs to stay testable under
 * plain `node --test`) never imports `node:https` directly — the API
 * route wires this in as submitter.ts's injected `postToSba` dependency.
 *
 * Cert PEM strings live in memory only for the duration of this call.
 * Never logged, never included in any error message beyond the standard
 * Node `https` error (which doesn't echo request options).
 */
export function postToSbaEtran(args: {
  endpoint: string;
  xml: string;
  clientCertPem: string;
  clientKeyPem: string;
}): Promise<{ accepted: boolean; body: string; rejectionReason?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(args.endpoint);
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        path: url.pathname,
        port: 443,
        cert: args.clientCertPem,
        key: args.clientKeyPem,
        headers: {
          "Content-Type": "application/xml",
          "Content-Length": Buffer.byteLength(args.xml),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const accepted = res.statusCode === 200 && body.includes("<Status>Accepted</Status>");
          resolve({ accepted, body, rejectionReason: accepted ? undefined : extractRejectionReason(body) });
        });
      },
    );
    req.on("error", reject);
    req.write(args.xml);
    req.end();
  });
}

function extractRejectionReason(xml: string): string {
  const match = xml.match(/<RejectionReason>([^<]+)<\/RejectionReason>/);
  return match ? match[1] : "Unknown rejection reason";
}

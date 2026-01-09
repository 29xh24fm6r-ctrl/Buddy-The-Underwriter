function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const enableOtel = process.env.BUDDY_ENABLE_OTEL === "1";
    const enableSentry = Boolean(
      process.env.SENTRY_DSN ||
        process.env.NEXT_PUBLIC_SENTRY_DSN ||
        process.env.SENTRY_AUTH_TOKEN,
    );

    // IMPORTANT: Never block request handling on telemetry startup.
    // Next will await register() during serverless init; keep it fast.
    if (enableOtel) {
      void (async () => {
        try {
          const g = globalThis as unknown as { __buddyOtelSdkStarted?: boolean };
          if (g.__buddyOtelSdkStarted) return;
          g.__buddyOtelSdkStarted = true;

          const [
            otelApi,
            { NodeSDK },
            { OTLPTraceExporter },
            resources,
            { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION },
            { getNodeAutoInstrumentations },
          ] = await withTimeout(
            Promise.all([
              import("@opentelemetry/api"),
              import("@opentelemetry/sdk-node"),
              import("@opentelemetry/exporter-trace-otlp-http"),
              import("@opentelemetry/resources"),
              import("@opentelemetry/semantic-conventions"),
              import("@opentelemetry/auto-instrumentations-node"),
            ]),
            8000,
            "otel_imports",
          );

          if (
            process.env.BUDDY_OTEL_DEBUG === "1" ||
            process.env.OTEL_LOG_LEVEL === "debug" ||
            process.env.OTEL_LOG_LEVEL === "info"
          ) {
            const level =
              process.env.OTEL_LOG_LEVEL === "debug"
                ? otelApi.DiagLogLevel.DEBUG
                : otelApi.DiagLogLevel.INFO;
            otelApi.diag.setLogger(new otelApi.DiagConsoleLogger(), level);
            console.log("[otel] diagnostics enabled", {
              level: process.env.OTEL_LOG_LEVEL || "info",
            });
          }

          const rawOtlpEndpoint =
            process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
            "https://api.honeycomb.io/v1/traces";

          const otlpEndpoint = (() => {
            const e = String(rawOtlpEndpoint).trim().replace(/\/+$/, "");
            if (e === "https://api.honeycomb.io") return "https://api.honeycomb.io/v1/traces";
            if (e.endsWith("/v1/traces")) return e;
            if (!e.includes("/v1/")) return `${e}/v1/traces`;
            return e;
          })();

          const parseHeaderString = (s: string) => {
            const map: Record<string, string> = {};
            s
              .split(",")
              .map((pair) => pair.trim())
              .filter(Boolean)
              .forEach((pair) => {
                const [k, ...rest] = pair.split("=");
                const key = k?.trim();
                const value = rest.join("=").trim();
                if (key) map[key] = value;
              });
            return map;
          };

          const headerMap: Record<string, string> = process.env.OTEL_EXPORTER_OTLP_HEADERS
            ? parseHeaderString(process.env.OTEL_EXPORTER_OTLP_HEADERS)
            : {};

          if (process.env.HONEYCOMB_API_KEY && !headerMap["x-honeycomb-team"]) {
            headerMap["x-honeycomb-team"] = process.env.HONEYCOMB_API_KEY;
          }
          if (process.env.HONEYCOMB_DATASET && !headerMap["x-honeycomb-dataset"]) {
            headerMap["x-honeycomb-dataset"] = process.env.HONEYCOMB_DATASET;
          }

          const exporter = new OTLPTraceExporter({
            url: otlpEndpoint,
            headers: Object.keys(headerMap).length ? headerMap : undefined,
          });

          const serviceName =
            process.env.OTEL_SERVICE_NAME ||
            process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ||
            "buddy-the-underwriter";

          const serviceVersion =
            process.env.OTEL_SERVICE_VERSION ||
            process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
            process.env.VERCEL_GIT_COMMIT_SHA ||
            undefined;

          const hasHoneycomb = Boolean(
            process.env.HONEYCOMB_API_KEY && process.env.HONEYCOMB_DATASET,
          );
          const hasOtlpHeaders = Object.keys(headerMap).length > 0;
          const dataset = process.env.HONEYCOMB_DATASET;

          console.log("[otel] init", {
            enabled: true,
            serviceName,
            serviceVersion,
            exporter: "otlp-http",
            otlpEndpoint,
            honeycomb: hasHoneycomb ? { dataset } : false,
            otlpHeadersConfigured: hasOtlpHeaders,
          });

          const sdk = new NodeSDK({
            autoDetectResources: false,
            resource: resources.resourceFromAttributes({
              [SEMRESATTRS_SERVICE_NAME]: serviceName,
              ...(serviceVersion
                ? { [SEMRESATTRS_SERVICE_VERSION]: serviceVersion }
                : null),
            }),
            traceExporter: exporter,
            instrumentations: [
              getNodeAutoInstrumentations({
                "@opentelemetry/instrumentation-fs": { enabled: false },
              }),
            ],
          });

          try {
            await withTimeout(Promise.resolve(sdk.start() as any), 8000, "otel_start");
            console.log("[otel] started", {
              serviceName,
              serviceVersion,
              otlpEndpoint,
              honeycomb: hasHoneycomb ? { dataset } : false,
            });
          } catch (e) {
            console.error("[otel] failed to start", e);
          }
        } catch (e) {
          console.error("[otel] init crashed (ignored)", e);
        }
      })();
    }

    // Best-effort only: do not block serverless init on Sentry config load.
    if (enableSentry) {
      void withTimeout(import("../sentry.server.config"), 2_000, "sentry_server_import").catch(
        (e) => {
          console.error("[sentry] failed to load server config (ignored)", e);
        },
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // Best-effort only: do not block edge init on Sentry config load.
    const enableSentry = Boolean(
      process.env.SENTRY_DSN ||
        process.env.NEXT_PUBLIC_SENTRY_DSN ||
        process.env.SENTRY_AUTH_TOKEN,
    );
    if (enableSentry) {
      void withTimeout(import("../sentry.edge.config"), 2_000, "sentry_edge_import").catch((e) => {
        console.error("[sentry] failed to load edge config (ignored)", e);
      });
    }
  }
}

// Best-effort: avoid importing Sentry during bootstrap.
// If Sentry is configured, this will forward the request error.
export const onRequestError = (...args: any[]) => {
  try {
    void import("@sentry/nextjs")
      .then((m: any) => {
        if (typeof m?.captureRequestError === "function") {
          return m.captureRequestError(...args);
        }
      })
      .catch(() => {});
  } catch {
    // ignore
  }
};

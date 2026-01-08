import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (
      (process.env.HONEYCOMB_API_KEY && process.env.HONEYCOMB_DATASET) ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ) {
      // Avoid duplicate initialization in dev/hot-reload.
      const g = globalThis as unknown as {
        __buddyOtelSdkStarted?: boolean;
      };

      if (!g.__buddyOtelSdkStarted) {
        g.__buddyOtelSdkStarted = true;

        const [
          otelApi,
          { NodeSDK },
          { OTLPTraceExporter },
          resources,
          { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION },
          { getNodeAutoInstrumentations },
        ] =
          await Promise.all([
            import("@opentelemetry/api"),
            import("@opentelemetry/sdk-node"),
            import("@opentelemetry/exporter-trace-otlp-http"),
            import("@opentelemetry/resources"),
            import("@opentelemetry/semantic-conventions"),
            import("@opentelemetry/auto-instrumentations-node"),
          ]);

        // Optional verbose diagnostics (prints exporter errors to logs).
        // Enable temporarily in Vercel to debug "no data received".
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
          // Honeycomb OTLP/HTTP endpoint for traces
          "https://api.honeycomb.io/v1/traces";

        const otlpEndpoint = (() => {
          const e = String(rawOtlpEndpoint).trim().replace(/\/+$/, "");
          // Honeycomb docs often provide the base URL. OTLP/HTTP traces require /v1/traces.
          if (e === "https://api.honeycomb.io") return "https://api.honeycomb.io/v1/traces";
          if (e.endsWith("/v1/traces")) return e;
          // If they provided an OTLP base endpoint, append the standard traces path.
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

        // Merge Honeycomb vars into OTLP headers if not already present.
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
          process.env.HONEYCOMB_API_KEY && process.env.HONEYCOMB_DATASET
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
          resource: resources.resourceFromAttributes({
            [SEMRESATTRS_SERVICE_NAME]: serviceName,
            ...(serviceVersion
              ? { [SEMRESATTRS_SERVICE_VERSION]: serviceVersion }
              : null),
          }),
          traceExporter: exporter,
          instrumentations: [
            getNodeAutoInstrumentations({
              // Reduce noise; file I/O spans are rarely useful here.
              "@opentelemetry/instrumentation-fs": { enabled: false },
            }),
          ],
        });

        try {
          await sdk.start();
          console.log("[otel] started", {
            serviceName,
            serviceVersion,
            otlpEndpoint,
            honeycomb: hasHoneycomb ? { dataset } : false,
          });
        } catch (e) {
          console.error("[otel] failed to start", e);
        }
      }
    }

    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

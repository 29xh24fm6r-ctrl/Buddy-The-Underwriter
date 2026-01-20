const toPlainHeaders = (headers) => {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const output = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  return headers;
};

const redactString = (value, secrets) => {
  if (!value || secrets.length === 0) return value;
  return secrets.reduce((acc, secret) => {
    if (!secret) return acc;
    return acc.split(secret).join("[REDACTED]");
  }, value);
};

const redactSecrets = (input, secrets = []) => {
  if (typeof input === "string") {
    return redactString(input, secrets);
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, secrets));
  }
  if (input && typeof input === "object") {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = redactSecrets(value, secrets);
    }
    return output;
  }
  return input;
};

const isHtml = (text, res) => {
  const contentType = res?.headers?.get?.("content-type") || "";
  if (contentType.includes("text/html")) return true;
  const sample = (text || "").trim().slice(0, 200).toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html") || sample.includes("<html");
};

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ label?: string, secrets?: string[], fetchImpl?: typeof fetch, timeoutMs?: number }} [config]
 */
const fetchWithDiagnostics = async (
  url,
  options = {},
  { label = "request", secrets = [], fetchImpl = fetch, timeoutMs = 15000 } = {}
) => {
  const startedAt = Date.now();
  let res = null;
  let text = "";
  let error = null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    res = await fetchImpl(url, { ...options, signal: controller.signal });
    text = await res.text();
  } catch (err) {
    error = err;
  } finally {
    clearTimeout(timeoutId);
  }

  let json = null;
  if (!error && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  const durationMs = Date.now() - startedAt;
  const contentType = res?.headers?.get?.("content-type") || null;
  const requestHeaders = redactSecrets(toPlainHeaders(options.headers), secrets);
  const redirected = res?.redirected ?? false;
  const finalUrl = res?.url ?? null;

  const diag = {
    label,
    url,
    method: options?.method ?? "GET",
    status: res?.status ?? null,
    ok: res?.ok ?? false,
    durationMs,
    contentType,
    redirected,
    finalUrl,
    requestHeaders,
    error: error
      ? {
          name: error.name ?? "Error",
          message: error.message ?? String(error),
        }
      : null,
    textPreview: text ? redactString(text.slice(0, 800), secrets) : "",
  };

  return { res, text, json, diag };
};

export { fetchWithDiagnostics, isHtml, redactSecrets };

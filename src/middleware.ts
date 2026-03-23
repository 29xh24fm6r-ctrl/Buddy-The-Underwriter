// src/middleware.ts
// Next.js only recognizes this filename as application middleware.
// All middleware logic lives in proxy.ts — this file simply re-exports it
// so the framework picks it up correctly.
export { default, config } from "./proxy";

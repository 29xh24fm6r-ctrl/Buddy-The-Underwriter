"use client";

import { useEffect } from "react";

let logged = false;

export default function BuildBootLog() {
  useEffect(() => {
    if (logged) return;
    logged = true;
    const sha = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";
    const env = process.env.NEXT_PUBLIC_BUILD_ENV ?? "unknown";
    const built = process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown";
    console.info(`[Buddy] boot sha=${sha} env=${env} built=${built}`);
  }, []);

  return null;
}

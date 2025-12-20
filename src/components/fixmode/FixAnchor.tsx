"use client";

import * as React from "react";
import type { FixTargetKind } from "@/lib/fixTargets";
import { useFixMode } from "@/components/fixmode/FixModeProvider";

export function FixAnchor(props: {
  kind: FixTargetKind;
  focusMap?: Record<string, string>;
  children: React.ReactNode;
  className?: string;
}) {
  const { register } = useFixMode();
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    return register(props.kind, ref.current, props.focusMap);
  }, [props.kind, props.focusMap, register]);

  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  );
}

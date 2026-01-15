"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

export function CopyToClipboardButton({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-50"
    >
      <Icon name="file" className="h-4 w-4" />
      {copied ? "Copied" : label}
    </button>
  );
}

"use client";

import Image from "next/image";
import { useState } from "react";
import { businessLogoUrl } from "@/lib/crm/businessWebsite";

export function BusinessIdentityMark({
  name,
  websiteUrl,
  size = 42,
}: {
  name: string;
  websiteUrl?: string | null;
  size?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoUrl = businessLogoUrl(websiteUrl);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "B";

  return (
    <span
      className="crm-business-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {logoUrl && !imageFailed ? (
        <Image
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          unoptimized
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

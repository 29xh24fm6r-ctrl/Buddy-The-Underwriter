import React from "react";

export default function BuddyAvatar({ size = 30 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at 30% 30%, rgba(120,180,255,0.95), rgba(90,120,255,0.85) 45%, rgba(40,60,120,0.9) 100%)",
        boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.20)",
      }}
      aria-label="Buddy"
      title="Buddy"
    >
      <svg
        width={Math.floor(size * 0.62)}
        height={Math.floor(size * 0.62)}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M8.4 10.3c.6-1.3 1.9-2.2 3.6-2.2s3 .9 3.6 2.2"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M7.2 13.3c.9 2 2.7 3.4 4.8 3.4s3.9-1.4 4.8-3.4"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

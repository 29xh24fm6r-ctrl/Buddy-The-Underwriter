import React from "react";

export default function BuddyStatusDot() {
  return (
    <span
      aria-label="Live"
      title="Live"
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: "rgba(80,220,160,0.95)",
        boxShadow: "0 0 0 3px rgba(80,220,160,0.14)",
        display: "inline-block",
      }}
    />
  );
}

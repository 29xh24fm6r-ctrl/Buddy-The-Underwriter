"use client";

import { BorrowerEmptyState } from "@/components/borrower/BorrowerEmptyState";

export function BorrowerChecklistEmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return <BorrowerEmptyState title={title} message={message} />;
}

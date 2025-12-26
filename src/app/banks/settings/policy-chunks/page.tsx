import { Suspense } from "react";
import PolicyChunksClient from "./PolicyChunksClient";

export default function PolicyChunksPage() {
  return (
    <Suspense fallback={null}>
      <PolicyChunksClient />
    </Suspense>
  );
}

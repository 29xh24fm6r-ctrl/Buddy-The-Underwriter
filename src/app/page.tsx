// src/app/page.tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RootPage() {
  // Middleware handles the redirect to /sign-in
  // This is a fallback that should rarely be hit
  redirect("/sign-in");
}

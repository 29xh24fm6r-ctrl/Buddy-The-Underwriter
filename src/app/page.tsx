// src/app/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export default function RootPage() {
  const { userId } = auth();
  redirect(userId ? "/deals" : "/sign-in");
}

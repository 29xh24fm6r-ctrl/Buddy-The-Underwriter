import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const { userId } = await auth(); // ✅ await
  if (!userId) redirect("/sign-in");
  redirect("/home");
}

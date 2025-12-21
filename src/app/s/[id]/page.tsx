import { notFound } from "next/navigation";
import { isValidScreenId } from "@/lib/screens/idgen";
import { ScreenViewClient } from "./ScreenViewClient";

type PageProps = {
  params: { id: string };
};

export default async function SharedScreenPage({ params }: PageProps) {
  const id = params.id;

  // Validate ID format
  if (!isValidScreenId(id)) {
    notFound();
  }

  // Fetch screen data server-side for initial render
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/screens/${id}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    notFound();
  }

  const screen = await res.json();

  return <ScreenViewClient initialScreen={screen} screenId={id} />;
}

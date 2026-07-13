import { redirect } from "next/navigation";

// /apply is the landing page's primary CTA (BrokerageLandingPage links here
// twice). Until the dedicated application experience ships, route borrowers
// into the live concierge flow instead of a 404. Forwards ?path= so the
// franchise-vs-standard chooser on the homepage still works if it ever
// links through here instead of straight to /start.
export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const path = params.path;
  const query = typeof path === "string" ? `?path=${encodeURIComponent(path)}` : "";
  redirect(`/start${query}`);
}

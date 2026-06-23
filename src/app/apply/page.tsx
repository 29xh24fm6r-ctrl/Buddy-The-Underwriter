import { redirect } from "next/navigation";

// /apply is the landing page's primary CTA (BrokerageLandingPage links here
// twice). Until the dedicated application experience ships, route borrowers
// into the live concierge flow instead of a 404.
export default function ApplyPage() {
  redirect("/start");
}

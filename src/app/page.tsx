import { redirect } from "next/navigation";

export default function HomePage() {
  // Redirect to deals (which will handle bank selection gating)
  redirect("/deals");
}

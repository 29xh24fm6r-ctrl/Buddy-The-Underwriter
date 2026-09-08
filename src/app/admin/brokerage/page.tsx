import "server-only";
import { redirect } from "next/navigation";

/** The CRM command center is the brokerage's one authoritative front door. */
export default function BrokerageHomePage() {
  redirect("/admin/brokerage/crm");
}

import type { Metadata } from "next";
import { BrokerageLandingPage } from "@/components/marketing/BrokerageLandingPage";

export const metadata: Metadata = {
  title: "Buddy — Get your SBA loan package built and matched to the right lender",
};

export default function Home() {
  return <BrokerageLandingPage />;
}

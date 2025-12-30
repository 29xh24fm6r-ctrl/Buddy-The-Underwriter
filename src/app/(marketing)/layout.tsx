import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Buddy — Loan Operations System",
  description:
    "Buddy is the world's first Loan Operations System. Intake, documents, verification, underwriting, compliance, communication, and decisions — end to end.",
  openGraph: {
    title: "Buddy — Loan Operations System",
    description:
      "Not lending software. A new category: Loan Operations System.",
    type: "website",
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-black antialiased">
        {children}
      </body>
    </html>
  );
}

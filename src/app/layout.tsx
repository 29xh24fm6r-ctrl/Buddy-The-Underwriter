import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ConditionalHeroBar } from "@/components/nav/ConditionalHeroBar";
import FrameGuard from "@/components/dev/FrameGuard";
import { PHProvider } from "@/components/analytics/PostHogProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.buddytheunderwriter.com"),
  title: {
    default: "Buddy the Underwriter",
    template: "%s • Buddy",
  },
  description:
    "Buddy turns SBA underwriting into a guided, automated, examiner-safe workflow that borrowers actually enjoy completing.",
  keywords: ["SBA lending", "underwriting software", "loan origination", "credit analysis", "SBA 7(a)"],
  authors: [{ name: "Buddy" }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.buddytheunderwriter.com",
    siteName: "Buddy the Underwriter",
    title: "Buddy the Underwriter",
    description:
      "SBA lending, without the chaos. Guided intake, underwriting automation, and examiner-safe audit trails.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Buddy the Underwriter",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Buddy the Underwriter",
    description:
      "SBA lending, without the chaos. Guided intake, underwriting automation, and examiner-safe audit trails.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/deals"
      afterSignUpUrl="/deals"
    >
      <html lang="en" className="dark">
        <head>
          {/* Material Symbols */}
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          />
        </head>
        <body className={`${inter.variable} font-inter bg-bg-dark text-white antialiased`}>
          <PHProvider>
            <FrameGuard />
            <ConditionalHeroBar />
            <main>{children}</main>
          </PHProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}


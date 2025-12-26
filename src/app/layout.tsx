import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ConditionalHeroBar } from "@/components/nav/ConditionalHeroBar";
import FrameGuard from "@/components/dev/FrameGuard";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Buddy Underwriter",
  description: "AI-powered credit intelligence",
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
          <FrameGuard />
          <ConditionalHeroBar />
          <main>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}


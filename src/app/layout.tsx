import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-slate-950 text-slate-100 antialiased`}
        >
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}


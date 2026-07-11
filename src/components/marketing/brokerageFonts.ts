import { Poppins, Plus_Jakarta_Sans } from "next/font/google";

/**
 * Type system for the borrower-facing Buddy landing page (/, /brokerage),
 * loaded only there so the rest of the app's bundle isn't carrying fonts
 * it doesn't use.
 */

export const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-brokerage-display",
  display: "swap",
});

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-brokerage-body",
  display: "swap",
});

export const brokerageLandingFontVariables = `${poppins.variable} ${plusJakartaSans.variable}`;

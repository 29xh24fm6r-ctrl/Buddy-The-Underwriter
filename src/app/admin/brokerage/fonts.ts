import { Zilla_Slab, Archivo, IBM_Plex_Mono } from "next/font/google";

/**
 * Brokerage-specific type system, loaded only within /admin/brokerage/*
 * so the rest of the app's bundle isn't carrying fonts it doesn't use.
 */

export const zillaSlab = Zilla_Slab({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-brokerage-display",
  display: "swap",
});

export const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-brokerage-sans",
  display: "swap",
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-brokerage-mono",
  display: "swap",
});

export const brokerageFontVariables = `${zillaSlab.variable} ${archivo.variable} ${ibmPlexMono.variable}`;

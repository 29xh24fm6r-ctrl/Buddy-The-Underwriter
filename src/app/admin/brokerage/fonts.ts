import localFont from "next/font/local";

export const zillaSlab = localFont({
  src: [
    { path: "../../../../public/fonts/ZillaSlab-400.woff2", weight: "400", style: "normal" },
    { path: "../../../../public/fonts/ZillaSlab-500.woff2", weight: "500", style: "normal" },
    { path: "../../../../public/fonts/ZillaSlab-600.woff2", weight: "600", style: "normal" },
    { path: "../../../../public/fonts/ZillaSlab-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-brokerage-display",
  display: "swap",
});

export const archivo = localFont({
  src: "../../../../public/fonts/Archivo-Variable.woff2",
  variable: "--font-brokerage-sans",
  display: "swap",
});

export const ibmPlexMono = localFont({
  src: [
    { path: "../../../../public/fonts/IBMPlexMono-400.woff2", weight: "400", style: "normal" },
    { path: "../../../../public/fonts/IBMPlexMono-500.woff2", weight: "500", style: "normal" },
    { path: "../../../../public/fonts/IBMPlexMono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-brokerage-mono",
  display: "swap",
});

export const brokerageFontVariables = `${zillaSlab.variable} ${archivo.variable} ${ibmPlexMono.variable}`;

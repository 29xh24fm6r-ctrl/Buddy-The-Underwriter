import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "#136dec",
        "primary-hover": "#3b82f6",
        "bg-dark": "#0f1115",
        "surface-dark": "#1a1d24",
        "glass-border": "rgba(255, 255, 255, 0.08)",
        "glass-bg": "rgba(22, 25, 30, 0.7)",
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
      fontFamily: {
        inter: ["var(--font-inter)", "Inter", "sans-serif"],
        display: ["var(--font-inter)", "Inter", "sans-serif"],
        body: ["var(--font-inter)", "Inter", "sans-serif"],
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};

export default config;

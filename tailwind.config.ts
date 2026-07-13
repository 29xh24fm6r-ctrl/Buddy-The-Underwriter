import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

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
        ink: {
          strong: "rgb(var(--ink-strong))",
          body: "rgb(var(--ink-body))",
          muted: "rgb(var(--ink-muted))",
          faint: "rgb(var(--ink-faint))",
        },
        // Buddy brand system (navy + accent-blue), shared with the
        // marketing site (BrokerageLandingPage/FranchiseLandingPage) so
        // the borrower app feels like the same product.
        "brand-navy": {
          900: "#0e2340",
          800: "#12263f",
          700: "#173250",
        },
        "brand-blue": {
          500: "#1c8de0",
          400: "#4db8f0",
        },
      },
      fontFamily: {
        inter: ["var(--font-inter)", "Inter", "sans-serif"],
        display: ["var(--font-inter)", "Inter", "sans-serif"],
        body: ["var(--font-inter)", "Inter", "sans-serif"],
        heading: ["var(--font-poppins)", "Poppins", "sans-serif"],
        jakarta: ["var(--font-jakarta)", "Plus Jakarta Sans", "sans-serif"],
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [forms],
};

export default config;

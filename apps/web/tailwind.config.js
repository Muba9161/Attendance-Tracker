/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          950: "#172a3e",
          900: "#1d354b",
          800: "#263d59",
          700: "#36536d",
          600: "#49667f",
        },
        accent: {
          blue: "#147FB5",
          cyan: "#32BDA8",
          indigo: "#147FB5",
        },
        slate: {
          50: "#F3F8FA", 100: "#EAF2F5", 200: "#D8E5EB", 300: "#B8CCD6",
          400: "#899EAC", 500: "#62666B", 600: "#43586B", 700: "#36536D",
          800: "#263D59", 900: "#1D354B", 950: "#142538",
        },
        blue: {
          50: "#EAF6FB", 100: "#D4EBF5", 200: "#B1D9E9", 300: "#83C0D9",
          400: "#55A8CC", 500: "#278FBF", 600: "#147FB5", 700: "#116B99",
          800: "#14597D", 900: "#174B68", 950: "#193B51",
        },
        indigo: {
          50: "#EAF6FB", 100: "#D4EBF5", 200: "#B1D9E9", 300: "#83C0D9",
          400: "#55A8CC", 500: "#278FBF", 600: "#147FB5", 700: "#116B99",
          800: "#14597D", 900: "#174B68", 950: "#193B51",
        },
        purple: {
          50: "#E8F8F5", 100: "#D2F1EA", 200: "#A9E5D9", 300: "#7AD5C4",
          400: "#54C9B4", 500: "#32BDA8", 600: "#249D8C", 700: "#1E7F73",
          800: "#1C655D", 900: "#1B514D", 950: "#173E3C",
        },
        cyan: {
          50: "#E8F8F5", 100: "#D2F1EA", 200: "#A9E5D9", 300: "#7AD5C4",
          400: "#54C9B4", 500: "#32BDA8", 600: "#249D8C", 700: "#1E7F73",
          800: "#1C655D", 900: "#1B514D", 950: "#173E3C",
        },
        teal: {
          50: "#E8F8F5", 100: "#D2F1EA", 200: "#A9E5D9", 300: "#7AD5C4",
          400: "#54C9B4", 500: "#32BDA8", 600: "#249D8C", 700: "#1E7F73",
          800: "#1C655D", 900: "#1B514D", 950: "#173E3C",
        },
        sky: {
          50: "#EAF6FB", 100: "#D4EBF5", 200: "#B1D9E9", 300: "#83C0D9",
          400: "#55A8CC", 500: "#278FBF", 600: "#147FB5", 700: "#116B99",
          800: "#14597D", 900: "#174B68", 950: "#193B51",
        },
        emerald: {
          50: "#E8F8F5", 100: "#D2F1EA", 200: "#A9E5D9", 300: "#7AD5C4",
          400: "#54C9B4", 500: "#32BDA8", 600: "#249D8C", 700: "#1E7F73",
          800: "#1C655D", 900: "#1B514D", 950: "#173E3C",
        },
        green: {
          50: "#E8F8F5", 100: "#D2F1EA", 200: "#A9E5D9", 300: "#7AD5C4",
          400: "#54C9B4", 500: "#32BDA8", 600: "#249D8C", 700: "#1E7F73",
          800: "#1C655D", 900: "#1B514D", 950: "#173E3C",
        },
        status: {
          present: "#32BDA8",
          late: "#F59E0B",
          absent: "#EF4444",
          wfh: "#147FB5",
          leave: "#32BDA8",
          holiday: "#32BDA8",
          incomplete: "#F97316", // Orange
          pending: "#F59E0B", // Amber
          approved: "#32BDA8",
          rejected: "#EF4444", // Rose
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Oxygen",
          "Ubuntu",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)",
        subtle: "0 4px 6px -1px rgba(15, 23, 42, 0.05), 0 2px 4px -2px rgba(15, 23, 42, 0.05)",
      },
    },
  },
  plugins: [],
};


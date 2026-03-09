import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "#FFFFFF",
        fg: "#4E4E4E",
        muted: "#8099B6",
        border: "#D9D8D6",
        brand: "#1B3E93",
        brandSoft: "#D4EEFC",
        success: "#99CC33",
        danger: "#B42318",
        warning: "#B46A00"
      }
    }
  },
  plugins: []
};

export default config;

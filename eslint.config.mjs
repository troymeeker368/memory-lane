import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ["scripts/**/*.cjs"]
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];

export default config;

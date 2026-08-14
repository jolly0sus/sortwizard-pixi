import js from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";

export default [
  { ignores: ["dist"] },
  js.configs.recommended,
  prettier,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        FontFace: "readonly",
        Audio: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        location: "readonly",
        Blob: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        HTMLInputElement: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {},
  },
];

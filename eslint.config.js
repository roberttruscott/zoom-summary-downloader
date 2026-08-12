export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Array: "readonly",
        Object: "readonly",
        Date: "readonly",
        RegExp: "readonly",
        Promise: "readonly",
        MutationObserver: "readonly",
        // Chrome extension globals
        chrome: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "semi": ["error", "always"],
      "quotes": ["warn", "double", { "avoidEscape": true }],
      "no-multiple-empty-lines": ["warn", { "max": 2 }],
      "eqeqeq": ["warn", "always"],
      "no-var": "warn",
      "prefer-const": "warn"
    }
  },
  {
    ignores: ["node_modules/**", "*.config.js"]
  }
];

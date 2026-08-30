import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "vendor/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // This code handles a decrypted vault; an unchecked promise here means
      // a lock that silently never happened.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // Never log a caught value wholesale — it may carry plaintext.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Build tooling, not extension code. The no-console rule above exists to
    // keep plaintext out of extension logs; a build script has no vault.
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Images are already optimized on upload and served through an authenticated media route.
    rules: { "@next/next/no-img-element": "off" },
  },
  globalIgnores([".next/**", "node_modules/**", "data/**", "out/**", "next-env.d.ts"]),
]);

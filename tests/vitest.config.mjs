import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  root: rootDir,
  test: {
    environment: "node",
    include: [
      "server/**/test_logic.ts",
      "client/**/test_logic.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "tests/gates/**"],
  },
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // API 集成测试会访问 Supabase，本机网络抖动时 5s 默认值偏紧。
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});

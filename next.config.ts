import type { NextConfig } from "next";
const config: NextConfig = {
  logging: { serverFunctions: false },
  ...(process.env.IMAGE_QUEUE_PREVIEW_BUILD === "1" ? { distDir: ".next/local-preview" } : {}),
  ...(process.env.IMAGE_QUEUE_PREVIEW_BUILD === "2" ? { distDir: ".next/local-preview-next" } : {}),
  serverExternalPackages: ["sharp", "fs-native-extensions"],
  experimental: { authInterrupts: true, serverActions: { bodySizeLimit: "25mb" } },
};
export default config;

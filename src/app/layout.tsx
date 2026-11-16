import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "image-queue",
  description:
    "A workspace for image generation. Local Codex queue and your own API keys.",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

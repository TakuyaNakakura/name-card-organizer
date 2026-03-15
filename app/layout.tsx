import type { Metadata } from "next";

import "@/app/globals.css";
import { assertPublicDeploymentSafety } from "@/lib/deployment";

export const metadata: Metadata = {
  title: "Name Card Organizer",
  description: "名刺の撮影、OCR 抽出、一覧管理を行う管理アプリ"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  assertPublicDeploymentSafety();

  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

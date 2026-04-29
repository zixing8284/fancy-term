import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Fancy Term CRT Demo",
  description:
    "WebGL retro CRT terminal with an AI chat command. Based on langterm by Ian Langworth.",
  icons: { icon: "/assets/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1.0,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/css/main.css" />
      </head>
      <body className="loading">{children}</body>
    </html>
  );
}

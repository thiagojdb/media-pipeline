import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Relay",
  description: "AI-assisted production for scripted, source-based channels.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

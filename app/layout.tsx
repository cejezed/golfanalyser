import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saguto Swing Analyzer",
  description: "Lokale golf swing analyzer voor video, pose-checkpoints en gerichte practice feedback.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Swing Analyzer",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f6f2"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}

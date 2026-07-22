import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mijn Swingcoach",
  description: "Persoonlijke golf swingcoach voor lokale videoanalyse, lichaamsfeedback en gerichte oefeningen.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mijn Swingcoach",
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

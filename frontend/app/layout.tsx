import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#22c55e",
};

export const metadata: Metadata = {
  title: "Roomi — Democratic Music Queue",
  description:
    "Real-time shared music queue with Spotify. Create a room, share the code, and let everyone vote on what plays next.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Roomi",
  },
  openGraph: {
    title: "Roomi — Democratic Music Queue",
    description:
      "Create a room, share the code, and let everyone vote on what plays next. Powered by Spotify.",
    type: "website",
    siteName: "Roomi",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

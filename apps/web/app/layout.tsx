import "@livekit/components-styles";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "StudioLink",
  description: "Low-latency remote guest platform for live production",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

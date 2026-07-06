import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEHLI",
  description: "A live digital twin command center for City Walk Dubai traffic infrastructure.",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

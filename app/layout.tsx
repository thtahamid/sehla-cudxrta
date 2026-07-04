import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CityWalk Traffic Twin",
  description: "A live digital twin dashboard for City Walk Dubai traffic infrastructure."
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

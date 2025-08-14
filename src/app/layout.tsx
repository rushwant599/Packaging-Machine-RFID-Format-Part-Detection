import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Somic RFID",
  description: "Somic RFID Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

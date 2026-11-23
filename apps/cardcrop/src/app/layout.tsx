import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CardCrop Studio",
  description: "Unified trading-card detect, restore, batch, edit, imagine, and export studio.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

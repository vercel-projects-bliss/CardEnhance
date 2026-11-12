import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CardEnhance",
  description: "CardEnhance rebuild in progress",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

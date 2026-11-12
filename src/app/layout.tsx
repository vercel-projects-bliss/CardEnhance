import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { StudioSettingsProvider } from "@/components/studio-settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CardEnhance",
    template: "%s · CardEnhance",
  },
  description: "Restore and review trading card scans.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-dvh bg-background font-sans text-ink antialiased">
        <StudioSettingsProvider>
          <AppShell>{children}</AppShell>
        </StudioSettingsProvider>
      </body>
    </html>
  );
}

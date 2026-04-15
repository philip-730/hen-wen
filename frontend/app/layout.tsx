import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.woff2",
  variable: "--font-geist-mono",
});

const jetbrainsMono = localFont({
  src: "../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Hen Wen",
  description: "Ask your data anything",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "dark h-full antialiased",
        jetbrainsMono.variable,
        geistMono.variable
      )}
    >
      <body className={cn("min-h-full flex flex-col", jetbrainsMono.className)}>
        {children}
      </body>
    </html>
  );
}

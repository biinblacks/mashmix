import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MashMix — AI Mashup Matcher",
  description:
    "Upload your music folder. MashMix finds which songs mix perfectly together, then generates the mashup for you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#0b0a10] text-[#f2f0ea]">{children}</body>
    </html>
  );
}

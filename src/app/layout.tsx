import type { Metadata } from "next";
import { Geist_Mono, Inter, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lumen — read papers with an AI colleague",
  description: "A PDF reader for research papers with in-context explanations, translation, summaries and chat.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Extensions such as Zotero Connector add attributes to <html> before hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${serif.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}

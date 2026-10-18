import type { NextConfig } from "next";

// `npm run portable` builds with LUMEN_PACK=1: a self-contained server in its own
// folder, so it never touches the `.next` used by `npm run dev` / `npm run build`.
const pack = process.env.LUMEN_PACK === "1";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Hide the Next.js "N" button that `next dev` adds to the page.
  devIndicators: false,
  ...(pack && { output: "standalone", distDir: ".next-pack" }),
  // The Codex backend extracts PDF text on the server with pdf.js (and its worker file).
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: { "/api/**/*": ["./node_modules/pdfjs-dist/legacy/build/*.mjs"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

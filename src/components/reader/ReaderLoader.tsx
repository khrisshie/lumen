"use client";

import dynamic from "next/dynamic";
import { use } from "react";

// pdf.js and IndexedDB are browser-only, so the reader skips SSR.
const Reader = dynamic(() => import("./Reader").then((m) => m.Reader), {
  ssr: false,
  loading: () => <div className="grid h-screen place-items-center text-ink-3">Opening…</div>,
});

export function ReaderLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Reader id={id} />;
}

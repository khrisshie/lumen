import { Suspense } from "react";
import { ReaderLoader } from "@/components/reader/ReaderLoader";

export default function ReadPage({ params }: PageProps<"/read/[id]">) {
  return (
    <Suspense fallback={<div className="grid h-screen place-items-center text-ink-3">Opening…</div>}>
      <ReaderLoader params={params} />
    </Suspense>
  );
}

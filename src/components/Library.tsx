"use client";

import { FileText, Highlighter, Languages, MessagesSquare, ScanSearch, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { addPaper, listPapers, removePaper, type Paper } from "@/lib/store";

const FEATURES = [
  { icon: ScanSearch, title: "Explain in place", body: "Select a sentence, equation or citation and get an explanation that knows the whole paper." },
  { icon: Languages, title: "Translate", body: "Translate a passage or a full page into your language, with terms kept precise." },
  { icon: FileText, title: "Figure explanation", body: "Draw a box around any figure or table to learn how to read it and what it shows." },
  { icon: MessagesSquare, title: "Chat & summary", body: "A structured summary, discussion questions, and a chat grounded in the paper." },
  { icon: Highlighter, title: "Auto highlight", body: "Key claims, methods, results and limitations underlined for you, plus your own notes." },
];

function formatSize(bytes: number) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

function formatDate(ms: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ms);
}

export function Library() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPapers().then(setPapers, () => setPapers([]));
  }, []);

  async function open(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.type !== "application/pdf") return setError("That isn't a PDF. Lumen reads PDF papers.");
    if (file.size > 32 * 1024 * 1024) return setError("PDFs up to 32 MB are supported.");
    const paper = await addPaper(file);
    router.push(`/read/${paper.id}`);
  }

  async function remove(id: string) {
    await removePaper(id);
    setPapers((list) => list?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <span className="text-sm text-ink-3">Your papers stay in this browser</span>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <section className="pt-8 pb-10 sm:pt-14">
          <h1 className="max-w-2xl font-serif text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            Read research papers with a colleague at your side.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-ink-2">
            Open a PDF and ask about any sentence, figure or equation without leaving the page.
          </p>
        </section>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            open(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent/50"
          }`}
        >
          <span className="grid size-12 place-items-center rounded-full bg-accent text-white">
            <Upload size={22} />
          </span>
          <span className="text-base font-medium">Drop a paper here, or click to choose a PDF</span>
          <span className="text-sm text-ink-3">Up to 32 MB · arXiv, conference and journal PDFs</span>
          <input ref={input} type="file" accept="application/pdf" className="sr-only" onChange={(e) => open(e.target.files?.[0])} />
        </label>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <section className="mt-12">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-3 uppercase">Library</h2>
          {papers === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="shimmer h-20 rounded-xl" />
              ))}
            </div>
          ) : papers.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface px-5 py-6 text-ink-2">
              No papers yet. The ones you open will appear here.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {papers.map((p) => (
                <li key={p.id} className="group relative">
                  <Link
                    href={`/read/${p.id}`}
                    className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-accent/40 hover:shadow-sm"
                  >
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
                      <FileText size={18} />
                    </span>
                    <span className="min-w-0 flex-1 pr-8">
                      <span className="line-clamp-2 font-medium">{p.summary?.title || p.name}</span>
                      <span className="mt-1 block text-sm text-ink-3">
                        {[p.numPages && `${p.numPages} pages`, formatSize(p.size), `opened ${formatDate(p.openedAt)}`, p.notes.length > 0 && `${p.notes.length} notes`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                  <button
                    onClick={() => remove(p.id)}
                    aria-label={`Remove ${p.name}`}
                    className="absolute top-3 right-3 rounded-md p-1.5 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:bg-sunken hover:text-danger focus:opacity-100"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon size={20} className="text-accent" />
              <h3 className="mt-2 font-medium">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

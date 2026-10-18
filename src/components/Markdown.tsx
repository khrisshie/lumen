"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// Claude often writes \( \) and \[ \] delimiters; remark-math only knows $ and $$.
function normalizeMath(text: string) {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`);
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`prose-lumen ${streaming ? "is-streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeMath(text)}
      </ReactMarkdown>
      {streaming && !text && <span className="caret text-ink-3">Reading the paper</span>}
    </div>
  );
});

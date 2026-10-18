# Lumen

A PDF reader for research papers with an AI colleague built in.
Open a paper, select anything, and ask, without copying text into a chatbot.

## Setup (3 steps)

1. **Install [Node.js](https://nodejs.org)** (the LTS version).
2. **Install one AI tool and sign in once** in a terminal. Lumen uses your own account.
   - Claude Code ([install](https://claude.com/claude-code)): run `claude`, then type `/login`
   - Codex ([install](https://developers.openai.com/codex)): run `codex login`
   - Gemini, via Google Antigravity ([install](https://antigravity.google)): run `agy` and sign in with Google
3. **Download Lumen and open it:**
   - **Mac:** download [Lumen-mac.zip](https://github.com/khrisshie/lumen/releases/latest/download/Lumen-mac.zip),
     unzip it, and drag **Lumen.app** into your Applications folder. Open it; drag it to the Dock to keep it there.
     If macOS says it can't verify Lumen, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
   - **Windows:** download [Lumen.zip](https://github.com/khrisshie/lumen/releases/latest/download/Lumen.zip),
     unzip it, and double-click `Start Lumen (Windows).bat`.

Lumen opens in a browser window at http://localhost:3939. To stop it, quit Lumen in the Dock (Mac) or close the terminal window (Windows).

## Features

| Feature | How it works |
| --- | --- |
| **Explain** | Select text → *Explain*. Claude sees the whole PDF, so symbols, terms and citations are explained in context. |
| **Translate** | Translate a selection, or a whole page via *Translate page*, into your chosen language. |
| **Figure explanation** | *Figure* → drag a box over a figure, table or equation. The region is re-rendered at high resolution and sent as an image. |
| **Summary** | Structured summary: TL;DR, problem, contributions, method, results, limitations, discussion questions. |
| **Chat** | Multi-turn chat grounded in the paper; *Ask* or *Follow up in chat* attaches the passage you're discussing. |
| **Auto highlight** | Claude picks key sentences (claim / method / result / limitation); they're located in the PDF text and underlined. |
| **Markup & notes** | Four highlight colors; *Note* writes a note on the selected text (marked on the page). Click a highlight to recolor, annotate or remove it; ⌘Z / ⇧⌘Z undo and redo. Jump-to and Markdown export. |
| **Library** | Papers, notes, chat and summaries are stored in the browser (IndexedDB). |

## Run from source (developers)

```bash
npm install
npm run dev                  # http://localhost:3000
```

No API key needed: Lumen uses the first of `claude` (Claude Code), `codex` (Codex) and `agy` (Antigravity, for Gemini)
that's installed. To pick one, set `LUMEN_BACKEND=claude|codex|gemini` in `.env.local`.
To use the Claude API instead, put `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`).

## Share it (portable copy)

```bash
npm run portable             # → dist/Lumen.zip (Mac + Windows scripts) and, on a Mac, dist/Lumen-mac.zip (Lumen.app)
```

Send `dist/Lumen.zip`. Each person unzips it and double-clicks **Start Lumen (Mac).command** or
**Start Lumen (Windows).bat**. They need Node.js 20+ and Claude Code, Codex or Antigravity (Gemini), signed in with their own account
(`README.txt` inside the zip explains this).

- The build goes to `.next-pack/` with `output: "standalone"`; your `.next`, dev server and `~/.lumen` aren't touched.
- The portable copy listens on `127.0.0.1:3939` only and keeps its PDFs in its own `data/` folder.
- `Lumen.app` (`scripts/mac/Lumen.applescript`) bundles the same server, keeps PDFs in `~/Library/Application Support/Lumen`,
  opens Lumen in a new window of the default browser, and stops the server when you quit it.

## Backends

**Claude Code CLI** (default, `src/lib/backend/cli.ts`)

- Uploaded PDFs are saved to `~/.lumen/papers/<sha256>.pdf`.
- The first request for a paper runs `claude -p` once to read the whole PDF into a session (~15-25 s).
  Its id is stored in `~/.lumen/sessions.json`.
- Every later request runs `claude -p --resume <session> --fork-session`, so the paper is already in context
  and cached. Follow-ups take a few seconds, and the primed session never changes.
- Streaming uses `--output-format stream-json --include-partial-messages`; summary and highlights use `--json-schema`.
  Figures are sent as image blocks via `--input-format stream-json`.
- Runs with only the `Read` tool, no hooks, plugins or MCP servers (`--setting-sources project`, `disableAllHooks`, `--strict-mcp-config`).
- It uses your Claude subscription's usage, and it's meant for running Lumen locally for yourself.

**Codex CLI** (`src/lib/backend/codex.ts`, used when Claude Code isn't installed or `LUMEN_BACKEND=codex`)

- Codex can't read PDFs, so the server extracts the text once with pdf.js (`~/.lumen/papers/<sha256>.txt`, with page markers).
- Every request is one ephemeral `codex exec --json --sandbox read-only --ignore-user-config` run with the paper text
  as a stable prompt prefix. Summary and highlights use `--output-schema`; figures are attached with `-i`.
- Codex reports whole messages, so answers appear at once instead of streaming.

**Gemini via Antigravity** (`src/lib/backend/gemini.ts`, `LUMEN_BACKEND=gemini` or when only `agy` is installed)

- Every request is one `agy -p --output-format stream-json` run that opens the PDF with Antigravity's `view_file` tool,
  which reads PDFs natively, figures included. Captured figures are saved to a temp file and opened the same way.
- Headless runs use Antigravity's default permission mode: reading files is allowed; commands and edits are denied.
- Summary and highlights ask for a JSON reply and validate it with Zod (one retry).
- Requests take ~15-35 s, since the paper is read on every request.

**Claude API** (`src/lib/backend/api.ts`, used when `ANTHROPIC_API_KEY` is set)

## How it works

- **Next.js 16** (App Router) + Tailwind v4; **react-pdf** (pdf.js) renders pages lazily with a selectable text layer.
- The PDF is uploaded once to the Claude **Files API** (`/api/upload`); later requests refer to it by `file_id`.
- With either backend, if the server has lost the paper, the browser re-uploads it from IndexedDB and retries.
- Every API request shares the same system prompt and paper `document` block marked with `cache_control`,
  so after the first call the paper is read from the **prompt cache** (1-hour TTL).
- `/api/ask` streams NDJSON (explain, translate, figure, page translation, chat).
  `/api/summary` and `/api/highlights` use **structured outputs** (Zod schemas).
- Model: `claude-opus-5-5` with `effort: low` for quick explanations and translations, `medium` for chat, figures and summaries.
  Server-side refusal fallback (`fallbacks: "default"`) is enabled.

```
src/
  app/api/{upload,ask,summary,highlights}/route.ts   thin routes over the active backend
  lib/prompts.ts     system prompt, task prompts, output schemas (shared by both backends)
  lib/backend/       cli.ts (claude -p), codex.ts (codex exec), gemini.ts (agy -p), api.ts (Anthropic SDK), index.ts (picks one)
  scripts/portable.mjs   builds the shareable zip
  lib/store.ts       IndexedDB library (papers + PDFs)
  lib/api.ts         browser API client (streaming, re-upload on missing file)
  lib/locate.ts      finds model-quoted sentences in the PDF text → highlight rects
  lib/capture.ts     high-res crop of a page region for figure explanation
  components/reader/ PdfView, SelectionMenu, Panel (Assist/Summary/Chat/Notes), Reader
```

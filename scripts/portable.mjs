// Builds a portable copy of Lumen to share: dist/Lumen/ and dist/Lumen.zip
// (start scripts for Mac and Windows), plus, on a Mac, dist/Lumen-mac.zip (Lumen.app).
//
// The build goes to .next-pack (see next.config.ts), so your own `.next`,
// dev server and ~/.lumen are left alone. The portable copy keeps its papers in
// its own data/ folder and listens on 127.0.0.1:3939 only.
import { execSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, ".next-pack");
const out = path.join(root, "dist", "Lumen");
const zip = path.join(root, "dist", "Lumen.zip");
const macApp = path.join(root, "dist", "Lumen.app");
const macZip = path.join(root, "dist", "Lumen-mac.zip");

const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "inherit", ...opts });

// `next build` rewrites these to point at .next-pack; put them back afterwards.
const restore = ["tsconfig.json", "next-env.d.ts"]
  .map((f) => path.join(root, f))
  .filter(existsSync)
  .map((f) => [f, readFileSync(f)]);

console.log("Building…");
try {
  run("npx next build", { env: { ...process.env, LUMEN_PACK: "1", NODE_ENV: "production" } });
} finally {
  for (const [f, content] of restore) writeFileSync(f, content);
}

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
rmSync(macApp, { recursive: true, force: true });
rmSync(macZip, { force: true });

// Standalone server + the static assets and public files it doesn't copy itself.
cpSync(path.join(build, "standalone"), path.join(out, "app"), { recursive: true });
cpSync(path.join(build, "static"), path.join(out, "app", ".next-pack", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(out, "app", "public"), { recursive: true });
// sharp (next/image, unused here) ships native binaries for this machine only.
for (const dir of ["sharp", "@img"]) rmSync(path.join(out, "app", "node_modules", dir), { recursive: true, force: true });
// Never ship local secrets or settings.
for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  rmSync(path.join(out, "app", f), { force: true });
}

const PORT = 3939;

writeFileSync(
  path.join(out, "Start Lumen (Mac).command"),
  `#!/bin/bash
# Double-click to start Lumen, then use it at http://localhost:${PORT}
cd "$(dirname "$0")"

# Lumen uses Claude Code if it's installed, otherwise Codex, otherwise Gemini (Antigravity).
# To choose, remove the "#" in front of one line:
# export LUMEN_BACKEND=claude
# export LUMEN_BACKEND=codex
# export LUMEN_BACKEND=gemini

export LUMEN_DATA_DIR="$PWD/data" PORT=${PORT} HOSTNAME=127.0.0.1

# Run in your login shell so node, claude and codex are found (nvm, Homebrew, ~/.local/bin).
exec "\${SHELL:-/bin/zsh}" -lic '
  if ! command -v node >/dev/null; then
    echo "Lumen needs Node.js 20 or newer: https://nodejs.org"; read -r; exit 1
  fi
  (sleep 2; open "http://localhost:${PORT}") &
  echo "Lumen is running at http://localhost:${PORT}  (close this window to stop it)"
  node app/server.js
'
`,
);
chmodSync(path.join(out, "Start Lumen (Mac).command"), 0o755);

writeFileSync(
  path.join(out, "Start Lumen (Windows).bat"),
  `@echo off
rem Double-click to start Lumen, then use it at http://localhost:${PORT}
cd /d "%~dp0"

rem Lumen uses Claude Code if it's installed, otherwise Codex, otherwise Gemini (Antigravity).
rem To choose, remove the "rem" in front of one line:
rem set LUMEN_BACKEND=claude
rem set LUMEN_BACKEND=codex
rem set LUMEN_BACKEND=gemini

set "LUMEN_DATA_DIR=%~dp0data"
set PORT=${PORT}
set HOSTNAME=127.0.0.1

where node >nul 2>nul
if errorlevel 1 (
  echo Lumen needs Node.js 20 or newer: https://nodejs.org
  pause
  exit /b 1
)
start "" http://localhost:${PORT}
echo Lumen is running at http://localhost:${PORT}  (close this window to stop it)
node app\\server.js
pause
`.replace(/\n/g, "\r\n"),
);

writeFileSync(
  path.join(out, "README.txt"),
  `Lumen: a PDF reader with an AI colleague

You need:
  1. Node.js 20 or newer: https://nodejs.org
  2. Claude Code, Codex or Antigravity (for Gemini), installed and signed in:
     - Claude Code: https://claude.com/claude-code  then run \`claude\` and use /login
     - Codex: https://developers.openai.com/codex  then run \`codex login\`
     - Antigravity: https://antigravity.google  then run \`agy\` and sign in with Google

Start it:
  Mac: double-click "Start Lumen (Mac).command"
       (if macOS blocks it the first time: right-click the file → Open → Open)
  Windows: double-click "Start Lumen (Windows).bat"
  Your browser opens http://localhost:${PORT}. Close the terminal window to stop Lumen.

Notes:
  - AI features use your own Claude Code, Codex or Google (Gemini) account.
  - If several are installed, Lumen uses Claude Code first, then Codex, then Gemini. To choose, open the start file in a text editor and follow the comment.
  - Papers, notes and chats are kept in your browser; PDFs sent to the AI are kept in data/ in this folder.
  - Codex reads the PDF's text only; to ask about a figure, use "Figure" and drag a box over it.
  - Lumen only runs on your computer; nobody else on your network can reach it.
`,
);

console.log("Zipping…");
run(`zip -qry "${zip}" Lumen -x "Lumen/data/*"`, { cwd: path.dirname(out) });

// Lumen.app: an AppleScript launcher with the server inside. Its papers go to
// ~/Library/Application Support/Lumen. Needs macOS tools (osacompile, codesign).
if (process.platform === "darwin") {
  console.log("Building Lumen.app…");
  const mac = path.join(root, "scripts", "mac");
  const contents = path.join(macApp, "Contents");
  const plist = path.join(contents, "Info.plist");
  run(`osacompile -s -o "${macApp}" "${path.join(mac, "Lumen.applescript")}"`);
  cpSync(path.join(out, "app"), path.join(contents, "Resources", "app"), { recursive: true });
  cpSync(path.join(mac, "Lumen.icns"), path.join(contents, "Resources", "applet.icns"));
  rmSync(path.join(contents, "Resources", "Assets.car"), { force: true }); // would override the icon
  for (const cmd of [
    "Delete :CFBundleIconName",
    "Add :CFBundleIdentifier string io.lumen.app",
    "Add :NSAppleEventsUsageDescription string Lumen opens itself in a Safari window.",
  ]) {
    try {
      execSync(`/usr/libexec/PlistBuddy -c "${cmd}" "${plist}"`, { stdio: "ignore" });
    } catch {
      // The key is already absent (Delete) or present (Add).
    }
  }
  run(`codesign --force --deep -s - "${macApp}"`, { stdio: "ignore" });
  run(`ditto -c -k --keepParent "${macApp}" "${macZip}"`);
  // Keep only the zip: a loose Lumen.app here shows up in Launchpad and Spotlight next to the real one.
  rmSync(macApp, { recursive: true, force: true });
}

console.log(`\nDone:\n  ${out}\n  ${zip}${process.platform === "darwin" ? `\n  ${macZip}` : ""}`);

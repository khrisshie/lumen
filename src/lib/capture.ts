"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rect } from "./store";

/** Re-render a page region at high resolution and return it as a PNG data URL. */
export async function captureRegion(pdf: PDFDocumentProxy, pageNumber: number, r: Omit<Rect, "page">): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  // Aim for ~1400px across the crop, without rendering absurdly large pages.
  const scale = Math.min(4, Math.max(1.5, 1400 / (r.w * base.width)));
  const viewport = page.getViewport({ scale });

  const full = document.createElement("canvas");
  full.width = Math.ceil(viewport.width);
  full.height = Math.ceil(viewport.height);
  await page.render({ canvas: full, viewport }).promise;

  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round(r.w * full.width));
  crop.height = Math.max(1, Math.round(r.h * full.height));
  const ctx = crop.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(full, r.x * full.width, r.y * full.height, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop.toDataURL("image/png");
}

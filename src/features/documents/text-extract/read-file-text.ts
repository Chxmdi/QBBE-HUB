/**
 * Reads the words inside a file in the browser, so the library can find it by
 * what it says (#147). Nothing leaves the device for this: a PDF's text layer
 * is read with pdf.js, and a photo or a scanned PDF (one with no text layer)
 * is read with the same pinned Tesseract.js engine receipts use (#175).
 *
 * Like receipt reading, nothing here loads until a file is chosen: pdf.js and
 * Tesseract are dynamic imports, and their workers, WebAssembly and language
 * data come from this app's own origin (/pdf and /ocr), copied out of the
 * pinned npm packages by `scripts/copy-ocr-assets.mjs`.
 *
 * What comes back is used for search only. It is never trusted for anything
 * else: the database stores it apart from the document and nothing reads it
 * to decide access or figures.
 */

import {
  OcrCancelled,
  prepareImage,
  recognizeImages,
  type OcrProgress,
} from "@/features/finance/receipt-ocr/read-receipt";
import { MAX_TEXT_LENGTH, normalizeExtractedText } from "./text";

/** Must equal the installed pdfjs-dist version; a unit test checks it. */
export const PDF_VERSION = "6.3.289";
const PDF_ASSETS = `/pdf/${PDF_VERSION}`;

/** Longest PDF whose text layer is read; long enough for any bylaw or policy. */
const MAX_PDF_PAGES = 300;
/** A scanned PDF is read page by page with OCR; only its first pages. */
const MAX_OCR_PAGES = 5;
/** Below this many letters or digits, a PDF counts as having no text layer. */
const MIN_TEXT_LAYER = 20;
/** Scanned pages are rendered at this width for OCR. */
const OCR_PAGE_WIDTH = 1700;

export type TextSource = "pdf_text" | "ocr";
export type FileText = { text: string; source: TextSource };
export type ReadProgress = OcrProgress;

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp|heic|heif)$/i;

/** Whether this browser-side reader knows how to read the file at all. */
export function canReadFileText(file: Pick<File, "type" | "name">): boolean {
  return isPdf(file) || IMAGE_TYPES.test(file.type);
}

function isPdf(file: Pick<File, "type" | "name">): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Resolves with the file's words and how they were read, or null when the
 * file holds no readable words (or is a type this cannot read). Rejects with
 * OcrCancelled when `signal` aborts.
 */
export async function readFileText(
  file: File,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (p: ReadProgress) => void },
): Promise<FileText | null> {
  const cancelled = () => {
    if (signal.aborted) throw new OcrCancelled();
  };
  onProgress({ stage: "loading", percent: 0 });

  if (IMAGE_TYPES.test(file.type)) {
    const image = await prepareImage(file);
    cancelled();
    const text = normalizeExtractedText(await recognizeImages([image], { signal, onProgress }));
    return text ? { text, source: "ocr" } : null;
  }
  if (!isPdf(file)) return null;

  const pdfjs = await import("pdfjs-dist");
  cancelled();
  // Loaded by path from this origin, so the worker stays under worker-src 'self'.
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_ASSETS}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: `${PDF_ASSETS}/wasm/`,
    // Text extraction needs no web fonts, and not creating them keeps the
    // file's embedded fonts out of the page.
    disableFontFace: true,
    enableXfa: false,
  });
  const stop = () => void task.destroy();
  signal.addEventListener("abort", stop, { once: true });
  try {
    const pdf = await task.promise;
    cancelled();

    // The text layer first.
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const parts: string[] = [];
    for (let n = 1; n <= pages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) parts.push(item.str + (item.hasEOL ? "\n" : " "));
      }
      parts.push("\n\n");
      page.cleanup();
      cancelled();
      onProgress({ stage: "reading", percent: Math.round((n / pages) * 100) });
      if (parts.reduce((length, part) => length + part.length, 0) > MAX_TEXT_LENGTH) break;
    }
    const layer = normalizeExtractedText(parts.join(""));
    if (layer.replace(/[^\p{L}\p{N}]/gu, "").length >= MIN_TEXT_LAYER) {
      return { text: layer, source: "pdf_text" };
    }

    // No text layer: a scan. Render its first pages and read them with OCR.
    onProgress({ stage: "loading", percent: 0 });
    const images: Blob[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_OCR_PAGES); n += 1) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, OCR_PAGE_WIDTH / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: "rgb(255, 255, 255)" }).promise;
      images.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"),
        ),
      );
      page.cleanup();
      cancelled();
    }
    if (!images.length) return null;
    const text = normalizeExtractedText(await recognizeImages(images, { signal, onProgress }));
    return text ? { text, source: "ocr" } : null;
  } finally {
    signal.removeEventListener("abort", stop);
    void task.destroy();
  }
}

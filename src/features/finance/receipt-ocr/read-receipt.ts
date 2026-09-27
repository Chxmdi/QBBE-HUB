/**
 * Reads the text off a receipt photo in the browser, with Tesseract.js
 * (English + French). The photo never leaves the device for this: the OCR
 * engine runs in a web worker on the submitter's own machine.
 *
 * Nothing here is loaded until a photo is chosen: the library is a dynamic
 * import (its own chunk, off the main bundle) and the worker, the WebAssembly
 * core and the language data are fetched from this app's own origin, from
 * files `scripts/copy-ocr-assets.mjs` copies out of the pinned npm packages
 * at install/build time. Nothing is fetched from a CDN.
 */

/** Must equal the installed tesseract.js version; a unit test checks it. */
export const OCR_VERSION = "7.0.0";
const ASSETS = `/ocr/${OCR_VERSION}`;

/** Photos wider or taller than this are scaled down first: faster, same accuracy. */
const MAX_SIDE = 2000;

export type OcrStage = "loading" | "reading";
export type OcrProgress = { stage: OcrStage; percent: number };

export class OcrCancelled extends Error {
  constructor() {
    super("Reading the receipt was stopped.");
  }
}

/**
 * The browser decodes the photo (so it handles whatever formats this browser
 * can show, HEIC on Safari included, and applies the camera's rotation); a
 * scaled-down PNG is what the OCR engine gets.
 */
async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"),
    );
  } finally {
    bitmap.close();
  }
}

/**
 * Resolves with the text read off the photo. Rejects with OcrCancelled when
 * `signal` aborts (the submitter pressed Skip, the dialog closed, or the
 * caller's timeout fired); the worker is terminated either way, so nothing
 * keeps running in the background.
 */
export async function readReceiptText(
  file: File,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (p: OcrProgress) => void },
): Promise<string> {
  const cancelled = () => {
    if (signal.aborted) throw new OcrCancelled();
  };
  onProgress({ stage: "loading", percent: 0 });
  const image = await prepareImage(file);
  cancelled();

  const { createWorker, OEM } = await import("tesseract.js");
  cancelled();

  let terminate: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => {
      terminate?.();
      reject(new OcrCancelled());
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });

  const work = (async () => {
    const worker = await createWorker(["eng", "fra"], OEM.LSTM_ONLY, {
      workerPath: `${ASSETS}/worker.min.js`,
      corePath: `${ASSETS}/core`,
      langPath: `${ASSETS}/lang`,
      // A worker started from a blob: URL would need `worker-src blob:` in
      // the Content-Security-Policy; loading it by path keeps it 'self'.
      workerBlobURL: false,
      // Language data is kept in IndexedDB after the first photo; the
      // versioned key drops it when the library is upgraded.
      cachePath: `qbbe-ocr-${OCR_VERSION}`,
      logger: (m) => {
        if (m.status === "recognizing text") {
          onProgress({ stage: "reading", percent: Math.round(m.progress * 100) });
        } else {
          onProgress({ stage: "loading", percent: Math.round(m.progress * 100) });
        }
      },
    });
    terminate = () => void worker.terminate();
    if (signal.aborted) {
      terminate();
      throw new OcrCancelled();
    }
    try {
      const { data } = await worker.recognize(image);
      return data.text;
    } finally {
      terminate = null;
      void worker.terminate();
    }
  })();
  // Whichever loses the race still settles; neither may surface as an
  // unhandled rejection.
  work.catch(() => undefined);
  aborted.catch(() => undefined);

  return Promise.race([work, aborted]);
}

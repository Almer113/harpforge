// PDF import (browser only; loaded on demand).
//
// Pages with a text layer are read directly. Pages that are pictures — like
// Ultimate Guitar's PDF downloads, which are page screenshots — go through OCR
// (Tesseract). Either way we get positioned words, which pdfLayout turns into
// column-aligned text for the chord-sheet / guitar-tab importers.

import { cleanOcrPage, fixRareChords, itemsToPage, layoutPages, type PosLine, type PosPage, type TextItem } from './pdfLayout';

export type Progress = (message: string, fraction: number) => void;

export interface PdfText {
  text: string;
  pages: number;
  ocrPages: number;
}

const OCR_WIDTH = 1600;

export async function readPdf(bytes: Uint8Array, onProgress: Progress = () => {}): Promise<PdfText> {
  onProgress('Opening PDF…', 0);
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;

  const pages: PosPage[] = [];
  let ocrPages = 0;
  let current = 1;
  let ocr: Awaited<ReturnType<typeof createOcr>> | null = null;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it)) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) });
      }
      const chars = items.reduce((a, it) => a + it.str.trim().length, 0);
      if (chars >= 20) {
        onProgress(`Reading page ${p} of ${doc.numPages}…`, (p - 1) / doc.numPages);
        pages.push(itemsToPage(items, viewport.width, viewport.height));
        continue;
      }
      // No text layer: render and OCR.
      ocrPages++;
      onProgress(`Recognising text on page ${p} of ${doc.numPages}…`, (p - 1) / doc.numPages);
      const scale = OCR_WIDTH / viewport.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      current = p;
      ocr ??= await createOcr((f) => onProgress(`Recognising text on page ${current} of ${doc.numPages}…`, (current - 1 + f) / doc.numPages));
      pages.push(cleanOcrPage(await ocr.page(canvas)));
    }
  } finally {
    await ocr?.done();
    await task.destroy();
  }
  onProgress('Arranging chords and lyrics…', 1);
  return { text: layoutPages(ocrPages ? fixRareChords(pages) : pages), pages: doc.numPages, ocrPages };
}

async function createOcr(onFraction: (f: number) => void) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onFraction(m.progress);
    },
  });
  return {
    async page(canvas: HTMLCanvasElement): Promise<PosPage> {
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const lines: PosLine[] = [];
      for (const b of data.blocks ?? []) {
        for (const para of b.paragraphs) {
          for (const l of para.lines) {
            lines.push({
              y0: l.bbox.y0,
              y1: l.bbox.y1,
              words: l.words.map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, conf: w.confidence })),
            });
          }
        }
      }
      lines.sort((a, b) => a.y0 - b.y0);
      return { lines, width: canvas.width };
    },
    done: () => worker.terminate(),
  };
}

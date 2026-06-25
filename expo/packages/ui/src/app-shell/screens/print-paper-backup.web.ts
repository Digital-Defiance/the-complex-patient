/**
 * Printable HTML for paper backup sheets (web only).
 */

import { buildPaperBackupPrintHtml, type PaperBackupPrintOptions } from './paper-backup-print-html';

export type { PaperBackupPrintOptions };

/** Open the system print dialog for the paper backup sheet (no pop-up window). */
export async function printPaperBackupSheet(options: PaperBackupPrintOptions): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const html = buildPaperBackupPrintHtml(options);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Paper backup print preview');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = iframe.contentDocument ?? frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    iframe.remove();
    throw new Error('Could not prepare the print preview.');
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    iframe.remove();
  };

  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
      throw new Error('Could not open the print dialog.');
    }
  };

  frameWindow.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, 120_000);

  if (frameDoc.readyState === 'complete') {
    triggerPrint();
    return;
  }

  frameWindow.addEventListener('load', triggerPrint, { once: true });
  window.setTimeout(triggerPrint, 400);
}

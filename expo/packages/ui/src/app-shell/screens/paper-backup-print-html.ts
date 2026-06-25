/**
 * Shared print HTML for paper backup sheets (web print dialog + native AirPrint).
 */

import type { PaperBackupTemplate } from '@complex-patient/crypto-engine';

export interface PaperBackupPrintOptions {
  template: PaperBackupTemplate;
  templateText: string;
  qrDataUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a print-ready HTML document for `window.print()` or `expo-print`. */
export function buildPaperBackupPrintHtml({
  template,
  qrDataUrl,
}: PaperBackupPrintOptions): string {
  const wordRows = template.words
    .map((word, index) => {
      const number = String(index + 1).padStart(2, '0');
      return `<div class="word"><span class="num">${number}</span><span class="txt">${escapeHtml(word)}</span></div>`;
    })
    .join('');

  const warnings = template.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join('');

  const labelLine = template.label
    ? `<span><strong>Label:</strong> ${escapeHtml(template.label)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Paper backup — The Complex Patient</title>
  <style>
    @page { margin: 0.5in; }
    * { box-sizing: border-box; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      color: #111;
      margin: 0;
      padding: 12px;
      line-height: 1.3;
      font-size: 11px;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 6px;
      letter-spacing: 0.02em;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      font-size: 10px;
      margin-bottom: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #333;
    }
    .main {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      page-break-inside: avoid;
    }
    .grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px 8px;
      min-width: 0;
    }
    .word {
      border: 1px solid #bbb;
      border-radius: 3px;
      padding: 4px 6px;
      display: flex;
      gap: 6px;
      align-items: baseline;
      background: #fff;
    }
    .num {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 9px;
      color: #666;
      min-width: 2ch;
    }
    .txt {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .sidebar {
      width: 168px;
      flex-shrink: 0;
    }
    .qr-block {
      text-align: center;
      margin-bottom: 10px;
    }
    .qr-block img {
      width: 132px;
      height: 132px;
      border: 1px solid #ccc;
      padding: 4px;
      background: #fff;
    }
    .qr-caption {
      font-size: 9px;
      color: #444;
      margin: 4px 0 0;
    }
    .warnings {
      border-top: 1px solid #8a1f1f;
      padding-top: 8px;
      font-size: 9px;
      color: #663333;
    }
    .warnings h2 {
      font-size: 10px;
      margin: 0 0 4px;
      color: #8a1f1f;
    }
    .warnings ul {
      margin: 0;
      padding-left: 14px;
    }
    .warnings li {
      margin-bottom: 2px;
    }
    .instructions {
      font-size: 9px;
      margin-top: 6px;
      color: #333;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>The Complex Patient — Paper Backup Key</h1>
  <div class="meta-row">
    <span><strong>Backup ID:</strong> ${escapeHtml(template.backupId)}</span>
    ${labelLine}
    <span><strong>Created:</strong> ${escapeHtml(template.createdAt.toISOString())}</span>
  </div>

  <div class="main">
    <div class="grid" aria-label="Recovery words">
      ${wordRows}
    </div>

    <aside class="sidebar">
      <div class="qr-block">
        <img src="${escapeHtml(qrDataUrl)}" alt="Paper backup QR code" />
        <p class="qr-caption">Scan to recover</p>
      </div>

      <div class="warnings">
        <h2>Warnings</h2>
        <ul>${warnings}</ul>
        <p class="instructions">${escapeHtml(template.instructions)}</p>
      </div>
    </aside>
  </div>
</body>
</html>`;
}

import { describe, expect, it } from 'vitest';
import type { PaperBackupTemplate } from '@complex-patient/crypto-engine';
import { buildPaperBackupPrintHtml } from './paper-backup-print-html';

describe('buildPaperBackupPrintHtml', () => {
  it('includes backup metadata, words, and QR image', () => {
    const template: PaperBackupTemplate = {
      backupId: '11111111-1111-4111-8111-111111111111',
      label: 'Home safe',
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      words: Array.from({ length: 24 }, (_, index) => `word${index + 1}`),
      instructions: 'Store offline.',
      warnings: ['Do not photograph'],
    };

    const html = buildPaperBackupPrintHtml({
      template,
      templateText: 'plain text copy',
      qrDataUrl: 'data:image/svg+xml,<svg></svg>',
    });

    expect(html).toContain('Paper Backup Key');
    expect(html).toContain(template.backupId);
    expect(html).toContain('Home safe');
    expect(html).toContain('word12');
    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain('Store offline.');
    expect(html).toContain('grid-template-columns: repeat(3, 1fr)');
    expect(html).not.toContain('page-break-before');
    expect(html).not.toContain('plain text copy');
    expect(html).toContain('@media print');
  });
});

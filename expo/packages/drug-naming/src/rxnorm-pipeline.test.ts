import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = dirname(fileURLToPath(import.meta.url));
const expoRoot = join(packageDir, '../../..');

describe('rxnorm csv import pipeline', () => {
  it('imports sample csv and validates through build-rxnorm-db', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rxnorm-pipeline-'));
    const outputPath = join(tempDir, 'catalog.json');

    try {
      execSync(
        `node scripts/rxnorm-import-csv.mjs --dir scripts/fixtures/rxnorm-sample --output ${outputPath} --version pipeline-test`,
        { cwd: expoRoot, stdio: 'pipe' },
      );
      execSync(`node scripts/build-rxnorm-db.mjs --input ${outputPath} --dry-run`, {
        cwd: expoRoot,
        stdio: 'pipe',
      });

      const catalog = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        version: string;
        concepts: Array<{ rxcui: string; displayName: string }>;
        ndcMap: Record<string, string>;
        classes: Record<string, string>;
      };

      expect(catalog.version).toBe('pipeline-test');
      expect(catalog.concepts).toHaveLength(3);
      expect(catalog.concepts.map((concept) => concept.displayName)).toContain('Ibuprofen');
      expect(catalog.ndcMap['00573015070']).toBe('5640');
      expect(catalog.classes.NSAID).toBe('Nonsteroidal anti-inflammatory drug');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

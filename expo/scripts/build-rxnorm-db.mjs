#!/usr/bin/env node
/**
 * Build or merge the on-device RxNorm catalog JSON.
 *
 * Usage:
 *   node scripts/build-rxnorm-db.mjs
 *   node scripts/build-rxnorm-db.mjs --input ./path/to/custom-catalog.json
 *   node scripts/build-rxnorm-db.mjs --input ./path/to/custom-catalog.json --dry-run
 *
 * With no --input, validates the bundled seed catalog in packages/drug-naming/data/.
 *
 * To produce a full catalog from RxNorm:
 * 1. Register at https://www.nlm.nih.gov/research/umls/rxnorm/docs/index.html
 * 2. Export or transform RxNorm + RxClass rows into the DrugNamingCatalog schema
 * 3. Pass the file with --input
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(__dirname, '../packages/drug-naming/data/rxnorm-catalog.json');

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  const dryRun = argv.includes('--dry-run');
  return {
    input: inputIndex >= 0 ? argv[inputIndex + 1] : null,
    dryRun,
  };
}

function validateCatalog(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Catalog must be a JSON object');
  }
  if (typeof raw.version !== 'string' || !raw.version.trim()) {
    throw new Error('Catalog.version is required');
  }
  if (!Array.isArray(raw.concepts) || raw.concepts.length === 0) {
    throw new Error('Catalog.concepts must be a non-empty array');
  }
  for (const concept of raw.concepts) {
    for (const field of ['rxcui', 'displayName', 'ingredientRxcui', 'ingredientName']) {
      if (typeof concept[field] !== 'string' || !concept[field].trim()) {
        throw new Error(`Concept missing ${field}`);
      }
    }
    if (!Array.isArray(concept.synonyms)) {
      throw new Error(`Concept ${concept.rxcui} missing synonyms array`);
    }
    if (!Array.isArray(concept.classIds)) {
      throw new Error(`Concept ${concept.rxcui} missing classIds array`);
    }
  }
  if (!raw.classes || typeof raw.classes !== 'object') {
    throw new Error('Catalog.classes is required');
  }
  if (!raw.ndcMap || typeof raw.ndcMap !== 'object') {
    throw new Error('Catalog.ndcMap is required');
  }
}

const { input, dryRun } = parseArgs(process.argv.slice(2));

let catalog;
if (input) {
  catalog = JSON.parse(readFileSync(input, 'utf8'));
  validateCatalog(catalog);
  if (dryRun) {
    console.log(`Validated ${catalog.concepts.length} concepts from ${input} (dry run — catalog not written)`);
  } else {
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${catalog.concepts.length} concepts to ${catalogPath}`);
  }
} else {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  validateCatalog(catalog);
  console.log(`Validated seed catalog ${catalog.version} (${catalog.concepts.length} concepts)`);
}

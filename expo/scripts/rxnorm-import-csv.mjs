#!/usr/bin/env node
/**
 * Import RxNorm-style CSV extracts into DrugNamingCatalog JSON.
 *
 * Expected files (pass a directory with --dir):
 *   concepts.csv  — rxcui,displayName,ingredientRxcui,ingredientName,synonyms,classIds
 *   classes.csv   — classId,label
 *   ndc.csv       — ndc,rxcui
 *
 * Synonyms and classIds use pipe (|) separators within a cell.
 * Header row required. Fields may be quoted when they contain commas.
 *
 * Usage:
 *   node scripts/rxnorm-import-csv.mjs --dir ./scripts/fixtures/rxnorm-sample
 *   node scripts/rxnorm-import-csv.mjs --dir ./my-export --output ./custom-catalog.json
 *   yarn build:rxnorm-db --input ./custom-catalog.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultOutput = join(__dirname, '../packages/drug-naming/data/rxnorm-catalog.json');

function parseArgs(argv) {
  const dirIndex = argv.indexOf('--dir');
  const outputIndex = argv.indexOf('--output');
  const versionIndex = argv.indexOf('--version');
  return {
    dir: dirIndex >= 0 ? argv[dirIndex + 1] : null,
    output: outputIndex >= 0 ? argv[outputIndex + 1] : defaultOutput,
    version: versionIndex >= 0 ? argv[versionIndex + 1] : null,
  };
}

/** Minimal RFC-4180-style CSV row parser. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || (char === '\r' && next === '\n')) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (char === '\r') {
        i += 1;
      }
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function readCsvTable(filePath) {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(raw).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) {
    throw new Error(`CSV file is empty: ${filePath}`);
  }
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

function splitPipeList(value) {
  if (!value) {
    return [];
  }
  return value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeNdcDigits(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) {
    return `0${digits}`;
  }
  if (digits.length === 11) {
    return digits;
  }
  return null;
}

function buildCatalog({ dir, version }) {
  const conceptsPath = join(dir, 'concepts.csv');
  const classesPath = join(dir, 'classes.csv');
  const ndcPath = join(dir, 'ndc.csv');

  const conceptRows = readCsvTable(conceptsPath);
  const classRows = readCsvTable(classesPath);
  const ndcRows = readCsvTable(ndcPath);

  const classes = {};
  for (const row of classRows) {
    if (!row.classId || !row.label) {
      throw new Error('classes.csv rows require classId and label');
    }
    classes[row.classId] = row.label;
  }

  const concepts = conceptRows.map((row) => {
    for (const field of ['rxcui', 'displayName', 'ingredientRxcui', 'ingredientName']) {
      if (!row[field]) {
        throw new Error(`concepts.csv row missing ${field}`);
      }
    }
    return {
      rxcui: row.rxcui,
      displayName: row.displayName,
      ingredientRxcui: row.ingredientRxcui,
      ingredientName: row.ingredientName,
      synonyms: splitPipeList(row.synonyms ?? ''),
      classIds: splitPipeList(row.classIds ?? ''),
    };
  });

  const ndcMap = {};
  for (const row of ndcRows) {
    if (!row.ndc || !row.rxcui) {
      throw new Error('ndc.csv rows require ndc and rxcui');
    }
    const normalized = normalizeNdcDigits(row.ndc);
    if (!normalized) {
      throw new Error(`Invalid NDC in ndc.csv: ${row.ndc}`);
    }
    ndcMap[normalized] = row.rxcui;
  }

  const catalogVersion =
    version ??
    `rxnorm-import-${new Date().toISOString().slice(0, 10)}-${concepts.length}c`;

  return {
    version: catalogVersion,
    attribution:
      'RxNorm / RxClass subset (NIH). Imported via scripts/rxnorm-import-csv.mjs from UMLS-licensed extracts.',
    concepts,
    ndcMap,
    classes,
  };
}

const { dir, output, version } = parseArgs(process.argv.slice(2));

if (!dir) {
  console.error('Usage: node scripts/rxnorm-import-csv.mjs --dir <csv-directory> [--output path] [--version label]');
  process.exit(1);
}

const resolvedDir = resolve(dir);
const catalog = buildCatalog({ dir: resolvedDir, version });
const outputPath = resolve(output);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Wrote ${catalog.concepts.length} concepts to ${outputPath}`);
console.log(`Next: yarn build:rxnorm-db --input ${outputPath}`);

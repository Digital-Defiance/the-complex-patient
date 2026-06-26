#!/usr/bin/env node
/**
 * Enrich the bundled seed catalog from RxNorm RRF files → CSV import format.
 *
 * Reads ingredient RxCUIs from the seed catalog, pulls RxNorm brand synonyms and
 * NDCs from RRF, and writes concepts.csv / classes.csv / ndc.csv for
 * rxnorm-import-csv.mjs.
 *
 * Usage:
 *   node scripts/rxnorm-rrf-to-csv.mjs
 *   node scripts/rxnorm-rrf-to-csv.mjs \
 *     --rrf-dir ../../thecomplexpatient.com/rxnorm/rrf \
 *     --out-dir ../../thecomplexpatient.com/rxnorm/export-csv
 *
 * Then:
 *   yarn import:rxnorm-csv --dir ../../thecomplexpatient.com/rxnorm/export-csv --output ./tmp/catalog.json
 *   yarn build:rxnorm-db --input ./tmp/catalog.json
 */

import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const expoRoot = join(__dirname, '..');
const defaultSeed = join(expoRoot, 'packages/drug-naming/data/rxnorm-catalog.json');
const defaultRrfDir = join(expoRoot, '../../thecomplexpatient.com/rxnorm/rrf');
const defaultOutDir = join(expoRoot, '../../thecomplexpatient.com/rxnorm/export-csv');

const MAX_SYNONYMS = 48;
const MAX_NDCS_PER_INGREDIENT = 24;

function parseArgs(argv) {
  const get = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    rrfDir: get('--rrf-dir') ?? defaultRrfDir,
    outDir: get('--out-dir') ?? defaultOutDir,
    seed: get('--seed') ?? defaultSeed,
    version: get('--version'),
  };
}

function splitRrf(line) {
  return line.split('|');
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

function titleCase(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function uniquePush(set, value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  const key = trimmed.toLowerCase();
  if (!set.has(key)) {
    set.add(key);
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function readRrfLines(filePath, onLine) {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    onLine(splitRrf(line));
  }
}

function loadSeed(seedPath) {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  if (!Array.isArray(seed.concepts) || seed.concepts.length === 0) {
    throw new Error(`Seed catalog has no concepts: ${seedPath}`);
  }
  return seed;
}

async function buildIndexes(rrfDir, ingredientSet) {
  const tradenameByIngredient = new Map();
  const productToIngredient = new Map();
  const consoByRxcui = new Map();

  const rxnrelPath = join(rrfDir, 'RXNREL.RRF');
  const rxnconsoPath = join(rrfDir, 'RXNCONSO.RRF');

  await readRrfLines(rxnrelPath, (fields) => {
    const sab = fields[10];
    if (sab !== 'RXNORM') {
      return;
    }
    const rela = fields[7];
    const rxcui1 = fields[0];
    const rxcui2 = fields[4];
    if (!rxcui1 || !rxcui2) {
      return;
    }

    if (rela === 'tradename_of' && ingredientSet.has(rxcui1)) {
      const brands = tradenameByIngredient.get(rxcui1) ?? new Set();
      brands.add(rxcui2);
      tradenameByIngredient.set(rxcui1, brands);
    }

    if (rela === 'has_ingredient' && ingredientSet.has(rxcui1)) {
      productToIngredient.set(rxcui2, rxcui1);
    }
  });

  await readRrfLines(rxnconsoPath, (fields) => {
    const sab = fields[11];
    if (sab !== 'RXNORM') {
      return;
    }
    const suppress = fields[16];
    if (suppress && suppress !== 'N') {
      return;
    }
    const rxcui = fields[0];
    const tty = fields[12];
    const str = fields[14]?.trim();
    if (!rxcui || !str) {
      return;
    }
    const existing = consoByRxcui.get(rxcui) ?? [];
    existing.push({ tty, str });
    consoByRxcui.set(rxcui, existing);
  });

  return { tradenameByIngredient, productToIngredient, consoByRxcui };
}

function pickDisplayName(ingredientRxcui, seedConcept, consoByRxcui) {
  if (seedConcept.displayName?.trim()) {
    return seedConcept.displayName.trim();
  }
  const rows = consoByRxcui.get(ingredientRxcui) ?? [];
  const ingredient = rows.find((row) => row.tty === 'IN' || row.tty === 'PIN');
  return titleCase(ingredient?.str ?? seedConcept.ingredientName ?? '');
}

function collectSynonyms(ingredientRxcui, seedConcept, tradenameByIngredient, consoByRxcui) {
  const seen = new Set();
  const synonyms = [];

  const push = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    synonyms.push(trimmed);
  };

  for (const synonym of seedConcept.synonyms ?? []) {
    push(synonym);
  }

  const ingredientRows = consoByRxcui.get(ingredientRxcui) ?? [];
  for (const row of ingredientRows) {
    if (row.tty === 'IN' || row.tty === 'PIN' || row.tty === 'SY') {
      push(row.str);
    }
  }

  for (const brandRxcui of tradenameByIngredient.get(ingredientRxcui) ?? []) {
    const brandRows = consoByRxcui.get(brandRxcui) ?? [];
    for (const row of brandRows) {
      if (row.tty === 'BN' || row.tty === 'SBD' || row.tty === 'SBDC') {
        push(row.str);
      }
    }
  }

  return synonyms.slice(0, MAX_SYNONYMS);
}

async function collectNdcMap(rrfDir, productToIngredient, seedNdcMap) {
  const ndcMap = { ...seedNdcMap };
  const counts = new Map();

  for (const ingredient of Object.values(ndcMap)) {
    counts.set(ingredient, (counts.get(ingredient) ?? 0) + 1);
  }

  const rxnsatPath = join(rrfDir, 'RXNSAT.RRF');
  await readRrfLines(rxnsatPath, (fields) => {
    const atn = fields[8];
    if (atn !== 'NDC') {
      return;
    }
    const sab = fields[9];
    if (sab !== 'RXNORM') {
      return;
    }
    const productRxcui = fields[0];
    const ingredientRxcui = productToIngredient.get(productRxcui);
    if (!ingredientRxcui) {
      return;
    }
    if ((counts.get(ingredientRxcui) ?? 0) >= MAX_NDCS_PER_INGREDIENT) {
      return;
    }
    const normalized = normalizeNdcDigits(fields[10] ?? '');
    if (!normalized || ndcMap[normalized]) {
      return;
    }
    ndcMap[normalized] = ingredientRxcui;
    counts.set(ingredientRxcui, (counts.get(ingredientRxcui) ?? 0) + 1);
  });

  return ndcMap;
}

function writeCsvTables({ outDir, concepts, classes, ndcMap }) {
  mkdirSync(outDir, { recursive: true });

  const conceptHeader = 'rxcui,displayName,ingredientRxcui,ingredientName,synonyms,classIds\n';
  const conceptBody = concepts
    .map((concept) =>
      [
        concept.rxcui,
        concept.displayName,
        concept.ingredientRxcui,
        concept.ingredientName,
        concept.synonyms.join('|'),
        concept.classIds.join('|'),
      ]
        .map(csvEscape)
        .join(','),
    )
    .join('\n');
  writeFileSync(join(outDir, 'concepts.csv'), `${conceptHeader}${conceptBody}\n`, 'utf8');

  const classHeader = 'classId,label\n';
  const classBody = Object.entries(classes)
    .map(([classId, label]) => `${csvEscape(classId)},${csvEscape(label)}`)
    .join('\n');
  writeFileSync(join(outDir, 'classes.csv'), `${classHeader}${classBody}\n`, 'utf8');

  const ndcHeader = 'ndc,rxcui\n';
  const ndcBody = Object.entries(ndcMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ndc, rxcui]) => `${csvEscape(ndc)},${csvEscape(rxcui)}`)
    .join('\n');
  writeFileSync(join(outDir, 'ndc.csv'), `${ndcHeader}${ndcBody}\n`, 'utf8');
}

async function main() {
  const { rrfDir, outDir, seed, version } = parseArgs(process.argv.slice(2));
  const resolvedRrf = resolve(rrfDir);
  const resolvedOut = resolve(outDir);
  const resolvedSeed = resolve(seed);

  const seedCatalog = loadSeed(resolvedSeed);
  const ingredientSet = new Set(seedCatalog.concepts.map((concept) => concept.rxcui));

  console.log(`Seed: ${resolvedSeed} (${ingredientSet.size} ingredients)`);
  console.log(`RRF:  ${resolvedRrf}`);
  console.log(`Out:  ${resolvedOut}`);

  const { tradenameByIngredient, productToIngredient, consoByRxcui } = await buildIndexes(
    resolvedRrf,
    ingredientSet,
  );

  const concepts = seedCatalog.concepts.map((seedConcept) => {
    const ingredientRxcui = seedConcept.ingredientRxcui ?? seedConcept.rxcui;
    const displayName = pickDisplayName(ingredientRxcui, seedConcept, consoByRxcui);
    const ingredientName = seedConcept.ingredientName?.trim() || displayName;
    return {
      rxcui: seedConcept.rxcui,
      displayName,
      ingredientRxcui,
      ingredientName,
      synonyms: collectSynonyms(
        ingredientRxcui,
        seedConcept,
        tradenameByIngredient,
        consoByRxcui,
      ),
      classIds: [...(seedConcept.classIds ?? [])],
    };
  });

  const ndcMap = await collectNdcMap(resolvedRrf, productToIngredient, seedCatalog.ndcMap ?? {});

  writeCsvTables({
    outDir: resolvedOut,
    concepts,
    classes: seedCatalog.classes ?? {},
    ndcMap,
  });

  const catalogVersion =
    version ?? `rxnorm-rrf-${new Date().toISOString().slice(0, 10)}-${concepts.length}c`;

  console.log(`Wrote ${concepts.length} concepts, ${Object.keys(ndcMap).length} NDCs`);
  console.log(`CSV directory: ${resolvedOut}`);
  console.log(
    `Next: yarn import:rxnorm-csv --dir ${resolvedOut} --output ./tmp/catalog.json --version ${catalogVersion}`,
  );
  console.log(`Then: yarn build:rxnorm-db --input ./tmp/catalog.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

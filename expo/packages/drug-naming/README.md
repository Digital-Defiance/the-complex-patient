# @complex-patient/drug-naming

On-device drug **naming and grouping** for Complex Patient. This is **not** a clinical interaction checker — it helps users organize medications using RxNorm-style identity and RxClass-style therapeutic classes.

## Principles

- **Identify and organize; never adjudicate** — no severity grades or safe/unsafe verdicts.
- **User-confirmed matches only** — automated notices run after the user confirms a suggested RxNorm match.
- **On-device** — the catalog ships in the app bundle; medication lists are not sent to the server for naming checks.

## Package layout

| Path | Purpose |
|------|---------|
| `data/rxnorm-catalog.json` | Bundled catalog (seed or full extract) |
| `src/matcher.ts` | Fuzzy match, type-ahead, NDC lookup |
| `src/overlap.ts` | Duplicate-ingredient and same-class notices |
| `src/copy.ts` | Disclaimer and informational notice text |

## Updating the catalog

Your RxNorm full files live at **`/Volumes/Code/thecomplexpatient.com/rxnorm/`** (sibling of this repo). The app does not read RRF directly — run the pipeline below.

### One-command pipeline (seed meds + your RRF)

```bash
cd expo
yarn rxnorm:build-from-rrf
yarn test:drug-naming
npx expo run:ios   # rebuild to ship new catalog
```

This will:

1. Read `../../thecomplexpatient.com/rxnorm/rrf/*.RRF`
2. Write **`../../thecomplexpatient.com/rxnorm/export-csv/`** (`concepts.csv`, `classes.csv`, `ndc.csv`)
3. Build `tmp/rxnorm-catalog.json` and install into `data/rxnorm-catalog.json`

### Step by step

```bash
cd expo

# 1. RRF → CSV (creates export-csv/ next to your rrf/ folder)
yarn rxnorm:rrf-to-csv

# 2. CSV → JSON
yarn import:rxnorm-csv \
  --dir ../../thecomplexpatient.com/rxnorm/export-csv \
  --output ./tmp/rxnorm-catalog.json \
  --version rxnorm-06012026

# 3. JSON → bundled catalog
yarn build:rxnorm-db --input ./tmp/rxnorm-catalog.json
```

Override paths:

```bash
yarn rxnorm:rrf-to-csv \
  --rrf-dir /Volumes/Code/thecomplexpatient.com/rxnorm/rrf \
  --out-dir /Volumes/Code/thecomplexpatient.com/rxnorm/export-csv
```

The CSV directory is **created by step 1** — it is not in the NLM zip.

### Manual / sample only

```bash
yarn import:rxnorm-csv --dir ./scripts/fixtures/rxnorm-sample --output ./tmp/catalog.json
yarn build:rxnorm-db --input ./tmp/catalog.json
```

Without `--input`, `build:rxnorm-db` validates the bundled seed catalog only.

1. Register for [UMLS](https://www.nlm.nih.gov/research/umls/) (required for RxNorm redistribution).
2. Keep raw `RxNorm_full_*.zip` and `rrf/` **outside** this git repo (already under `thecomplexpatient.com/rxnorm/`).

## Kill switch

Set `DRUG_NAMING_ASSIST_ENABLED = false` in `src/config.ts` to disable all naming UI without removing the package.

## Tests

```bash
yarn test:drug-naming
```

Or:

```bash
yarn vitest run packages/drug-naming
```

## Manual QA

See [QA.md](./QA.md) for device and export spot-checks before release.

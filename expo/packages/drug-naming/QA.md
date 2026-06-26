# Drug naming — manual QA checklist

Run on **iOS or Android device** (barcode scan) plus **web** (manual product code). Unlock the vault first.

## Add medication — name match

- [ ] Open **Medications → Add medication**
- [ ] Disclaimer appears at top (“informational only”, no interaction checker language)
- [ ] Type `Advil` — type-ahead suggests **Ibuprofen**
- [ ] Confirm panel appears: Yes / No / Not sure
- [ ] Tap **Yes** — panel shows “Stored as: Ibuprofen”
- [ ] Save — return to cabinet; row shows **Stored as: Ibuprofen**
- [ ] Tap **No** on a fresh entry — row shows unidentified note (no generic stored)

## Edit medication — re-confirm

- [ ] Edit a confirmed **Advil** entry
- [ ] Change drug name to `Motrin` — confirm panel reappears; prior RxCUI cleared
- [ ] Change name back to `Advil` without saving — confirm panel shows again if needed
- [ ] Change product code — confirm panel resets

## Barcode / NDC

- [ ] **Native:** Tap **Scan** on product code field; camera permission prompt works
- [ ] Scan ibuprofen NDC (`00573-0150-70` or package barcode) — code fills; empty drug name auto-fills **Ibuprofen**
- [ ] **Web:** Scan button hidden or shows fallback; manual NDC entry still resolves and prompts confirm

## Overlap notices (confirmed meds only)

- [ ] Add **Advil** and **Motrin**, confirm both as Ibuprofen
- [ ] Cabinet / Today / Hub shows **duplicate ingredient** notice (informational wording only)
- [ ] Add **Advil** + **Aleve** (confirmed) — **same class** notice appears
- [ ] Unconfirmed meds do **not** trigger notices

## Export & report

- [ ] **Vault → Export** — markdown summary shows `Advil (naming database: Ibuprofen)` and `RxCUI` line
- [ ] Unzip export JSON — `MedicationStatement` has RxNorm `coding` for confirmed match only
- [ ] **Insights → Physician report** — active med line includes generic + RxCUI annotation
- [ ] Re-import export zip — confirmed Rx fields round-trip on medication

## Settings

- [ ] **Vault settings → Drug naming assistance** — dataset version, attribution, on-device disclaimer

## Kill switch (dev only)

- [ ] Set `DRUG_NAMING_ASSIST_ENABLED = false` in `src/config.ts`, rebuild — no disclaimer, scan, confirm panel, or notices

## Liability spot-check

- [ ] No “safe/unsafe”, severity grades, or “do not take together” language anywhere
- [ ] Notices say “naming database” / informational framing only

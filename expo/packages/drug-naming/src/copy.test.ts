import { describe, expect, it } from 'vitest';
import {
  MEDICATION_NAMING_DISCLAIMER,
  RX_MATCH_CONFIRM_PROMPT,
  UNIDENTIFIED_MEDICATION_NOTE,
} from './copy';
import { DRUG_NAMING_ASSIST_ENABLED } from './config';

describe('drug-naming copy — liability posture', () => {
  it('keeps assist enabled by default', () => {
    expect(DRUG_NAMING_ASSIST_ENABLED).toBe(true);
  });

  it('uses informational disclaimer language only', () => {
    const combined = [
      MEDICATION_NAMING_DISCLAIMER,
      UNIDENTIFIED_MEDICATION_NOTE,
      RX_MATCH_CONFIRM_PROMPT('Ibuprofen', 'Advil'),
    ].join(' ').toLowerCase();

    for (const forbidden of [
      'safe to take',
      'unsafe',
      'do not take',
      'contraindicated',
      'severity',
      'interaction checker',
    ]) {
      expect(combined).not.toContain(forbidden);
    }

    expect(MEDICATION_NAMING_DISCLAIMER.toLowerCase()).toContain('not medical advice');
    expect(RX_MATCH_CONFIRM_PROMPT('Ibuprofen', 'Advil')).toContain('Ibuprofen');
  });
});

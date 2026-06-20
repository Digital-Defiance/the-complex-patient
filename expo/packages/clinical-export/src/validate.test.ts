/**
 * Export/import validation unit tests.
 */

import { describe, expect, it } from 'vitest';
import { validateExportPasswords, validateImportPassword } from './validate';

describe('validateExportPasswords', () => {
  it('requires consent, password, and matching confirmation', () => {
    expect(validateExportPasswords(false, 'secret', 'secret')).toBe('Consent is required before export.');
    expect(validateExportPasswords(true, '   ', '   ')).toBe('Enter a zip password.');
    expect(validateExportPasswords(true, 'secret', 'other')).toBe('Zip passwords do not match.');
    expect(validateExportPasswords(true, 'secret', 'secret')).toBeNull();
  });
});

describe('validateImportPassword', () => {
  it('requires a non-empty zip password', () => {
    expect(validateImportPassword('')).toBe('Enter the zip password for this export file.');
    expect(validateImportPassword('export-password')).toBeNull();
  });
});

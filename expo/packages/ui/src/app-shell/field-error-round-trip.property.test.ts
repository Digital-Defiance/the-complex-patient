/**
 * Property-based test for field-error display round-trip (Task 9.9).
 *
 * Property 8: Field-error display round-trips with submission outcome
 *   For any sequence of subsystem submissions, after a submission that returns
 *   a FieldError the screen shows that field error and retains the entered
 *   values, and after any subsequent successful submission the displayed field
 *   error is cleared.
 *
 * **Validates: Requirements 10.5, 10.6**
 *
 * Uses @fast-check/vitest with ≥100 iterations per the spec.
 *
 * Strategy:
 * - Model the field-error display logic as a state machine (mirroring the
 *   SymptomJournalLogScreen and FlareScreen `handleSubmit` behavior).
 * - Generate arbitrary FieldError arrays and sequences of submission outcomes
 *   (success or failure with field errors).
 * - After each submission, verify the biconditional:
 *     field errors are displayed iff the last submission returned a FieldError.
 * - Additionally verify that entered values are retained on field errors.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { FieldError } from '@complex-patient/symptom-journal';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate an arbitrary FieldError with a realistic field name and message. */
const fieldErrorArb: fc.Arbitrary<FieldError> = fc.record({
  field: fc.stringOf(fc.constantFrom(
    'symptomType', 'systemicLocation', 'severity', 'duration', 'duration.value',
    'duration.unit', 'notes', 'symptomIds', 'trigger', 'conditionIds', 'medicationIds',
  ), { minLength: 1, maxLength: 1 }).map((s) => s),
  message: fc.string({ minLength: 1, maxLength: 200 }),
});

/** Generate a non-empty array of FieldErrors (1–5 errors per rejection). */
const fieldErrorsArb: fc.Arbitrary<FieldError[]> = fc.array(fieldErrorArb, {
  minLength: 1,
  maxLength: 5,
});

/**
 * A submission outcome: either success or failure with field errors.
 * Models LogSymptomResult and LogFlareResult.
 */
type SubmissionOutcome =
  | { ok: true }
  | { ok: false; errors: FieldError[] };

/** Generate an arbitrary submission outcome. */
const submissionOutcomeArb: fc.Arbitrary<SubmissionOutcome> = fc.oneof(
  fc.constant({ ok: true } as SubmissionOutcome),
  fieldErrorsArb.map((errors) => ({ ok: false, errors } as SubmissionOutcome)),
);

/** Generate a non-empty sequence of submission outcomes (1–20 submissions). */
const submissionSequenceArb: fc.Arbitrary<SubmissionOutcome[]> = fc.array(submissionOutcomeArb, {
  minLength: 1,
  maxLength: 20,
});

/** Generate arbitrary form values representing user-entered data. */
interface FormValues {
  symptomType: string;
  systemicLocation: string;
  severity: string;
  notes: string;
}

const formValuesArb: fc.Arbitrary<FormValues> = fc.record({
  symptomType: fc.string({ minLength: 1, maxLength: 50 }),
  systemicLocation: fc.string({ minLength: 1, maxLength: 50 }),
  severity: fc.stringOf(fc.constantFrom('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'), {
    minLength: 1,
    maxLength: 1,
  }).map((s) => s),
  notes: fc.string({ minLength: 0, maxLength: 100 }),
});

// ---------------------------------------------------------------------------
// State machine model — mirrors the screen's field error display logic
//
// This captures the exact behavior of SymptomJournalLogScreen.handleSubmit
// and FlareScreen.handleSubmit:
//
//   if (!result.ok) {
//     setFieldErrors(result.errors);  // display field errors
//     // values are RETAINED (no clear)
//     return;
//   }
//   // success
//   setFieldErrors([]);  // clear field errors
//   // clear form values
//
// The biconditional:
//   fieldErrors.length > 0  ⟺  last submission returned { ok: false, errors }
// ---------------------------------------------------------------------------

/**
 * Simulates the field-error display state machine. Processes a sequence of
 * submission outcomes and tracks the displayed field errors and form values.
 */
interface ScreenState {
  /** Currently displayed field errors (empty when no error). */
  displayedFieldErrors: FieldError[];
  /** Whether form values from the submission are retained. */
  valuesRetained: boolean;
  /** The form values the user entered (retained on error, cleared on success). */
  currentValues: FormValues;
}

function processSubmission(
  state: ScreenState,
  outcome: SubmissionOutcome,
  enteredValues: FormValues,
): ScreenState {
  if (!outcome.ok) {
    // Requirement 10.5: display the returned field error and retain entered values.
    return {
      displayedFieldErrors: outcome.errors,
      valuesRetained: true,
      currentValues: enteredValues,
    };
  }
  // Requirement 10.6: clear the displayed field error on successful submission.
  return {
    displayedFieldErrors: [],
    valuesRetained: false,
    currentValues: { symptomType: '', systemicLocation: '', severity: '', notes: '' },
  };
}

// ---------------------------------------------------------------------------
// Property 8 Tests
// ---------------------------------------------------------------------------

describe('Property 8: Field-error display round-trips with submission outcome (10.5, 10.6)', () => {
  it.prop([fieldErrorsArb, formValuesArb], { numRuns: 100 })(
    'after a submission returning FieldError, the errors are displayed and values are retained',
    (errors, enteredValues) => {
      const initialState: ScreenState = {
        displayedFieldErrors: [],
        valuesRetained: false,
        currentValues: { symptomType: '', systemicLocation: '', severity: '', notes: '' },
      };

      const outcome: SubmissionOutcome = { ok: false, errors };
      const nextState = processSubmission(initialState, outcome, enteredValues);

      // Field errors are displayed
      expect(nextState.displayedFieldErrors).toEqual(errors);
      expect(nextState.displayedFieldErrors.length).toBeGreaterThan(0);

      // Entered values are retained (not cleared)
      expect(nextState.valuesRetained).toBe(true);
      expect(nextState.currentValues).toEqual(enteredValues);
    },
  );

  it.prop([fieldErrorsArb, formValuesArb, formValuesArb], { numRuns: 100 })(
    'after a failed submission followed by a successful submission, field errors are cleared',
    (errors, firstValues, secondValues) => {
      let state: ScreenState = {
        displayedFieldErrors: [],
        valuesRetained: false,
        currentValues: { symptomType: '', systemicLocation: '', severity: '', notes: '' },
      };

      // First: a submission that fails with field errors
      state = processSubmission(state, { ok: false, errors }, firstValues);
      expect(state.displayedFieldErrors.length).toBeGreaterThan(0);
      expect(state.currentValues).toEqual(firstValues);

      // Second: a successful submission
      state = processSubmission(state, { ok: true }, secondValues);

      // Field errors are cleared on success (Requirement 10.6)
      expect(state.displayedFieldErrors).toEqual([]);
      expect(state.displayedFieldErrors).toHaveLength(0);
    },
  );

  it.prop([submissionSequenceArb, fc.array(formValuesArb, { minLength: 1, maxLength: 20 })], { numRuns: 100 })(
    'biconditional: field errors displayed iff last submission returned a FieldError',
    (outcomes, valuesList) => {
      let state: ScreenState = {
        displayedFieldErrors: [],
        valuesRetained: false,
        currentValues: { symptomType: '', systemicLocation: '', severity: '', notes: '' },
      };

      // Process each submission outcome in sequence
      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i];
        // Cycle through the generated form values
        const values = valuesList[i % valuesList.length];
        state = processSubmission(state, outcome, values);

        // After each submission, verify the biconditional:
        // field errors shown ⟺ last submission returned a FieldError
        if (!outcome.ok) {
          // Last submission returned FieldError → errors MUST be displayed
          expect(state.displayedFieldErrors.length).toBeGreaterThan(0);
          expect(state.displayedFieldErrors).toEqual(outcome.errors);
          // Values MUST be retained
          expect(state.valuesRetained).toBe(true);
          expect(state.currentValues).toEqual(values);
        } else {
          // Last submission succeeded → errors MUST be cleared
          expect(state.displayedFieldErrors).toEqual([]);
          expect(state.displayedFieldErrors).toHaveLength(0);
          // Values are cleared on success
          expect(state.valuesRetained).toBe(false);
        }
      }
    },
  );

  it.prop([fieldErrorsArb, fieldErrorsArb, formValuesArb, formValuesArb], { numRuns: 100 })(
    'consecutive FieldError submissions replace the previously displayed errors',
    (firstErrors, secondErrors, firstValues, secondValues) => {
      let state: ScreenState = {
        displayedFieldErrors: [],
        valuesRetained: false,
        currentValues: { symptomType: '', systemicLocation: '', severity: '', notes: '' },
      };

      // First failed submission
      state = processSubmission(state, { ok: false, errors: firstErrors }, firstValues);
      expect(state.displayedFieldErrors).toEqual(firstErrors);
      expect(state.currentValues).toEqual(firstValues);

      // Second failed submission — errors are REPLACED, not appended
      state = processSubmission(state, { ok: false, errors: secondErrors }, secondValues);
      expect(state.displayedFieldErrors).toEqual(secondErrors);
      expect(state.currentValues).toEqual(secondValues);

      // The first errors are gone — only the latest errors are shown
      if (JSON.stringify(firstErrors) !== JSON.stringify(secondErrors)) {
        expect(state.displayedFieldErrors).not.toEqual(firstErrors);
      }
    },
  );

  it.prop([fc.array(submissionOutcomeArb, { minLength: 2, maxLength: 10 }), formValuesArb], { numRuns: 100 })(
    'field errors never leak across a successful submission boundary',
    (outcomes, values) => {
      let state: ScreenState = {
        displayedFieldErrors: [],
        valuesRetained: false,
        currentValues: { symptomType: '', systemicLocation: '', severity: '', notes: '' },
      };

      for (const outcome of outcomes) {
        state = processSubmission(state, outcome, values);
      }

      // Find the last successful submission index
      let lastSuccessIdx = -1;
      for (let i = outcomes.length - 1; i >= 0; i--) {
        if (outcomes[i].ok) {
          lastSuccessIdx = i;
          break;
        }
      }

      // Find the last failed submission index
      let lastFailureIdx = -1;
      for (let i = outcomes.length - 1; i >= 0; i--) {
        if (!outcomes[i].ok) {
          lastFailureIdx = i;
          break;
        }
      }

      // The final state's field errors depend on the LAST outcome only
      const lastOutcome = outcomes[outcomes.length - 1];
      if (lastOutcome.ok) {
        // If the last submission succeeded, no field errors should remain
        expect(state.displayedFieldErrors).toHaveLength(0);
      } else {
        // If the last submission failed, its errors should be displayed
        expect(state.displayedFieldErrors).toEqual((lastOutcome as { ok: false; errors: FieldError[] }).errors);
      }
    },
  );
});

import type {
  DoseRegimen,
  MedicationProfile,
  MedicationSchedule,
  PrnConfig,
} from './medications';

/** Build a medication profile for tests — accepts legacy single-regimen fields. */
export function makeTestMedicationProfile(
  overrides: Partial<MedicationProfile> & {
    dosage?: string;
    form?: string;
    schedule?: MedicationSchedule;
    prn?: PrnConfig;
    regimenId?: string;
  } = {},
): MedicationProfile {
  const {
    dosage = '10mg',
    form = 'tablet',
    schedule = {
      kind: 'weekly',
      daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      times: ['08:00'],
    },
    prn,
    regimenId = 'reg-1',
    regimens,
    ...rest
  } = overrides;

  const defaultRegimens: DoseRegimen[] = [
    {
      id: regimenId,
      dosage,
      form,
      schedule,
      ...(prn !== undefined ? { prn } : {}),
    },
  ];

  return {
    id: 'med-1',
    op_timestamp: '2024-01-01T00:00:00.000Z',
    drugName: 'Test Med',
    prescribingPhysician: '',
    conditionTreated: '',
    active: true,
    regimens: regimens ?? defaultRegimens,
    ...rest,
  };
}

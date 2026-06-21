/**
 * Home-backed symptom/flare stores for journal screens.
 */

import type { SymptomEntry, FlareUp } from '@complex-patient/domain';
import type { SymptomStore, FlareStore, FlareLookups } from '@complex-patient/symptom-journal';
import type { HomeEntryController } from '../app/home-entry';
import { mergeSymptomRecords } from './symptom-journal-ui';

export function createHomeSymptomStore(home: HomeEntryController): SymptomStore {
  return {
    async readSymptoms(): Promise<SymptomEntry[]> {
      return home.read<SymptomEntry>('symptoms').records;
    },
    async writeSymptoms(records: SymptomEntry[]): Promise<void> {
      const result = await home.commit<SymptomEntry>('symptoms', (current) =>
        mergeSymptomRecords(current, records),
      );
      if (!result.ok) {
        if (result.error === 'LOCKED') {
          throw new Error('Your session is locked. Unlock to save this entry.');
        }
        throw new Error(result.message);
      }
    },
  };
}

export function createHomeFlareStore(home: HomeEntryController): FlareStore {
  return {
    async readFlares(): Promise<FlareUp[]> {
      return home.read<FlareUp>('flares').records;
    },
    async writeFlares(records: FlareUp[]): Promise<void> {
      const result = await home.commit<FlareUp>('flares', (current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        for (const entry of records) {
          byId.set(entry.id, entry);
        }
        const ordered = [...current];
        for (const entry of records) {
          if (!current.some((existing) => existing.id === entry.id)) {
            ordered.push(entry);
          }
        }
        return ordered;
      });
      if (!result.ok) {
        if (result.error === 'LOCKED') {
          throw new Error('Your session is locked. Unlock to save this entry.');
        }
        throw new Error(result.message);
      }
    },
  };
}

export function createHomeFlareLookups(home: HomeEntryController): FlareLookups {
  return {
    async activeSymptomIds(): Promise<Iterable<string>> {
      const symptoms = home.read<SymptomEntry>('symptoms').records;
      return symptoms.filter((symptom) => symptom.active).map((symptom) => symptom.id);
    },
  };
}

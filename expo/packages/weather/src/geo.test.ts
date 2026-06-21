import { describe, it, expect } from 'vitest';
import { roundCoordinate, roundCoordinates, locationBucketKey, calendarDayKey } from './geo';

describe('geo helpers', () => {
  it('rounds coordinates to one decimal by default', () => {
    expect(roundCoordinates(40.712776, -74.005974)).toEqual({
      latitude: 40.7,
      longitude: -74,
    });
  });

  it('roundCoordinate supports custom precision', () => {
    expect(roundCoordinate(1.23456, 2)).toBe(1.23);
  });

  it('locationBucketKey matches rounded pair', () => {
    expect(locationBucketKey(40.712776, -74.005974)).toBe('40.7,-74');
  });

  it('calendarDayKey extracts UTC date prefix', () => {
    expect(calendarDayKey('2024-06-14T15:30:00.000Z')).toBe('2024-06-14');
  });
});

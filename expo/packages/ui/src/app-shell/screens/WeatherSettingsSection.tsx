/**
 * Shared opt-in toggles for location capture and weather overlays.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ActivityIndicator } from 'react-native';
import { WEATHER_PRIVACY_NOTICE } from '@complex-patient/weather';
import { useWeatherHost } from '../weather-host-context';

export interface WeatherSettingsSectionProps {
  /** Optional platform-specific note (e.g. native permission explainer). */
  platformNote?: React.ReactNode;
  /** Show the mobile-only background trail toggle. */
  showLocationTrailToggle?: boolean;
}

export function WeatherSettingsSection({
  platformNote,
  showLocationTrailToggle = false,
}: WeatherSettingsSectionProps): React.ReactElement {
  const { location, preferences } = useWeatherHost();
  const [enabled, setEnabled] = useState(false);
  const [trailEnabled, setTrailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [pref, trailPref, permission] = await Promise.all([
        preferences.isAttachLocationEnabled(),
        preferences.isRecordLocationTrailEnabled(),
        location.getPermissionStatus(),
      ]);
      if (!cancelled) {
        setEnabled(pref);
        setTrailEnabled(trailPref);
        setPermissionStatus(permission);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location, preferences]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      await preferences.setAttachLocationEnabled(next);
      if (next) {
        const permission = await location.requestPermission();
        setPermissionStatus(permission);
      }
    },
    [location, preferences],
  );

  const handleTrailToggle = useCallback(
    async (next: boolean) => {
      setTrailEnabled(next);
      await preferences.setRecordLocationTrailEnabled(next);
      if (next) {
        const permission = await location.requestPermission();
        setPermissionStatus(permission);
      }
    },
    [location, preferences],
  );

  if (loading) {
    return (
      <View style={styles.container} testID="weather-settings-loading">
        <ActivityIndicator accessibilityLabel="Loading weather settings" />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="weather-settings-section">
      <Text style={styles.title}>Weather &amp; location</Text>
      <Text style={styles.lead}>
        Optional overlays on your symptom history chart using Open-Meteo historical weather at where you were.
      </Text>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>Attach approximate location when logging</Text>
          <Text style={styles.hint}>
            Symptoms, flares, and PRN medications · off by default · rounded to ~11 km
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(value) => void handleToggle(value)}
          accessibilityLabel="Attach approximate location when logging symptoms, flares, and medications"
          testID="weather-attach-location-toggle"
        />
      </View>

      {showLocationTrailToggle && (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Record location trail (mobile)</Text>
            <Text style={styles.hint}>
              Background samples while unlocked · fills weather on days without log-time GPS · 30-day retention
            </Text>
          </View>
          <Switch
            value={trailEnabled}
            onValueChange={(value) => void handleTrailToggle(value)}
            accessibilityLabel="Record approximate location trail on mobile"
            testID="weather-record-location-trail-toggle"
          />
        </View>
      )}

      {(enabled || trailEnabled) && permissionStatus && permissionStatus !== 'granted' && (
        <Text style={styles.permissionNote} testID="weather-permission-note">
          Location permission: {permissionStatus}. Overlays still work from locations synced from other devices.
        </Text>
      )}

      <Text style={styles.privacy}>{WEATHER_PRIVACY_NOTICE}</Text>

      {platformNote}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  lead: {
    fontSize: 15,
    color: '#444',
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    color: '#666',
  },
  permissionNote: {
    fontSize: 13,
    color: '#8a5a00',
  },
  privacy: {
    fontSize: 13,
    color: '#555',
    lineHeight: 20,
    paddingTop: 4,
  },
});

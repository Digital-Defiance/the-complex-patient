/**
 * @complex-patient/mobile — Authenticated home stack layout
 *
 * Surfaces sync status and retries queued partitions when connectivity returns.
 * Forwards activity to reset the idle auto-lock timer (Requirement 13.1).
 */

import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Slot, useRouter } from 'expo-router';
import {
  ActivityResponder,
  SyncStatusIndicator,
  useConnectivityWatcher,
  ConnectivityProvider,
  WeatherHostProvider,
  useAppHost,
} from '@complex-patient/ui';
import { mobileWeatherHost } from '../../src/adapters/weather-host';
import { LocationTrailSampler } from '../../src/location-trail-sampler';
import { MedicationNotificationSync } from '../../src/medication-notification-sync';
import { VaultUpdatePushSync } from '../../src/vault-update-push-sync';

function AuthenticatedHomeStack(): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();
  const router = useRouter();
  const { isOffline } = useConnectivityWatcher();
  const insets = useSafeAreaInsets();

  const content = (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <SyncStatusIndicator isOffline={isOffline} />
      </View>
      <View style={styles.content}>
        <ConnectivityProvider isOffline={isOffline}>
          <WeatherHostProvider deps={mobileWeatherHost}>
            <MedicationNotificationSync />
            <VaultUpdatePushSync />
            {Platform.OS !== 'web' && <LocationTrailSampler />}
            <Slot screenOptions={{ headerShown: false }} />
          </WeatherHostProvider>
        </ConnectivityProvider>
      </View>
    </View>
  );

  if (!home) {
    return content;
  }

  return (
    <ActivityResponder
      home={home}
      onLocked={() => {
        refreshHomeStatus();
        router.replace('/auth/unlock' as never);
      }}
    >
      {content}
    </ActivityResponder>
  );
}

export default function HomeLayout(): React.ReactElement {
  return <AuthenticatedHomeStack />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#fafafa',
    alignItems: 'flex-end',
  },
  content: {
    flex: 1,
  },
});

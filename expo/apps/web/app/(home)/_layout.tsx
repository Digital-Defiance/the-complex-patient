/**
 * @complex-patient/web — Authenticated home stack layout
 *
 * Layout for the `(home)` route group. This is the authenticated stack that
 * renders while the Home_Controller status is `ready`. It provides the shared
 * navigation structure for the home screen and subsystem screens.
 *
 * Mounts the SyncStatusIndicator in the header area to surface the aggregate
 * sync status (idle/syncing/pending/conflict) and monitors network connectivity
 * to call home.onConnectivityRestored() within 5s of restoration. Disables
 * backend-only controls while unreachable, keeping Local_Vault reads/writes/
 * navigation enabled.
 *
 * Requirements: 8.1, 8.2, 8.3, 12.1, 12.2, 12.3, 12.4, 13.1, 13.5, 14.5
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Slot, useRouter } from 'expo-router';
import {
  ActivityResponder,
  SyncStatusIndicator,
  useConnectivityWatcher,
  ConnectivityProvider,
  WeatherHostProvider,
  useAppHost,
} from '@complex-patient/ui';
import { webWeatherHost } from '../../src/adapters/weather-host';

function AuthenticatedHomeStack(): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();
  const router = useRouter();
  const { isOffline } = useConnectivityWatcher();

  const content = (
    <View style={styles.container}>
      <View style={styles.header}>
        <SyncStatusIndicator isOffline={isOffline} />
      </View>
      <View style={styles.content}>
        <ConnectivityProvider isOffline={isOffline}>
          <WeatherHostProvider deps={webWeatherHost}>
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
    paddingTop: 8,
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

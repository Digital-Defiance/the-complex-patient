/**
 * @complex-patient/mobile — Authenticated home stack layout
 *
 * Surfaces sync status and retries queued partitions when connectivity returns.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import { SyncStatusIndicator, useConnectivityWatcher, ConnectivityProvider } from '@complex-patient/ui';

export default function HomeLayout(): React.ReactElement {
  const { isOffline } = useConnectivityWatcher();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SyncStatusIndicator isOffline={isOffline} />
      </View>
      <View style={styles.content}>
        <ConnectivityProvider isOffline={isOffline}>
          <Slot screenOptions={{ headerShown: false }} />
        </ConnectivityProvider>
      </View>
    </View>
  );
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

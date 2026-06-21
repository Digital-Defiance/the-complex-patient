/**
 * Platform-aware session key store selection.
 *
 * Mobile-on-web cannot use expo-secure-store; it uses volatile RAM like the
 * dedicated web client.
 */

import { Platform } from 'react-native';
import {
  NativeSessionKeyStore,
  WebSessionKeyStore,
  type BiometricAdapter,
  type IdleAutoLock,
  type KekCodec,
  type SecureStoreAdapter,
  type SessionKeyStore,
} from '@complex-patient/key-store';
import { createWebTabLifecycleAdapter } from './web-lifecycle';

export interface NativeSessionKeyStoreDeps {
  secureStore: SecureStoreAdapter;
  biometrics: BiometricAdapter;
  codec: KekCodec;
  sharedIdle?: IdleAutoLock;
}

export function createPlatformSessionKeyStore(deps: NativeSessionKeyStoreDeps): SessionKeyStore {
  if (Platform.OS === 'web') {
    return new WebSessionKeyStore({
      lifecycle: createWebTabLifecycleAdapter(),
      sharedIdle: deps.sharedIdle,
    });
  }
  return new NativeSessionKeyStore({
    secureStore: deps.secureStore,
    biometrics: deps.biometrics,
    codec: deps.codec,
    sharedIdle: deps.sharedIdle,
  });
}

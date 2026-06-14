/**
 * Minimal react-native mock for vitest.
 *
 * Tests that run under Node (not a full React Native renderer) need this mock
 * so that barrel-exported screen components can be parsed without pulling in
 * the real react-native runtime (which contains non-standard JS that confuses
 * Vite's SSR transform).
 */

import React from 'react';

const noop = () => null;
const identity = (x: unknown) => x;

// Core components as simple pass-throughs
export const View = 'View';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const Pressable = 'Pressable';
export const TouchableOpacity = 'TouchableOpacity';
export const ScrollView = 'ScrollView';
export const FlatList = 'FlatList';
export const ActivityIndicator = 'ActivityIndicator';
export const Image = 'Image';
export const SafeAreaView = 'SafeAreaView';
export const StatusBar = 'StatusBar';
export const Platform = { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default };
export const Dimensions = { get: () => ({ width: 375, height: 812 }) };
export const Animated = {
  View: 'Animated.View',
  Text: 'Animated.Text',
  Value: class { interpolate = identity; },
  timing: () => ({ start: noop }),
  spring: () => ({ start: noop }),
  event: noop,
  createAnimatedComponent: (c: unknown) => c,
};
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: identity,
  hairlineWidth: 1,
};
export const AppState = { addEventListener: () => ({ remove: noop }), currentState: 'active' };
export const Linking = { openURL: noop, addEventListener: () => ({ remove: noop }) };
export const Alert = { alert: noop };
export const Keyboard = { dismiss: noop, addListener: () => ({ remove: noop }) };
export const PixelRatio = { get: () => 2, roundToNearestPixel: (n: number) => n };
export const useWindowDimensions = () => ({ width: 375, height: 812 });
export const useColorScheme = () => 'light';

export default {
  View,
  Text,
  TextInput,
  Pressable,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Image,
  SafeAreaView,
  StatusBar,
  Platform,
  Dimensions,
  Animated,
  StyleSheet,
  AppState,
  Linking,
  Alert,
  Keyboard,
  PixelRatio,
  useWindowDimensions,
  useColorScheme,
};

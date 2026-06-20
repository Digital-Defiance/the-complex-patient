// Metro configuration for The Complex Patient (Expo SDK 54).

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Resolve `node:crypto` and `crypto` imports to our React Native-compatible shim.
// The crypto-engine package uses node:crypto for PBKDF2/AES-256-GCM; on React Native
// we provide these via expo-crypto + Web Crypto API (SubtleCrypto).
// Resolve zip.js to the Hermes-safe build (main entry pulls in zip-fs + import.meta).
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: path.resolve(__dirname, 'crypto-shim.js'),
  'node:crypto': path.resolve(__dirname, 'crypto-shim.js'),
  '@zip.js/zip.js': path.resolve(__dirname, 'node_modules/@zip.js/zip.js/lib/zip-no-worker.js'),
};

module.exports = config;

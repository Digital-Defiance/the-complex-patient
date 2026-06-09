// Metro configuration for The Complex Patient (Expo SDK 54).

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Resolve `node:crypto` and `crypto` imports to our React Native-compatible shim.
// The crypto-engine package uses node:crypto for PBKDF2/AES-256-GCM; on React Native
// we provide these via expo-crypto + Web Crypto API (SubtleCrypto).
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: path.resolve(__dirname, 'crypto-shim.js'),
  'node:crypto': path.resolve(__dirname, 'crypto-shim.js'),
};

module.exports = config;

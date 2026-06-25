// Metro configuration for The Complex Patient (Expo SDK 54).

const { getDefaultConfig } = require('expo/metro-config');
const http = require('http');
const path = require('path');

const config = getDefaultConfig(__dirname);

const LOCAL_WP_PORT = Number(process.env.COMPLEX_PATIENT_LOCAL_WP_PORT || 8881);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildProxyRequestHeaders(incomingHeaders, wpHost, wpPort) {
  const headers = { ...incomingHeaders };
  for (const name of HOP_BY_HOP_HEADERS) {
    delete headers[name];
  }
  // Some Connect stacks drop Authorization on incoming requests — re-assert it.
  const auth =
    incomingHeaders.authorization ||
    incomingHeaders.Authorization ||
    incomingHeaders['x-wp-authorization'];
  if (auth) {
    headers.authorization = auth;
  }
  headers.host = `${wpHost}:${wpPort}`;
  return headers;
}

/**
 * Proxy /wp-json/* to WordPress Studio during web dev so the browser talks to
 * Metro (:8081) same-origin instead of cross-origin to :8881.
 */
function enhanceMiddleware(middleware) {
  return (req, res, next) => {
    const requestUrl = req.url || '';
    if (!requestUrl.startsWith('/wp-json/')) {
      return middleware(req, res, next);
    }

    const requestHost = (req.headers.host || 'localhost:8081').split(':')[0];
    const wpHost =
      requestHost === 'localhost' || requestHost === '127.0.0.1' ? 'localhost' : requestHost;

    const proxyReq = http.request(
      {
        hostname: wpHost,
        port: LOCAL_WP_PORT,
        path: requestUrl,
        method: req.method,
        headers: buildProxyRequestHeaders(req.headers, wpHost, LOCAL_WP_PORT),
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (error) => {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          code: 'complex_patient_wp_proxy_error',
          message: `WordPress proxy failed: ${error.message}`,
        }),
      );
    });

    // GET/HEAD have no body — ending immediately avoids pipe issues with some clients.
    if (req.method === 'GET' || req.method === 'HEAD') {
      proxyReq.end();
      return;
    }

    req.pipe(proxyReq);
  };
}

config.server = {
  ...config.server,
  enhanceMiddleware,
};

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

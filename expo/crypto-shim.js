/**
 * Shim for `node:crypto` — React Native (Hermes) compatible.
 *
 * Provides PBKDF2, randomBytes, and AES-256-GCM stubs.
 * Uses SubtleCrypto when available, falls back to pure JS PBKDF2.
 */

// ---------------------------------------------------------------------------
// randomBytes
// ---------------------------------------------------------------------------

function randomBytes(size) {
  var bytes = new Uint8Array(size);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (var i = 0; i < size; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Pure JS HMAC-SHA256 for PBKDF2 fallback (no native deps)
// ---------------------------------------------------------------------------

function toBytes(str) {
  var enc = new TextEncoder();
  return enc.encode(str);
}

// SHA-256 constants
var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(data) {
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  var msg = typeof data === 'string' ? toBytes(data) : new Uint8Array(data);
  var bitLen = msg.length * 8;
  // Padding
  var padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  var view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen, false);

  var w = new Int32Array(64);
  for (var offset = 0; offset < padded.length; offset += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false);
    for (var i = 16; i < 64; i++) {
      var s0 = (rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15]>>>3));
      var s1 = (rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2]>>>10));
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    var a=h0, b=h1, c=h2, d=h3, e=h4, f=h5, g=h6, h=h7;
    for (var i = 0; i < 64; i++) {
      var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }
  var out = new Uint8Array(32);
  var dv = new DataView(out.buffer);
  dv.setInt32(0,h0,false); dv.setInt32(4,h1,false); dv.setInt32(8,h2,false); dv.setInt32(12,h3,false);
  dv.setInt32(16,h4,false); dv.setInt32(20,h5,false); dv.setInt32(24,h6,false); dv.setInt32(28,h7,false);
  return out;
}

function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function hmacSha256(key, message) {
  var blockSize = 64;
  if (key.length > blockSize) key = sha256(key);
  var keyPad = new Uint8Array(blockSize);
  keyPad.set(key);
  var ipad = new Uint8Array(blockSize);
  var opad = new Uint8Array(blockSize);
  for (var i = 0; i < blockSize; i++) {
    ipad[i] = keyPad[i] ^ 0x36;
    opad[i] = keyPad[i] ^ 0x5c;
  }
  var inner = new Uint8Array(blockSize + message.length);
  inner.set(ipad);
  inner.set(message, blockSize);
  var innerHash = sha256(inner);
  var outer = new Uint8Array(blockSize + 32);
  outer.set(opad);
  outer.set(innerHash, blockSize);
  return sha256(outer);
}

// Pure JS PBKDF2-SHA256
function pbkdf2Sha256(password, salt, iterations, keyLen) {
  var passBytes = typeof password === 'string' ? toBytes(password) : new Uint8Array(password);
  var saltBytes = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
  var numBlocks = Math.ceil(keyLen / 32);
  var dk = new Uint8Array(numBlocks * 32);

  for (var blockIdx = 1; blockIdx <= numBlocks; blockIdx++) {
    // U1 = HMAC(password, salt || INT32BE(blockIdx))
    var saltBlock = new Uint8Array(saltBytes.length + 4);
    saltBlock.set(saltBytes);
    saltBlock[saltBytes.length] = (blockIdx >>> 24) & 0xff;
    saltBlock[saltBytes.length + 1] = (blockIdx >>> 16) & 0xff;
    saltBlock[saltBytes.length + 2] = (blockIdx >>> 8) & 0xff;
    saltBlock[saltBytes.length + 3] = blockIdx & 0xff;

    var u = hmacSha256(passBytes, saltBlock);
    var result = new Uint8Array(u);

    for (var i = 1; i < iterations; i++) {
      u = hmacSha256(passBytes, u);
      for (var j = 0; j < 32; j++) result[j] ^= u[j];
    }
    dk.set(result, (blockIdx - 1) * 32);
  }
  return dk.slice(0, keyLen);
}

// ---------------------------------------------------------------------------
// pbkdf2 (callback-style matching node:crypto)
// ---------------------------------------------------------------------------

function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  try {
    // Try SubtleCrypto first (fastest, hardware-accelerated)
    if (globalThis.crypto && globalThis.crypto.subtle) {
      var enc = new TextEncoder();
      var passData = typeof password === 'string' ? enc.encode(password) : password;
      var saltData = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
      var hashName = digest === 'sha256' ? 'SHA-256' : 'SHA-512';

      globalThis.crypto.subtle.importKey('raw', passData, { name: 'PBKDF2' }, false, ['deriveBits'])
        .then(function(keyMaterial) {
          return globalThis.crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: saltData, iterations: iterations, hash: hashName },
            keyMaterial,
            keylen * 8
          );
        })
        .then(function(bits) { callback(null, new Uint8Array(bits)); })
        .catch(function() {
          // SubtleCrypto failed — fall back to pure JS
          try {
            var result = pbkdf2Sha256(password, salt, iterations, keylen);
            callback(null, result);
          } catch(e) { callback(e); }
        });
    } else {
      // No SubtleCrypto — use pure JS PBKDF2
      // Use setTimeout to keep it async (matching node:crypto callback style)
      setTimeout(function() {
        try {
          var result = pbkdf2Sha256(password, salt, iterations, keylen);
          callback(null, result);
        } catch(e) { callback(e); }
      }, 0);
    }
  } catch(e) {
    callback(e);
  }
}

// ---------------------------------------------------------------------------
// createCipheriv / createDecipheriv — stubs
// ---------------------------------------------------------------------------

function createCipheriv(algorithm, key, iv) {
  if (algorithm !== 'aes-256-gcm') throw new Error('Unsupported: ' + algorithm);
  var chunks = [];
  var result = null;
  return {
    update: function(data) {
      chunks.push(typeof data === 'string' ? toBytes(data) : new Uint8Array(data.buffer || data));
      return new Uint8Array(0);
    },
    final: function() { return result ? result.ciphertext : new Uint8Array(0); },
    getAuthTag: function() { return result ? result.authTag : new Uint8Array(16); },
    _getPlaintext: function() { var t=0; chunks.forEach(function(c){t+=c.length}); var o=new Uint8Array(t); var off=0; chunks.forEach(function(c){o.set(c,off);off+=c.length}); return o; },
    _getKey: function() { return key; },
    _getIv: function() { return iv; },
    _setResult: function(r) { result = r; },
  };
}

function createDecipheriv(algorithm, key, iv) {
  if (algorithm !== 'aes-256-gcm') throw new Error('Unsupported: ' + algorithm);
  var chunks = [];
  var authTag = null;
  var result = null;
  return {
    setAuthTag: function(tag) { authTag = new Uint8Array(tag.buffer || tag); },
    update: function(data) { chunks.push(typeof data === 'string' ? toBytes(data) : new Uint8Array(data.buffer || data)); return new Uint8Array(0); },
    final: function() { return result || new Uint8Array(0); },
    _getCiphertext: function() { var t=0; chunks.forEach(function(c){t+=c.length}); var o=new Uint8Array(t); var off=0; chunks.forEach(function(c){o.set(c,off);off+=c.length}); return o; },
    _getKey: function() { return key; },
    _getIv: function() { return iv; },
    _getAuthTag: function() { return authTag; },
    _setResult: function(r) { result = r; },
  };
}

module.exports = {
  pbkdf2: pbkdf2,
  randomBytes: randomBytes,
  createCipheriv: createCipheriv,
  createDecipheriv: createDecipheriv,
};

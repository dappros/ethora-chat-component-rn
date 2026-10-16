import CryptoKit
import Foundation

/// libsodium's sealed box (`crypto_box_seal_open`) without libsodium: the
/// notification service extension cannot load the app's JavaScript, and a
/// pod for the extension is one more thing every host app would have to
/// carry (the Sodium pod also excludes arm64 simulators). X25519 comes from
/// CryptoKit; HSalsa20, XSalsa20, Poly1305 and BLAKE2b are ported from
/// tweetnacl and poly1305-donna / the BLAKE2 reference, public domain.
///
/// Layout: ephemeral public key (32) || crypto_box(message, nonce,
/// recipient pk, ephemeral sk), with crypto_box = XSalsa20-Poly1305 under
/// HSalsa20(X25519 shared secret) and nonce = BLAKE2b-192(epk || rpk).
/// The SDK's `src/push/sealedBox.ts` is the same construction in JS; both
/// are pinned against libsodium (JS: `__tests__/sealedBox.test.ts`, Swift:
/// `plugins/notification-service/check/`).
enum SealedBox {
  static let publicKeyBytes = 32
  static let secretKeyBytes = 32
  static let macBytes = 16
  static let nonceBytes = 24
  /// Ephemeral public key + Poly1305 tag.
  static let overheadBytes = 48

  /// The X25519 public key of a secret key (`crypto_scalarmult_base`).
  static func publicKey(of secretKey: [UInt8]) -> [UInt8]? {
    guard let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretKey) else { return nil }
    return [UInt8](key.publicKey.rawRepresentation)
  }

  /// `crypto_box_seal_open`. Nil for anything that does not open.
  static func open(_ sealed: [UInt8], secretKey: [UInt8]) -> [UInt8]? {
    guard sealed.count >= overheadBytes, secretKey.count == secretKeyBytes,
          let recipientPublicKey = publicKey(of: secretKey)
    else { return nil }
    let ephemeralPublicKey = Array(sealed[0..<publicKeyBytes])
    let box = Array(sealed[publicKeyBytes...])
    guard let shared = x25519(secretKey: secretKey, publicKey: ephemeralPublicKey) else { return nil }
    let key = Salsa.hsalsa20(key: shared, input: [UInt8](repeating: 0, count: 16))
    let nonce = Blake2b.hash(ephemeralPublicKey + recipientPublicKey, outputLength: nonceBytes)
    return secretboxOpen(box, nonce: nonce, key: key)
  }

  private static func x25519(secretKey: [UInt8], publicKey: [UInt8]) -> [UInt8]? {
    guard let priv = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretKey),
          let pub = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey),
          let shared = try? priv.sharedSecretFromKeyAgreement(with: pub)
    else { return nil }
    return shared.withUnsafeBytes { [UInt8]($0) }
  }

  /// `crypto_secretbox_open_easy`: tag (16) || ciphertext under XSalsa20-Poly1305.
  static func secretboxOpen(_ box: [UInt8], nonce: [UInt8], key: [UInt8]) -> [UInt8]? {
    guard box.count >= macBytes, nonce.count == nonceBytes, key.count == 32 else { return nil }
    let tag = Array(box[0..<macBytes])
    let ciphertext = Array(box[macBytes...])
    // Keystream block 0: the first 32 bytes key Poly1305, the message starts at byte 32.
    let stream = Salsa.xsalsa20(key: key, nonce: nonce, length: 32 + ciphertext.count)
    let expected = Poly1305.mac(ciphertext, key: Array(stream[0..<32]))
    guard constantTimeEqual(expected, tag) else { return nil }
    var message = [UInt8](repeating: 0, count: ciphertext.count)
    for i in 0..<ciphertext.count { message[i] = ciphertext[i] ^ stream[32 + i] }
    return message
  }

  private static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
    guard a.count == b.count else { return false }
    var diff: UInt8 = 0
    for i in 0..<a.count { diff |= a[i] ^ b[i] }
    return diff == 0
  }
}

// MARK: - Salsa20 / HSalsa20 / XSalsa20 (tweetnacl)

enum Salsa {
  private static let sigma: [UInt32] = load32([UInt8]("expand 32-byte k".utf8))

  private static func load32(_ bytes: [UInt8]) -> [UInt32] {
    var words = [UInt32](repeating: 0, count: bytes.count / 4)
    for i in 0..<words.count {
      var w: UInt32 = 0
      for j in 0..<4 { w |= UInt32(bytes[i * 4 + j]) << (8 * UInt32(j)) }
      words[i] = w
    }
    return words
  }

  private static func store32(_ words: [UInt32]) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: words.count * 4)
    for (i, w) in words.enumerated() {
      out[i * 4] = UInt8(truncatingIfNeeded: w)
      out[i * 4 + 1] = UInt8(truncatingIfNeeded: w >> 8)
      out[i * 4 + 2] = UInt8(truncatingIfNeeded: w >> 16)
      out[i * 4 + 3] = UInt8(truncatingIfNeeded: w >> 24)
    }
    return out
  }

  @inline(__always) private static func rotl(_ v: UInt32, _ n: UInt32) -> UInt32 {
    (v << n) | (v >> (32 - n))
  }

  /// The Salsa20 state: sigma on the diagonal, key in two halves, 16-byte input in the middle row.
  private static func state(key: [UInt8], input: [UInt8]) -> [UInt32] {
    let k = load32(key)
    let n = load32(input)
    return [
      sigma[0], k[0], k[1], k[2],
      k[3], sigma[1], n[0], n[1],
      n[2], n[3], sigma[2], k[4],
      k[5], k[6], k[7], sigma[3],
    ]
  }

  /// 20 rounds (10 double rounds) in place.
  private static func rounds(_ x: inout [UInt32]) {
    @inline(__always) func quarter(_ a: Int, _ b: Int, _ c: Int, _ d: Int) {
      x[b] ^= rotl(x[a] &+ x[d], 7)
      x[c] ^= rotl(x[b] &+ x[a], 9)
      x[d] ^= rotl(x[c] &+ x[b], 13)
      x[a] ^= rotl(x[d] &+ x[c], 18)
    }
    for _ in 0..<10 {
      // column round
      quarter(0, 4, 8, 12)
      quarter(5, 9, 13, 1)
      quarter(10, 14, 2, 6)
      quarter(15, 3, 7, 11)
      // row round
      quarter(0, 1, 2, 3)
      quarter(5, 6, 7, 4)
      quarter(10, 11, 8, 9)
      quarter(15, 12, 13, 14)
    }
  }

  /// HSalsa20: 32-byte key, 16-byte input → 32-byte subkey (no feed-forward).
  static func hsalsa20(key: [UInt8], input: [UInt8]) -> [UInt8] {
    var x = state(key: key, input: input)
    rounds(&x)
    return store32([x[0], x[5], x[10], x[15], x[6], x[7], x[8], x[9]])
  }

  /// One 64-byte Salsa20 block for the 8-byte nonce and the block counter.
  private static func block(key: [UInt8], nonce: [UInt8], counter: UInt64) -> [UInt8] {
    var input = nonce
    for i in 0..<8 { input.append(UInt8(truncatingIfNeeded: counter >> (8 * UInt64(i)))) }
    let initial = state(key: key, input: input)
    var x = initial
    rounds(&x)
    for i in 0..<16 { x[i] = x[i] &+ initial[i] }
    return store32(x)
  }

  /// XSalsa20 keystream: HSalsa20 over the first 16 nonce bytes, Salsa20 over the last 8.
  static func xsalsa20(key: [UInt8], nonce: [UInt8], length: Int) -> [UInt8] {
    let subkey = hsalsa20(key: key, input: Array(nonce[0..<16]))
    let nonce8 = Array(nonce[16..<24])
    var out = [UInt8]()
    out.reserveCapacity(length + 64)
    var counter: UInt64 = 0
    while out.count < length {
      out += block(key: subkey, nonce: nonce8, counter: counter)
      counter += 1
    }
    return Array(out[0..<length])
  }
}

// MARK: - Poly1305 (poly1305-donna, 26-bit limbs)

enum Poly1305 {
  private static func load32(_ m: [UInt8], _ i: Int) -> UInt32 {
    var w: UInt32 = 0
    for j in 0..<4 { w |= UInt32(m[i + j]) << (8 * UInt32(j)) }
    return w
  }

  static func mac(_ message: [UInt8], key: [UInt8]) -> [UInt8] {
    precondition(key.count == 32)
    // r, clamped
    let r0 = load32(key, 0) & 0x3ffffff
    let r1 = (load32(key, 3) >> 2) & 0x3ffff03
    let r2 = (load32(key, 6) >> 4) & 0x3ffc0ff
    let r3 = (load32(key, 9) >> 6) & 0x3f03fff
    let r4 = (load32(key, 12) >> 8) & 0x00fffff
    let s1 = r1 &* 5, s2 = r2 &* 5, s3 = r3 &* 5, s4 = r4 &* 5
    var h0: UInt32 = 0, h1: UInt32 = 0, h2: UInt32 = 0, h3: UInt32 = 0, h4: UInt32 = 0

    func absorb(_ m: [UInt8], _ offset: Int, hibit: UInt32) {
      h0 &+= load32(m, offset) & 0x3ffffff
      h1 &+= (load32(m, offset + 3) >> 2) & 0x3ffffff
      h2 &+= (load32(m, offset + 6) >> 4) & 0x3ffffff
      h3 &+= (load32(m, offset + 9) >> 6) & 0x3ffffff
      h4 &+= (load32(m, offset + 12) >> 8) | hibit

      let d0 = UInt64(h0) * UInt64(r0) + UInt64(h1) * UInt64(s4) + UInt64(h2) * UInt64(s3) + UInt64(h3) * UInt64(s2) + UInt64(h4) * UInt64(s1)
      var d1 = UInt64(h0) * UInt64(r1) + UInt64(h1) * UInt64(r0) + UInt64(h2) * UInt64(s4) + UInt64(h3) * UInt64(s3) + UInt64(h4) * UInt64(s2)
      var d2 = UInt64(h0) * UInt64(r2) + UInt64(h1) * UInt64(r1) + UInt64(h2) * UInt64(r0) + UInt64(h3) * UInt64(s4) + UInt64(h4) * UInt64(s3)
      var d3 = UInt64(h0) * UInt64(r3) + UInt64(h1) * UInt64(r2) + UInt64(h2) * UInt64(r1) + UInt64(h3) * UInt64(r0) + UInt64(h4) * UInt64(s4)
      var d4 = UInt64(h0) * UInt64(r4) + UInt64(h1) * UInt64(r3) + UInt64(h2) * UInt64(r2) + UInt64(h3) * UInt64(r1) + UInt64(h4) * UInt64(r0)

      var c = UInt32(truncatingIfNeeded: d0 >> 26); h0 = UInt32(truncatingIfNeeded: d0) & 0x3ffffff
      d1 += UInt64(c); c = UInt32(truncatingIfNeeded: d1 >> 26); h1 = UInt32(truncatingIfNeeded: d1) & 0x3ffffff
      d2 += UInt64(c); c = UInt32(truncatingIfNeeded: d2 >> 26); h2 = UInt32(truncatingIfNeeded: d2) & 0x3ffffff
      d3 += UInt64(c); c = UInt32(truncatingIfNeeded: d3 >> 26); h3 = UInt32(truncatingIfNeeded: d3) & 0x3ffffff
      d4 += UInt64(c); c = UInt32(truncatingIfNeeded: d4 >> 26); h4 = UInt32(truncatingIfNeeded: d4) & 0x3ffffff
      h0 &+= c &* 5; c = h0 >> 26; h0 &= 0x3ffffff
      h1 &+= c
    }

    var offset = 0
    while message.count - offset >= 16 {
      absorb(message, offset, hibit: 1 << 24)
      offset += 16
    }
    if offset < message.count {
      var last = Array(message[offset...])
      last.append(1)
      while last.count < 16 { last.append(0) }
      absorb(last, 0, hibit: 0)
    }

    // full carry
    var c = h1 >> 26; h1 &= 0x3ffffff
    h2 &+= c; c = h2 >> 26; h2 &= 0x3ffffff
    h3 &+= c; c = h3 >> 26; h3 &= 0x3ffffff
    h4 &+= c; c = h4 >> 26; h4 &= 0x3ffffff
    h0 &+= c &* 5; c = h0 >> 26; h0 &= 0x3ffffff
    h1 &+= c

    // h + -p
    var g0 = h0 &+ 5; c = g0 >> 26; g0 &= 0x3ffffff
    var g1 = h1 &+ c; c = g1 >> 26; g1 &= 0x3ffffff
    var g2 = h2 &+ c; c = g2 >> 26; g2 &= 0x3ffffff
    var g3 = h3 &+ c; c = g3 >> 26; g3 &= 0x3ffffff
    var g4 = h4 &+ c &- (1 << 26)

    // select h if h < p, else h - p
    var mask = (g4 >> 31) &- 1
    g0 &= mask; g1 &= mask; g2 &= mask; g3 &= mask; g4 &= mask
    mask = ~mask
    h0 = (h0 & mask) | g0
    h1 = (h1 & mask) | g1
    h2 = (h2 & mask) | g2
    h3 = (h3 & mask) | g3
    h4 = (h4 & mask) | g4

    // h = h % 2^128
    h0 = (h0 | (h1 << 26))
    h1 = ((h1 >> 6) | (h2 << 20))
    h2 = ((h2 >> 12) | (h3 << 14))
    h3 = ((h3 >> 18) | (h4 << 8))

    // mac = (h + pad) % 2^128
    var f = UInt64(h0) + UInt64(load32(key, 16)); h0 = UInt32(truncatingIfNeeded: f)
    f = UInt64(h1) + UInt64(load32(key, 20)) + (f >> 32); h1 = UInt32(truncatingIfNeeded: f)
    f = UInt64(h2) + UInt64(load32(key, 24)) + (f >> 32); h2 = UInt32(truncatingIfNeeded: f)
    f = UInt64(h3) + UInt64(load32(key, 28)) + (f >> 32); h3 = UInt32(truncatingIfNeeded: f)

    var out = [UInt8]()
    for w in [h0, h1, h2, h3] {
      for i in 0..<4 { out.append(UInt8(truncatingIfNeeded: w >> (8 * UInt32(i)))) }
    }
    return out
  }
}

// MARK: - BLAKE2b (RFC 7693), unkeyed

enum Blake2b {
  private static let iv: [UInt64] = [
    0x6a09e667f3bcc908, 0xbb67ae8584caa73b, 0x3c6ef372fe94f82b, 0xa54ff53a5f1d36f1,
    0x510e527fade682d1, 0x9b05688c2b3e6c1f, 0x1f83d9abfb41bd6b, 0x5be0cd19137e2179,
  ]

  private static let sigma: [[Int]] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  ]

  @inline(__always) private static func rotr(_ v: UInt64, _ n: UInt64) -> UInt64 {
    (v >> n) | (v << (64 - n))
  }

  private static func compress(_ h: inout [UInt64], block: [UInt8], counter: UInt64, last: Bool) {
    var m = [UInt64](repeating: 0, count: 16)
    for i in 0..<16 {
      var w: UInt64 = 0
      for j in 0..<8 { w |= UInt64(block[i * 8 + j]) << (8 * UInt64(j)) }
      m[i] = w
    }
    var v = h + iv
    v[12] ^= counter
    // counter high word stays 0: inputs here are far below 2^64 bytes
    if last { v[14] = ~v[14] }

    @inline(__always) func g(_ a: Int, _ b: Int, _ c: Int, _ d: Int, _ x: UInt64, _ y: UInt64) {
      v[a] = v[a] &+ v[b] &+ x
      v[d] = rotr(v[d] ^ v[a], 32)
      v[c] = v[c] &+ v[d]
      v[b] = rotr(v[b] ^ v[c], 24)
      v[a] = v[a] &+ v[b] &+ y
      v[d] = rotr(v[d] ^ v[a], 16)
      v[c] = v[c] &+ v[d]
      v[b] = rotr(v[b] ^ v[c], 63)
    }

    for round in 0..<12 {
      let s = sigma[round % 10]
      g(0, 4, 8, 12, m[s[0]], m[s[1]])
      g(1, 5, 9, 13, m[s[2]], m[s[3]])
      g(2, 6, 10, 14, m[s[4]], m[s[5]])
      g(3, 7, 11, 15, m[s[6]], m[s[7]])
      g(0, 5, 10, 15, m[s[8]], m[s[9]])
      g(1, 6, 11, 12, m[s[10]], m[s[11]])
      g(2, 7, 8, 13, m[s[12]], m[s[13]])
      g(3, 4, 9, 14, m[s[14]], m[s[15]])
    }
    for i in 0..<8 { h[i] ^= v[i] ^ v[i + 8] }
  }

  /// BLAKE2b with no key, `outputLength` 1...64 bytes (`crypto_generichash`).
  static func hash(_ message: [UInt8], outputLength: Int) -> [UInt8] {
    precondition((1...64).contains(outputLength))
    var h = iv
    h[0] ^= 0x01010000 ^ UInt64(outputLength)

    var offset = 0
    // Every full block except the last one; the last block (full or not) is final.
    while message.count - offset > 128 {
      compress(&h, block: Array(message[offset..<offset + 128]), counter: UInt64(offset + 128), last: false)
      offset += 128
    }
    var last = Array(message[offset...])
    let consumed = UInt64(message.count)
    while last.count < 128 { last.append(0) }
    compress(&h, block: last, counter: consumed, last: true)

    var out = [UInt8]()
    for w in h {
      for i in 0..<8 { out.append(UInt8(truncatingIfNeeded: w >> (8 * UInt64(i)))) }
    }
    return Array(out[0..<outputLength])
  }
}

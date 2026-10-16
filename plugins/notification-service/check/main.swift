import Foundation

struct Vector: Decodable { let sk: String; let pk: String; let sealed: String; let plaintext: String; let kid: String }
struct Secretbox: Decodable { let key: String; let nonce: String; let msg: String; let box: String }
struct Blake: Decodable { let msg: String; let out: String }
struct Poly: Decodable { let key: String; let msg: String; let out: String }
struct File: Decodable { let vectors: [Vector]; let secretbox: Secretbox; let blake2b24: Blake; let poly1305: Poly }

func b(_ s: String) -> [UInt8] { [UInt8](Data(base64Encoded: s)!) }

let path = CommandLine.arguments[1]
let file = try! JSONDecoder().decode(File.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
var failures = 0
func check(_ name: String, _ ok: Bool) {
  print((ok ? "ok   " : "FAIL ") + name)
  if !ok { failures += 1 }
}

check("blake2b-24", Blake2b.hash(b(file.blake2b24.msg), outputLength: 24) == b(file.blake2b24.out))
check("poly1305", Poly1305.mac(b(file.poly1305.msg), key: b(file.poly1305.key)) == b(file.poly1305.out))
check("secretbox open", SealedBox.secretboxOpen(b(file.secretbox.box), nonce: b(file.secretbox.nonce), key: b(file.secretbox.key)) == b(file.secretbox.msg))
var damaged = b(file.secretbox.box); damaged[damaged.count - 1] ^= 1
check("secretbox rejects a damaged box", SealedBox.secretboxOpen(damaged, nonce: b(file.secretbox.nonce), key: b(file.secretbox.key)) == nil)

for (i, v) in file.vectors.enumerated() {
  let sk = b(v.sk)
  check("vector \(i) public key", SealedBox.publicKey(of: sk) == b(v.pk))
  let opened = SealedBox.open(b(v.sealed), secretKey: sk)
  check("vector \(i) opens (\(b(v.plaintext).count) bytes)", opened == b(v.plaintext))
  var bad = b(v.sealed); bad[40] ^= 0x80
  check("vector \(i) rejects a damaged box", SealedBox.open(bad, secretKey: sk) == nil)
  let other = b(file.vectors[(i + 1) % file.vectors.count].sk)
  check("vector \(i) rejects another key", SealedBox.open(b(v.sealed), secretKey: other) == nil)
}
check("short box", SealedBox.open([UInt8](repeating: 1, count: 47), secretKey: b(file.vectors[0].sk)) == nil)
print(failures == 0 ? "ALL OK" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)

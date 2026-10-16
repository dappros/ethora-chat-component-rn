import UniformTypeIdentifiers
import UserNotifications

/// Ethora chat pushes, two jobs:
///  - encrypted (sealed) pushes: the push carries a placeholder ("New message")
///    and a libsodium sealed box (`enc`) for the key this device registered
///    with its token. The box is opened with the secret key the app keeps in
///    the keychain (see `SealedPush`), and the notification is rewritten with
///    the real title and text. Whatever goes wrong, the placeholder stays.
///  - attachment previews: a plain photo / video push carries `previewUrl`
///    with `mutable-content: 1`; the thumbnail is downloaded and attached.
class NotificationService: UNNotificationServiceExtension {
  private let lock = NSLock()
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?
  private var download: URLSessionDownloadTask?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    self.contentHandler = contentHandler
    self.content = content

    if SealedPush.isSealed(content.userInfo) {
      SealedPush.apply(to: content)
      finish()
      return
    }

    guard let url = Self.previewURL(in: content.userInfo) else {
      finish()
      return
    }

    let task = URLSession.shared.downloadTask(with: url) { [weak self] location, response, _ in
      if let location = location, let attachment = Self.attachment(at: location, response: response, url: url) {
        self?.attach(attachment)
      }
      self?.finish()
    }
    download = task
    task.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    download?.cancel()
    finish()
  }

  private func attach(_ attachment: UNNotificationAttachment) {
    lock.lock()
    content?.attachments = [attachment]
    lock.unlock()
  }

  private func finish() {
    lock.lock()
    let handler = contentHandler
    let content = self.content
    contentHandler = nil
    lock.unlock()
    if let handler = handler, let content = content { handler(content) }
  }

  private static func previewURL(in userInfo: [AnyHashable: Any]) -> URL? {
    guard let raw = (userInfo["previewUrl"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
          let url = URL(string: raw),
          let scheme = url.scheme?.lowercased(),
          scheme == "https" || scheme == "http"
    else { return nil }
    return url
  }

  private static func attachment(at location: URL, response: URLResponse?, url: URL) -> UNNotificationAttachment? {
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }

    var fileExtension = response?.mimeType.flatMap { UTType(mimeType: $0)?.preferredFilenameExtension }
    if fileExtension == nil, !url.pathExtension.isEmpty { fileExtension = url.pathExtension }
    guard let ext = fileExtension else { return nil }

    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let file = dir.appendingPathComponent("preview").appendingPathExtension(ext)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try FileManager.default.moveItem(at: location, to: file)
      return try UNNotificationAttachment(identifier: "preview", url: file, options: nil)
    } catch {
      return nil
    }
  }
}

/// Encrypted pushes (ethora-backend, services/push/README.md, "Encrypted
/// pushes"). The envelope sits next to `aps`: `v`, `alg`, `kid`, `jid`,
/// `msgID`, `userJid` in the clear, `enc` = base64 of the sealed box. Inside:
/// UTF-8 JSON with `title`, `body`, `sender`, `senderJid`, `chat`, `chatJid`,
/// `msgID`, `image`.
///
/// The secret key is the item the SDK writes through expo-secure-store
/// (`src/push/pushKeyStore.ts` in @ethora/chat-component-rn): a generic
/// password with service `ethora.push:no-auth` (expo-secure-store adds the
/// `:no-auth` suffix), account `ethora_push_secret_key`, value = base64 of
/// the 32-byte X25519 secret key, in the keychain access group the config
/// plugin shares between the app and this extension.
typealias Bytes = [UInt8]

enum SealedPush {
  static let algorithm = "sealed-box-x25519"
  static let keychainServices = ["ethora.push:no-auth", "ethora.push"]
  static let keychainAccount = "ethora_push_secret_key"

  static func isSealed(_ userInfo: [AnyHashable: Any]) -> Bool {
    (userInfo["alg"] as? String) == algorithm
  }

  /// Replace the placeholder with the decrypted notification. Leaves the
  /// content as it came (the placeholder) when anything fails.
  static func apply(to content: UNMutableNotificationContent) {
    let userInfo = content.userInfo
    let kid = (userInfo["kid"] as? String) ?? ""
    guard let enc = userInfo["enc"] as? String,
          let sealed = Data(base64Encoded: enc, options: .ignoreUnknownCharacters)
    else {
      NSLog("[EthoraNotificationService] sealed push kid=%@: no ciphertext, keeping the placeholder", kid)
      return
    }
    guard let secretKey = loadSecretKey() else {
      NSLog("[EthoraNotificationService] sealed push kid=%@: no device key in the keychain, keeping the placeholder", kid)
      return
    }
    guard let plaintext = open(sealed: sealed, secretKey: secretKey) else {
      NSLog("[EthoraNotificationService] sealed push kid=%@: the box did not open (another key?), keeping the placeholder", kid)
      return
    }
    guard let json = try? JSONSerialization.jsonObject(with: plaintext) as? [String: Any] else {
      NSLog("[EthoraNotificationService] sealed push kid=%@: opened, but not JSON", kid)
      return
    }
    NSLog("[EthoraNotificationService] sealed push kid=%@: opened", kid)

    let title = text(json["title"])
    let body = text(json["body"])
    let sender = text(json["sender"])
    let chat = text(json["chat"])
    content.title = title.isEmpty ? (sender.isEmpty ? chat : sender) : title
    content.body = body
    if content.threadIdentifier.isEmpty, let jid = userInfo["jid"] as? String, !jid.isEmpty {
      content.threadIdentifier = jid
    }
    // What the tap handler reads (the host hands `userInfo` to
    // `handlePushPayload`); the ciphertext is of no use to it.
    var info = userInfo
    info["enc"] = nil
    info["chatJid"] = text(json["chatJid"])
    info["senderJid"] = text(json["senderJid"])
    info["sealed"] = true
    content.userInfo = info
  }

  private static func text(_ value: Any?) -> String {
    (value as? String) ?? ""
  }

  private static func open(sealed: Data, secretKey: Bytes) -> Data? {
    guard let opened = SealedBox.open([UInt8](sealed), secretKey: secretKey) else { return nil }
    return Data(opened)
  }

  private static func loadSecretKey() -> Bytes? {
    for service in keychainServices {
      for account in [Data(keychainAccount.utf8) as Any, keychainAccount as Any] {
        let query: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrService as String: service,
          kSecAttrAccount as String: account,
          kSecReturnData as String: true,
          kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let text = String(data: data, encoding: .utf8),
              let key = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines))
        else { continue }
        return Bytes(key)
      }
    }
    return nil
  }
}

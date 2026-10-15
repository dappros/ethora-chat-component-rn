import UniformTypeIdentifiers
import UserNotifications

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

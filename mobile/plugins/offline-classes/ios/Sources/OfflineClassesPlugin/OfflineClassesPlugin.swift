import Foundation
import UIKit
import Capacitor
import CommonCrypto

// Secure offline classes for iOS (iPhone + iPad).
// - download: BACKGROUND URLSession — the download continues with the screen
//   locked or the app closed; iOS relaunches us to finish (see AppDelegate's
//   handleEventsForBackgroundURLSession). Task identity survives relaunch via
//   taskDescription = "<id>|<expectedSize>".
// - decrypt: streams an AES-256-CBC decrypt to a temp .mp4 the web player can
//   play (the key is supplied per-play by the server and never stored).
@objc(OfflineClassesPlugin)
public class OfflineClassesPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    // SPM-style registration (replaces the old CAP_PLUGIN Objective-C macro).
    public let identifier = "OfflineClassesPlugin"
    public let jsName = "OfflineClasses"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isDownloaded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decrypt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
    ]

    // Set by AppDelegate when iOS relaunches the app for background-download
    // events; called once our session has processed them all.
    public static var backgroundCompletionHandler: (() -> Void)?

    private var activeCalls: [Int: CAPPluginCall] = [:] // taskId -> JS call (in-app only)

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "in.caclasses.app.downloads")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    // A plain foreground session, used only when the background one refuses.
    //
    // The background session is the right tool — it keeps downloading with the
    // app closed and the phone locked. But it is handed to a system daemon,
    // and when that daemon declines the whole download dies with a message
    // that says nothing. It never runs at all in the Simulator, which is why a
    // class that downloads perfectly well on a real iPhone fails there.
    //
    // So: one retry in the foreground. It only lasts while the app is open,
    // which is worse — but a class that downloads while you watch beats a class
    // that does not download at all.
    private lazy var foregroundSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    // Which downloads have already been retried, so a genuine failure is
    // reported instead of looping.
    private var retried = Set<String>()

    /// What actually went wrong, in words a student can act on.
    private func plainError(_ error: Error) -> String {
        let e = error as NSError
        switch e.code {
        case NSURLErrorNotConnectedToInternet: return "no internet connection"
        case NSURLErrorTimedOut:               return "the connection timed out"
        case NSURLErrorNetworkConnectionLost:  return "the connection dropped"
        case NSURLErrorCannotWriteToFile,
             NSURLErrorCannotCreateFile:       return "this iPhone is out of space"
        case NSURLErrorDataNotAllowed:         return "mobile data is not allowed for this app"
        case NSURLErrorCancelled:              return "the download was cancelled"
        default:
            let d = e.localizedDescription
            // "unknown error" helps nobody; the domain and code at least give
            // us something to search for when a student reports it.
            return d.isEmpty || d.lowercased().contains("unknown")
                ? "\(e.domain) \(e.code)"
                : d
        }
    }

    override public func load() {
        _ = session // reattach to any downloads still running from a previous launch
    }

    private func classesDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("classes", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func encPath(_ id: String) -> URL {
        return classesDir().appendingPathComponent("\(id).enc")
    }

    private func identity(of task: URLSessionTask) -> (id: String, expected: Int64)? {
        guard let desc = task.taskDescription else { return nil }
        let parts = desc.split(separator: "|", maxSplits: 1)
        guard let first = parts.first else { return nil }
        let expected = parts.count > 1 ? Int64(parts[1]) ?? 0 : 0
        return (String(first), expected)
    }

    // MARK: download
    @objc func download(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let urlStr = call.getString("url"), let url = URL(string: urlStr) else {
            call.reject("id and url are required"); return
        }
        let expectedSize = Int64(call.getDouble("expectedSize") ?? 0)
        let dest = encPath(id)
        if FileManager.default.fileExists(atPath: dest.path) {
            let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
            if expectedSize == 0 || size == expectedSize {
                call.resolve(["path": dest.path]); return
            }
        }
        call.keepAlive = true
        let task = session.downloadTask(with: url)
        task.taskDescription = "\(id)|\(expectedSize)" // survives app relaunch
        activeCalls[task.taskIdentifier] = call
        task.resume()
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let who = identity(of: downloadTask) else { return }
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : who.expected
        notifyListeners("downloadProgress", data: ["id": who.id, "received": totalBytesWritten, "total": total])
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let who = identity(of: downloadTask) else { return }
        let call = activeCalls[downloadTask.taskIdentifier] // nil if the app was relaunched
        let dest = encPath(who.id)
        do {
            if FileManager.default.fileExists(atPath: dest.path) { try FileManager.default.removeItem(at: dest) }
            try FileManager.default.moveItem(at: location, to: dest)
            let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
            if who.expected > 0, size != who.expected {
                try? FileManager.default.removeItem(at: dest)
                call?.reject("incomplete download: got \(size) of \(who.expected) bytes")
            } else {
                retried.remove(who.id)
                notifyListeners("downloadProgress", data: ["id": who.id, "received": size, "total": size])
                call?.resolve(["path": dest.path])
            }
        } catch {
            call?.reject("save failed: \(error.localizedDescription)")
        }
        activeCalls.removeValue(forKey: downloadTask.taskIdentifier)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let err = error else { return }
        let call = activeCalls[task.taskIdentifier]
        activeCalls.removeValue(forKey: task.taskIdentifier)

        // The background session failing is not the end of it — try once in the
        // foreground before telling the student it cannot be done.
        if let who = identity(of: task), !retried.contains(who.id),
           session.configuration.identifier != nil,
           let url = task.originalRequest?.url, let call = call {
            retried.insert(who.id)
            let retry = foregroundSession.downloadTask(with: url)
            retry.taskDescription = task.taskDescription
            activeCalls[retry.taskIdentifier] = call
            retry.resume()
            return
        }

        call?.reject("download failed — \(plainError(err))")
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            OfflineClassesPlugin.backgroundCompletionHandler?()
            OfflineClassesPlugin.backgroundCompletionHandler = nil
        }
    }

    // MARK: isDownloaded
    @objc func isDownloaded(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id required"); return }
        let dest = encPath(id)
        let exists = FileManager.default.fileExists(atPath: dest.path)
        let expected = Int64(call.getDouble("expectedSize") ?? 0)
        if exists, expected > 0 {
            let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
            call.resolve(["value": size == expected])
        } else {
            call.resolve(["value": exists])
        }
    }

    // MARK: remove
    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id required"); return }
        try? FileManager.default.removeItem(at: encPath(id))
        try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("play-\(id).mp4"))
        call.resolve()
    }

    // MARK: shareFile — present the iOS share sheet for a file the web layer
    // fetched (WKWebView has no Web Share API, so downloads/shares need native help).
    @objc func shareFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let b64 = call.getString("dataB64"),
              let data = Data(base64Encoded: b64) else {
            call.reject("name and dataB64 required"); return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url) } catch {
            call.reject("write failed: \(error.localizedDescription)"); return
        }
        DispatchQueue.main.async {
            let av = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = av.popoverPresentationController, let v = self.bridge?.viewController?.view {
                pop.sourceView = v
                pop.sourceRect = CGRect(x: v.bounds.midX, y: v.bounds.midY, width: 0, height: 0)
            }
            self.bridge?.viewController?.present(av, animated: true) { call.resolve() }
        }
    }

    // MARK: decrypt (streaming AES-256-CBC, PKCS7)
    @objc func decrypt(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let keyB64 = call.getString("keyB64") else {
            call.reject("id and keyB64 required"); return
        }
        let ivB64 = call.getString("ivB64")
        let enc = encPath(id)
        guard FileManager.default.fileExists(atPath: enc.path) else { call.reject("not downloaded"); return }
        guard let key = Data(base64Encoded: keyB64) else { call.reject("bad key"); return }
        let iv = ivB64.flatMap { Data(base64Encoded: $0) } ?? Data(count: 16)
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("play-\(id).mp4")
        call.keepAlive = true

        // Replay instantly: reuse the already-decrypted copy when it matches
        // (decrypted size = encrypted size minus 1–16 bytes of padding). iOS
        // clears the temp dir under storage pressure, so this self-heals.
        let encSize = (try? FileManager.default.attributesOfItem(atPath: enc.path)[.size] as? Int64) ?? 0
        let outSize = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int64) ?? 0
        if outSize > 0, encSize > 0, outSize >= encSize - 16, outSize < encSize {
            call.resolve(["path": out.path]); return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.streamDecrypt(src: enc, dst: out, key: key, iv: iv)
                call.resolve(["path": out.path])
            } catch {
                call.reject("decrypt failed: \(error.localizedDescription)")
            }
        }
    }

    private func streamDecrypt(src: URL, dst: URL, key: Data, iv: Data) throws {
        if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
        FileManager.default.createFile(atPath: dst.path, contents: nil)
        let input = try FileHandle(forReadingFrom: src)
        let output = try FileHandle(forWritingTo: dst)
        defer { try? input.close(); try? output.close() }

        var cryptor: CCCryptorRef?
        let status = key.withUnsafeBytes { keyPtr in
            iv.withUnsafeBytes { ivPtr in
                CCCryptorCreate(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                                keyPtr.baseAddress, key.count, ivPtr.baseAddress, &cryptor)
            }
        }
        guard status == kCCSuccess, let cr = cryptor else { throw NSError(domain: "decrypt", code: Int(status)) }
        defer { CCCryptorRelease(cr) }

        let chunk = 4 * 1024 * 1024 // 4 MB — fewer syscalls, ~4× faster than 256 KB
        let outBufSize = chunk + kCCBlockSizeAES128
        var outBuf = [UInt8](repeating: 0, count: outBufSize)

        while true {
            let data = input.readData(ofLength: chunk)
            if data.isEmpty { break }
            var moved = 0
            let st = data.withUnsafeBytes { inPtr in
                CCCryptorUpdate(cr, inPtr.baseAddress, data.count, &outBuf, outBufSize, &moved)
            }
            guard st == kCCSuccess else { throw NSError(domain: "decrypt", code: Int(st)) }
            if moved > 0 { output.write(Data(bytes: outBuf, count: moved)) }
        }
        var movedFinal = 0
        let stf = CCCryptorFinal(cr, &outBuf, outBufSize, &movedFinal)
        guard stf == kCCSuccess else { throw NSError(domain: "decrypt-final", code: Int(stf)) }
        if movedFinal > 0 { output.write(Data(bytes: outBuf, count: movedFinal)) }
    }
}

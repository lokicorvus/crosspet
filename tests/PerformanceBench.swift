import Cocoa
import WebKit

/// Isolated renderer benchmark: no hooks, user preferences, updater, or app state.
@MainActor final class PerformanceBench: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    let root: URL, mode: String, pose: String, ready: URL
    var window: NSWindow!, web: WKWebView!
    init(_ args: [String]) { root = URL(fileURLWithPath: args[1]); mode = args[2]; pose = args[3]; ready = URL(fileURLWithPath: args[4]) }
    func applicationDidFinishLaunching(_ note: Notification) {
        window = NSWindow(contentRect: NSRect(x: 20, y: 100, width: 260, height: 362), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false; window.backgroundColor = .clear; window.level = .floating
        web = WKWebView(frame: window.contentView!.bounds); web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self; window.contentView!.addSubview(web); window.orderFrontRegardless()
        web.loadFileURL(root.appendingPathComponent("app/web/index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { NSApp.terminate(nil) }
    }
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        do {
            let fm = FileManager.default
            var characters: [String: Any] = [:]
            for dir in try fm.contentsOfDirectory(at: root.appendingPathComponent("characters"), includingPropertiesForKeys: nil) {
                guard let data = try? Data(contentsOf: dir.appendingPathComponent("character.json")), var info = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                var poses: [String: [String]] = [:]
                for file in try fm.contentsOfDirectory(atPath: dir.path).sorted() where file.hasSuffix(".webp") || file.hasSuffix(".png") {
                    let name = (file as NSString).deletingPathExtension
                    if name == "idle-blink" { info["blink"] = dir.appendingPathComponent(file).absoluteString; continue }
                    if name == "idle" { info["blinkBase"] = dir.appendingPathComponent(file).absoluteString }
                    poses[String(name.split(separator: "-")[0]), default: []].append(dir.appendingPathComponent(file).absoluteString)
                }
                info["poses"] = poses; characters[dir.lastPathComponent] = info
            }
            let json = String(data: try JSONSerialization.data(withJSONObject: ["characters":characters]), encoding: .utf8)!
            web.evaluateJavaScript("setPerformanceMode('\(mode)'); setAuraMode('on'); setEggsEnabled(false); init(\(json)); setCharacter('gpt', true); devShow('gpt','\(pose)','',null,90000);") { _, error in
                if let error { fputs("\(error)\n", stderr); exit(1) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                    try? String(getpid()).write(to: self.ready, atomically: true, encoding: .utf8)
                }
            }
        } catch { fputs("\(error)\n", stderr); exit(1) }
    }
}
@main struct BenchMain {
    @MainActor static func main() {
        let app = NSApplication.shared, delegate = PerformanceBench(CommandLine.arguments)
        app.delegate = delegate; app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}

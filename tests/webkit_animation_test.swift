// Isolated WKWebView: does not launch CrossPet or access its settings/integrations.
import Cocoa
import WebKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let page = URL(fileURLWithPath: CommandLine.arguments[1])
let test = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
let output = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
final class AnimationTest: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let json = message.body as? String else { exit(1) }
        do {
            try json.write(to: output.appendingPathComponent("result.json"), atomically: true, encoding: .utf8)
            let result = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
            let passed = result?["passed"] as? Bool == true
            print(json)
            web.takeSnapshot(with: nil) { image, _ in
                if let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
                    try? png.write(to: output.appendingPathComponent("preview.png"))
                }
                exit(passed ? 0 : 1)
            }
        } catch { print(error); exit(1) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        web.evaluateJavaScript(test) { _, error in
            if let error = error { print(error); exit(1) }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print(error); exit(1)
    }
}
let runner = AnimationTest()
let config = WKWebViewConfiguration()
config.userContentController.add(runner, name: "result")
runner.web = WKWebView(frame: NSRect(x: 0, y: 0, width: 260, height: 362), configuration: config)
runner.web.navigationDelegate = runner
runner.window = NSWindow(contentRect: runner.web.bounds, styleMask: [.titled], backing: .buffered, defer: false)
runner.window.title = "CrossPet isolated SVG regression test"
runner.window.contentView = runner.web
runner.window.orderFrontRegardless()
runner.web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent().deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { print("WebKit test timed out"); exit(1) }
app.run()

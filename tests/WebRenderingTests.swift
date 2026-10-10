import Cocoa
import WebKit

/// Real WebKit regression: animation scheduling, events, image loads and settings.
@MainActor final class WebRenderingTests: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let root: URL
    var window: NSWindow!
    var web: WKWebView!
    var settingsPhase = false
    var messages: [[String: Any]] = []
    init(root: URL) { self.root = root }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 362), styleMask: [.borderless], backing: .buffered, defer: false)
        window.level = .floating
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "settings")
        config.userContentController.addUserScript(WKUserScript(source: """
            window.testIntervals = new Set(); window.testPreloads = 0;
            const originalInterval = window.setInterval, originalClear = window.clearInterval, OriginalImage = window.Image;
            window.setInterval = (...args) => { const id = originalInterval(...args); testIntervals.add(id); return id; };
            window.clearInterval = id => { testIntervals.delete(id); originalClear(id); };
            window.Image = class extends OriginalImage { constructor(...args) { super(...args); testPreloads++; } };
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        window.contentView!.addSubview(web)
        window.orderFrontRegardless()
        web.loadFileURL(root.appendingPathComponent("app/web/index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { fputs("FAIL: WebKit test timeout\n", stderr); exit(1) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any] { messages.append(body) }
    }

    func snapshot(_ name: String) async throws {
        let image = try await web.takeSnapshot(configuration: nil)
        guard let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { throw NSError(domain: "snapshot", code: 1) }
        try png.write(to: root.appendingPathComponent("build/\(name).png"))
    }

    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            do {
                if settingsPhase { try await settingsTest(); NSApp.terminate(nil); return }
                let image = root.appendingPathComponent("characters/gpt/idle.webp").absoluteString
                let readingImage = root.appendingPathComponent("characters/gpt/reading.webp").absoluteString
                let manifest: [String: Any] = ["characters": [
                    "test": ["name": "测试", "poses": ["idle": [image], "reading": [readingImage], "pat": [image]], "lines": ["reading": ["阅读中"], "pat": ["摸摸头"]]],
                    "unused": ["name": "未选角色", "poses": ["idle": [image]]],
                ]]
                let json = String(data: try JSONSerialization.data(withJSONObject: manifest), encoding: .utf8)!
                _ = try await web.evaluateJavaScript("setPerformanceMode('eco'); init(\(json)); setCharacter('test', true);")
                try await Task.sleep(nanoseconds: 600_000_000)
                _ = try await web.evaluateJavaScript("""
                    function check(ok, reason) { if (!ok) throw Error(reason) }
                    check(charId === 'test' && active.complete && active.naturalWidth > 0, 'local image loads');
                    check(testPreloads === 0, 'eco must not eagerly preload unused images');
                    window.baseIntervals = testIntervals.size;
                    shownAt = 0; applyCharState('test', {pose: 'reading', event: 'PreToolUse', tool: 'Read', ts: Date.now()/1000});
                    """)
                try await Task.sleep(nanoseconds: 350_000_000)
                _ = try await web.evaluateJavaScript("""
                    check(pose === 'reading' && currentUrl.endsWith('/reading.webp') && active.complete, 'work event changes visible image');
                    check($('bubble').textContent === '阅读中', 'work bubble updates');
                    check(document.getAnimations().length === 0 && !$('fx').firstChild, 'eco stops CSS and SVG loops');
                    check(JSON.parse(hitRects()).length > 0, 'pointer hit regions remain');
                    handleClick('pat'); check(pose === 'pat', 'click still responds');
                    setPerformanceMode('balanced'); init(\(json)); setPose('reading');
                    check(testPreloads === 0, 'balanced loads on demand');
                    """)
                try await Task.sleep(nanoseconds: 400_000_000)
                _ = try await web.evaluateJavaScript("""
                    window.testBodyLoop = document.getAnimations().find(a => a.effect.getTiming().iterations === Infinity && a.effect.target === $('body'));
                    check(testBodyLoop && testBodyLoop.playState === 'paused', 'balanced pauses the continuous native CSS clock');
                    window.loopTime = Number(testBodyLoop.currentTime); window.svgRoot = document.querySelector('#fx svg');
                    check(svgRoot && svgRoot.animationsPaused(), 'balanced pauses native SVG clock');
                    window.svgTime = svgRoot.getCurrentTime();
                    check(testIntervals.size === baseIntervals + 1, 'balanced uses one shared clock');
                    setAuraMode('off'); setAuraMode('on');
                    check(document.getAnimations().some(a=>a.animationName==='pulse' && a.playState==='paused'), 'newly enabled aura is also throttled');
                    """)
                try await Task.sleep(nanoseconds: 400_000_000)
                _ = try await web.evaluateJavaScript("""
                    check(Number(testBodyLoop.currentTime) > loopTime + 150, 'balanced CSS animation still advances');
                    check(svgRoot.getCurrentTime() > svgTime + .15, 'balanced SVG animation still advances');
                    $('body').className = 'm-leave';
                    """)
                try await Task.sleep(nanoseconds: 200_000_000)
                _ = try await web.evaluateJavaScript("""
                    check(!document.getAnimations().some(a=>a.effect.target===$('body') && a.effect.getTiming().iterations===Infinity), 'canceled body loop must not restart');
                    for (let n=0;n<12;n++) { setPerformanceMode('full'); setPerformanceMode('eco'); setPerformanceMode('balanced'); }
                    check(testIntervals.size === baseIntervals + 1, 'mode changes must not stack clocks');
                    Object.defineProperty(document, 'hidden', {configurable:true, value:true});
                    document.dispatchEvent(new Event('visibilitychange'));
                    check(testIntervals.size === baseIntervals, 'hidden page stops balanced clock');
                    delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
                    check(testIntervals.size === baseIntervals + 1, 'visible page restarts only one clock');
                    shownAt = 0; applyCharState('test', {pose:'idle', event:'Stop', ts:Date.now()/1000});
                    check(pose === 'idle', 'balanced work events remain active');
                    """)
                try await Task.sleep(nanoseconds: 400_000_000)
                try await snapshot("pet-balanced")
                _ = try await web.evaluateJavaScript("""
                    setPerformanceMode('full'); init(\(json));
                    check(testPreloads > 0, 'full preserves preloading');
                    check(testIntervals.size === baseIntervals, 'full removes manual clock');
                    """)
                try await Task.sleep(nanoseconds: 350_000_000)
                _ = try await web.evaluateJavaScript("""
                    check(document.getAnimations().some(a => a.effect.getTiming().iterations === Infinity && a.playState === 'running'), 'full resumes native animation');
                    check(!document.querySelector('#fx svg').animationsPaused(), 'full resumes native SVG');
                    setPerformanceMode('eco');
                    check(document.getAnimations().length === 0 && !$('fx').firstChild && testIntervals.size === baseIntervals, 'eco removes manual and native loops');
                    """)
                print("PASS: image loads, work events, clicks, three modes, advancing 10 Hz CSS/SVG, timer cleanup, lazy loading")
                settingsPhase = true
                window.setContentSize(NSSize(width: 520, height: 680))
                web.loadFileURL(root.appendingPathComponent("app/web/settings.html"), allowingReadAccessTo: root)
            } catch { fputs("FAIL: \(error)\n", stderr); exit(1) }
        }
    }

    func settingsTest() async throws {
        let state: [String: Any] = ["version":"1.2.4", "size":1, "performanceMode":"balanced", "lifecycleHost":"test.host", "lifecycleHosts":[["id":"", "name":"不绑定（默认）"], ["id":"test.host", "name":"测试宿主"]], "aura":"auto", "character":"gpt", "characters":[["id":"gpt", "name":"GPT", "defaultName":"GPT"]]]
        let json = String(data: try JSONSerialization.data(withJSONObject: state), encoding: .utf8)!
        _ = try await web.evaluateJavaScript("""
            function check(ok, reason) { if (!ok) throw Error(reason) }
            setState(\(json));
            check($('performanceLabel').textContent === '均衡', 'current mode has an explicit label');
            check($('performanceRow').getBoundingClientRect().bottom < innerHeight, 'mode is visible without scrolling');
            check(document.querySelector('#performance [data-v=balanced]').getAttribute('aria-pressed') === 'true', 'current selection is accessible');
            document.querySelector('#performance [data-v=eco]').click();
            check(!$('lifecycleRow').classList.contains('hidden') && $('lifecycleHost').value === 'test.host', 'selected lifecycle host is visible');
            $('lifecycleHost').value = ''; $('lifecycleHost').dispatchEvent(new Event('change'));
            """)
        try await Task.sleep(nanoseconds: 150_000_000)
        guard messages.contains(where: { $0["key"] as? String == "performanceMode" && $0["value"] as? String == "eco" }) else { throw NSError(domain: "settings bridge", code: 1) }
        guard messages.contains(where: { $0["key"] as? String == "lifecycleHost" && $0["value"] as? String == "" }) else { throw NSError(domain: "lifecycle settings bridge", code: 1) }
        try await snapshot("settings-balanced")
        _ = try await web.evaluateJavaScript("$('lifecycleRow').scrollIntoView();")
        try await snapshot("settings-lifecycle")
        _ = try await web.evaluateJavaScript("delete state.performanceMode; delete state.lifecycleHost; delete state.lifecycleHosts; setState(state); check($('performanceRow').classList.contains('hidden') && $('lifecycleRow').classList.contains('hidden'), 'older hosts hide unsupported settings');")
        print("PASS: visible modes and selected host, settings bridges, older-host compatibility")
    }
}

@main struct WebRenderingTestMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = WebRenderingTests(root: URL(fileURLWithPath: CommandLine.arguments[1]))
        app.delegate = delegate; app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}

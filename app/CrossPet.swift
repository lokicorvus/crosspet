// CrossPet：跨 AI 桌宠。透明无边框、永远在最上层、可拖动的小窗。
//
// 目录约定
//   ~/Library/Application Support/CrossPet/   运行目录（每次启动从 App 包里同步 web/ 和内置角色）
//       web/            画面（index.html + effects.js）
//       characters/     角色：<id>/character.json + 各姿态立绘（idle.webp、thinking-2.webp、idle-blink.webp …）
//                       自己加的角色放这里不会被覆盖
//       crosspet-hook.py  钩子脚本（Claude Code / Codex / Gemini CLI 用）
//   /tmp/crosspet/      各 AI 接入写的状态：<id>-state.json、<id>-quota.json
//
// 交互：单击 = 摸摸头；拖动 = 移动；右键 = 菜单（戳一下 / 彩蛋 / 换角色 / 改名 / 设置 / 退出）
import Cocoa
import ServiceManagement
import WebKit

let defaults = UserDefaults.standard
let stateDir = URL(fileURLWithPath: "/tmp/crosspet", isDirectory: true)

final class DragView: NSView {
    var onClick: (() -> Void)?
    var onMenu: ((NSEvent) -> Void)?
    private var downAt: NSPoint = .zero
    private var originAt: NSPoint = .zero
    private var dragged = false

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        originAt = window?.frame.origin ?? .zero
        dragged = false
    }
    override func mouseDragged(with event: NSEvent) {
        let p = NSEvent.mouseLocation
        let dx = p.x - downAt.x, dy = p.y - downAt.y
        if abs(dx) + abs(dy) > 3 { dragged = true }
        window?.setFrameOrigin(NSPoint(x: originAt.x + dx, y: originAt.y + dy))
    }
    override func mouseUp(with event: NSEvent) {
        if dragged {
            if let o = window?.frame.origin { defaults.set([o.x, o.y], forKey: "origin") }
        } else {
            onClick?()
        }
    }
    override func rightMouseDown(with event: NSEvent) { onMenu?(event) }
}

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var panel: NSPanel!
    var web: WKWebView!
    var timer: Timer?
    var quotaTimer: Timer?
    var ready = false
    var currentId: String?

    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("CrossPet", isDirectory: true)
    var charactersDir: URL { root.appendingPathComponent("characters") }

    var characterIds: [String] = []           // 可切换的角色（不含彩蛋）
    var displayNames: [String: String] = [:]  // id → 显示名（含用户改的名）
    var appToCharacter: [String: String] = [:]
    var stamps: [String: Date] = [:]

    // MARK: 启动

    func applicationDidFinishLaunching(_ note: Notification) {
        syncBundledResources()

        let size = NSSize(width: 260, height: 362)
        var origin = NSPoint.zero
        if let saved = defaults.array(forKey: "origin") as? [Double], saved.count == 2 {
            origin = NSPoint(x: saved[0], y: saved[1])
        } else if let screen = NSScreen.main?.visibleFrame {
            origin = NSPoint(x: screen.maxX - size.width - 40, y: screen.minY + 100)
        }
        panel = NSPanel(contentRect: NSRect(origin: origin, size: size),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        web = WKWebView(frame: container.bounds, configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.loadFileURL(root.appendingPathComponent("web/index.html"), allowingReadAccessTo: root)
        container.addSubview(web)

        let drag = DragView(frame: container.bounds)
        drag.autoresizingMask = [.width, .height]
        drag.onClick = { [weak self] in self?.js("handleClick('pat')") }
        drag.onMenu = { [weak self] e in self?.showMenu(e, in: drag) }
        container.addSubview(drag)

        panel.contentView = container
        panel.orderFrontRegardless()

        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(appActivated(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.pollStates() }
        quotaTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshGPTQuota() }
    }

    /// 把 App 包里的 web/、钩子脚本和内置角色同步到运行目录。用户自己加的角色目录不动。
    func syncBundledResources() {
        let fm = FileManager.default
        guard let res = Bundle.main.resourceURL else { return }
        try? fm.createDirectory(at: charactersDir, withIntermediateDirectories: true)
        func replace(_ name: String, in base: URL, from src: URL) {
            let dst = base.appendingPathComponent(name)
            try? fm.removeItem(at: dst)
            try? fm.copyItem(at: src.appendingPathComponent(name), to: dst)
        }
        if fm.fileExists(atPath: res.appendingPathComponent("web").path) { replace("web", in: root, from: res) }
        if fm.fileExists(atPath: res.appendingPathComponent("crosspet-hook.py").path) { replace("crosspet-hook.py", in: root, from: res) }
        let bundled = res.appendingPathComponent("characters")
        for dir in (try? fm.contentsOfDirectory(atPath: bundled.path)) ?? [] {
            replace(dir, in: charactersDir, from: bundled)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        loadCharacters()
        stamps = [:]
        pollStates()
        refreshGPTQuota()
        if let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier, let id = appToCharacter[front] {
            switchTo(id)
        }
    }

    // MARK: 角色

    /// 扫描 characters/<id>/：character.json + 立绘（.webp / .png）。文件名去掉 -2、-3 后缀是姿态名，idle-blink 是眨眼帧。
    func loadCharacters() {
        var chars: [String: Any] = [:]
        appToCharacter = [:]
        characterIds = []
        displayNames = [:]
        let fm = FileManager.default
        let renamed = defaults.dictionary(forKey: "names") as? [String: String] ?? [:]
        let dirs = (try? fm.contentsOfDirectory(at: charactersDir, includingPropertiesForKeys: nil)) ?? []
        for dir in dirs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("character.json")),
                  var info = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            let files = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? [])
                .filter { $0.hasSuffix(".webp") || $0.hasSuffix(".png") }.sorted()
            var poses: [String: [String]] = [:]
            var blink: String?
            for f in files {
                let name = (f as NSString).deletingPathExtension
                let url = dir.appendingPathComponent(f).absoluteString
                if name == "idle-blink" { blink = url; continue }
                let pose = name.split(separator: "-").first.map(String.init) ?? name
                poses[pose, default: []].append(url)
            }
            let id = dir.lastPathComponent
            let isEgg = info["egg"] as? Bool == true  // 彩蛋角色：不进菜单、不绑应用
            guard isEgg || poses["idle"] != nil || poses["default"] != nil else { continue }
            if !isEgg, let custom = renamed[id], !custom.isEmpty { info["name"] = custom }
            info["poses"] = poses
            info["blink"] = blink ?? NSNull()
            chars[id] = info
            if isEgg { continue }
            characterIds.append(id)
            displayNames[id] = info["name"] as? String ?? id
            for app in (info["apps"] as? [String]) ?? [] { appToCharacter[app] = id }
        }
        guard let json = try? JSONSerialization.data(withJSONObject: ["characters": chars]),
              let arg = String(data: json, encoding: .utf8) else { return }
        js("init(\(arg))")
    }

    func switchTo(_ id: String) {
        currentId = id
        js("setCharacter(\(quote(id)))")
    }

    @objc func appActivated(_ note: Notification) {
        guard ready,
              let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              let bundle = app.bundleIdentifier, let id = appToCharacter[bundle] else { return }
        switchTo(id)
    }

    // MARK: 状态与额度

    /// 读 /tmp/crosspet/<id>-state.json 和 <id>-quota.json，有变化就交给画面。
    func pollStates() {
        guard ready else { return }
        for id in characterIds {
            for kind in ["state", "quota"] {
                let url = stateDir.appendingPathComponent("\(id)-\(kind).json")
                let key = "\(id)-\(kind)"
                guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                      let stamp = attrs[.modificationDate] as? Date, stamp != stamps[key] else { continue }
                stamps[key] = stamp
                // 状态只认 10 分钟内的，免得开机读到旧状态
                if kind == "state", Date().timeIntervalSince(stamp) > 600 { continue }
                guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { continue }
                js(kind == "state" ? "applyCharState(\(quote(id)), \(text))" : "setQuota(\(quote(id)), \(text))")
            }
        }
    }

    /// GPT 额度（可选，默认关）：读 ~/.codex/sessions 最新会话记录里最后一条 rate_limits，只取额度数字。
    func refreshGPTQuota() {
        guard ready, defaults.bool(forKey: "gptQuota"), let q = codexQuota(),
              let data = try? JSONSerialization.data(withJSONObject: q), let arg = String(data: data, encoding: .utf8) else { return }
        js("setQuota('gpt', \(arg))")
    }

    func codexQuota() -> [String: Any]? {
        let fm = FileManager.default
        let base = fm.homeDirectoryForCurrentUser.appendingPathComponent(".codex/sessions")
        let cal = Calendar.current
        var newest: (URL, Date)?
        for back in 0..<4 {
            guard let day = cal.date(byAdding: .day, value: -back, to: Date()) else { continue }
            let c = cal.dateComponents([.year, .month, .day], from: day)
            let dir = base.appendingPathComponent(String(format: "%04d/%02d/%02d", c.year!, c.month!, c.day!))
            for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            where f.pathExtension == "jsonl" {
                let m = (try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                if newest == nil || m > newest!.1 { newest = (f, m) }
            }
        }
        guard let file = newest?.0, let h = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? h.close() }
        let size = (try? h.seekToEnd()) ?? 0
        try? h.seek(toOffset: size > 1_000_000 ? size - 1_000_000 : 0)
        guard let data = try? h.readToEnd(), let text = String(data: data, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n").reversed() where line.contains("\"rate_limits\"") {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)),
                  let rl = findRateLimits(obj) else { continue }
            // 各窗口百分比，只给用得最多的那个标重置时间
            var windows: [(label: String, used: Double, reset: Double?)] = []
            for key in ["primary", "secondary"] {
                guard let w = rl[key] as? [String: Any], let used = (w["used_percent"] as? NSNumber)?.doubleValue else { continue }
                let minutes = (w["window_minutes"] as? NSNumber)?.intValue ?? 0
                let label = minutes >= 7 * 24 * 60 ? "本周" : minutes >= 24 * 60 ? "今日" : "\(max(1, minutes / 60))小时"
                windows.append((label, used, (w["resets_at"] as? NSNumber)?.doubleValue))
            }
            guard !windows.isEmpty else { continue }
            let maxUsed = windows.map { $0.used }.max() ?? 0
            var marked = false
            let parts = windows.map { w -> String in
                var piece = "\(w.label) \(Int(w.used.rounded()))%"
                if !marked, w.used == maxUsed, let reset = w.reset {
                    marked = true
                    let d = Date(timeIntervalSince1970: reset)
                    let fmt = DateFormatter()
                    fmt.dateFormat = d.timeIntervalSinceNow < 86400 ? "HH:mm" : "M/d"
                    piece += " · \(fmt.string(from: d)) 重置"
                }
                return piece
            }
            return ["text": parts.joined(separator: " ｜ "), "low": maxUsed >= 90]
        }
        return nil
    }

    func findRateLimits(_ o: Any) -> [String: Any]? {
        if let d = o as? [String: Any] {
            if let rl = d["rate_limits"] as? [String: Any] { return rl }
            for v in d.values { if let r = findRateLimits(v) { return r } }
        } else if let a = o as? [Any] {
            for v in a { if let r = findRateLimits(v) { return r } }
        }
        return nil
    }

    // MARK: 菜单

    func showMenu(_ event: NSEvent, in view: NSView) {
        let menu = NSMenu()
        add(menu, "摸摸头", #selector(pat))
        add(menu, "戳一下", #selector(poke))
        add(menu, "召唤彩蛋", #selector(egg))
        if characterIds.count > 1 {
            menu.addItem(.separator())
            for id in characterIds {
                let item = NSMenuItem(title: "换成 \(displayNames[id] ?? id)", action: #selector(switchCharacter(_:)), keyEquivalent: "")
                item.representedObject = id
                item.target = self
                item.state = id == currentId ? .on : .off
                menu.addItem(item)
            }
        }
        menu.addItem(.separator())
        add(menu, "给当前角色改名…", #selector(rename))
        let gpt = add(menu, "显示 GPT 额度（读取 Codex 会话记录）", #selector(toggleGPTQuota))
        gpt.state = defaults.bool(forKey: "gptQuota") ? .on : .off
        let login = add(menu, "登录时自动启动", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        add(menu, "打开角色文件夹", #selector(openCharacters))
        add(menu, "重新载入", #selector(reload))
        add(menu, "回到右下角", #selector(resetPosition))
        menu.addItem(.separator())
        add(menu, "退出 CrossPet", #selector(quit))
        NSMenu.popUpContextMenu(menu, with: event, for: view)
    }

    @discardableResult
    func add(_ menu: NSMenu, _ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc func pat() { js("handleClick('pat')") }
    @objc func poke() { js("handleClick('poke')") }
    @objc func egg() { js("playEgg(true)") }
    @objc func switchCharacter(_ item: NSMenuItem) {
        if let id = item.representedObject as? String { switchTo(id) }
    }

    @objc func rename() {
        guard let id = currentId ?? characterIds.first else { return }
        let alert = NSAlert()
        alert.messageText = "给 \(displayNames[id] ?? id) 改名"
        alert.informativeText = "留空则恢复默认名字。"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 220, height: 24))
        field.stringValue = displayNames[id] ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "好")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var names = defaults.dictionary(forKey: "names") as? [String: String] ?? [:]
        let value = field.stringValue.trimmingCharacters(in: .whitespaces)
        if value.isEmpty { names.removeValue(forKey: id) } else { names[id] = value }
        defaults.set(names, forKey: "names")
        loadCharacters()
        js("setName(\(quote(id)), \(quote(displayNames[id] ?? id)))")
    }

    @objc func toggleGPTQuota() {
        let on = !defaults.bool(forKey: "gptQuota")
        defaults.set(on, forKey: "gptQuota")
        if on { refreshGPTQuota() } else { js("setQuota('gpt', null)") }
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            let alert = NSAlert()
            alert.messageText = "设置失败"
            alert.informativeText = "请把 CrossPet.app 放进「应用程序」文件夹后再试。\n\(error.localizedDescription)"
            alert.runModal()
        }
    }

    @objc func openCharacters() { NSWorkspace.shared.open(charactersDir) }
    @objc func reload() { web.reload() }
    @objc func resetPosition() {
        guard let screen = NSScreen.main?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: screen.maxX - panel.frame.width - 40, y: screen.minY + 100))
        defaults.removeObject(forKey: "origin")
    }
    @objc func quit() { NSApp.terminate(nil) }

    // MARK: 工具

    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }
    func quote(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        return String(data: data ?? Data(), encoding: .utf8).map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

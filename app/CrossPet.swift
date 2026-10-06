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
    var pendingSwitch: DispatchWorkItem?
    var latestRelease: (tag: String, url: URL)?
    var manifestJSON = "{}"                    // 最近一次发给桌宠的角色清单，开发者控制台也要用
    var devWindow: NSWindow?
    var devWeb: WKWebView?
    var settingsWindow: NSWindow?
    var settingsWeb: WKWebView?
    var defaultNames: [String: String] = [:]   // id → character.json 里的原名（设置页显示占位用）
    var pauseRealEvents = false                // 控制台里测试时，先不让真实 AI 的状态打扰桌宠

    // MARK: 启动

    func applicationDidFinishLaunching(_ note: Notification) {
        syncBundledResources()

        let size = NSSize(width: Self.baseSize.width * petScale, height: Self.baseSize.height * petScale)
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
        web.pageZoom = petScale
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
        quotaTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshGPTQuota(); self?.refreshAntigravityQuota() }
        Timer.scheduledTimer(withTimeInterval: 24 * 3600, repeats: true) { [weak self] _ in self?.checkForUpdate(manual: false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.checkForUpdate(manual: false) }
    }

    // MARK: 更新
    // 每天查一次 GitHub 上最新的 Release（只读公开的版本号，不发送任何数据）。
    // 自己 fork 的话改这里的仓库名。
    let repoSlug = "lokicorvus/crosspet"
    var currentVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }

    func isNewer(_ tag: String, than current: String) -> Bool {
        let a = tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV")).split(separator: ".").map { Int($0) ?? 0 }
        let b = current.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    func checkForUpdate(manual: Bool) {
        guard let url = URL(string: "https://api.github.com/repos/\(repoSlug)/releases/latest") else { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self = self else { return }
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let tag = obj?["tag_name"] as? String ?? ""
            let page = (obj?["html_url"] as? String).flatMap(URL.init(string:))
            DispatchQueue.main.async {
                if !tag.isEmpty, let page = page, self.isNewer(tag, than: self.currentVersion) {
                    let isFresh = self.latestRelease?.tag != tag
                    self.latestRelease = (tag, page)
                    if isFresh || manual { self.js("notifyUpdate(\(self.quote(tag)))") }
                    self.pushSettings()
                } else if manual {
                    let alert = NSAlert()
                    alert.messageText = tag.isEmpty ? "暂时连不上 GitHub" : "已经是最新版（\(self.currentVersion)）"
                    NSApp.activate(ignoringOtherApps: true)
                    alert.runModal()
                }
            }
        }.resume()
    }

    // 一键更新：在后台跑一遍官方安装命令（get.sh：下载最新的 macOS 安装包 → 替换 App → 按新版刷新已接入的 AI → 重新打开），
    // 和用户自己在终端里运行那条命令完全一样，只是不再逐个问要接入哪些 AI。只在装在默认位置（应用程序文件夹）时提供
    var updating = false
    var canSelfUpdate: Bool {
        let dir = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL.path
        return dir == "/Applications" || dir == FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").standardizedFileURL.path
    }

    @objc func selfUpdate() {
        guard !updating, let r = latestRelease else { return }
        let alert = NSAlert()
        alert.messageText = "更新到 \(r.tag)？"
        alert.informativeText = "会自动下载、安装并重新打开，设置、角色和 AI 接入都保留。"
        alert.addButton(withTitle: "更新")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        updating = true
        js("say(\(quote("正在下载新版本…")))")
        let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/CrossPet-update.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", "curl -fsSL https://raw.githubusercontent.com/\(repoSlug)/main/get.sh | bash"]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
        env["CROSSPET_CONNECT"] = "none"   // 只刷新已经接入的，不问新的
        env["CROSSPET_PREFER_DIR"] = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL.path  // 装回原来的位置
        p.environment = env
        if let log = try? FileHandle(forWritingTo: logURL) { p.standardOutput = log; p.standardError = log }
        // 正常情况下安装命令会关掉这个旧版、装好后打开新版，走不到这里；还活着说明没成功
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self else { return }
                self.updating = false
                guard proc.terminationStatus != 0 else { return }
                let fail = NSAlert()
                fail.messageText = "自动更新没成功"
                fail.informativeText = "详情在 ~/Library/Logs/CrossPet-update.log。要打开下载页手动更新吗？"
                fail.addButton(withTitle: "打开下载页")
                fail.addButton(withTitle: "取消")
                NSApp.activate(ignoringOtherApps: true)
                if fail.runModal() == .alertFirstButtonReturn { self.openRelease() }
            }
        }
        do { try p.run() } catch { updating = false; openRelease() }
    }

    @objc func openRelease() { if let url = latestRelease?.url { NSWorkspace.shared.open(url) } }
    @objc func manualCheck() { checkForUpdate(manual: true) }

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
        // 已经接入过的才更新，没接入的不碰
        let mods = fm.homeDirectoryForCurrentUser.appendingPathComponent(".claude/mods/crosspet")
        let modSrc = res.appendingPathComponent("integrations/claude-code/mod")
        if fm.fileExists(atPath: mods.path), fm.fileExists(atPath: modSrc.path) {
            try? fm.removeItem(at: mods); try? fm.copyItem(at: modSrc, to: mods)
        }
        let dsh = root.appendingPathComponent("dsh-plugin-crosspet")
        let dshSrc = res.appendingPathComponent("integrations/deepseek/dsh-plugin-crosspet")
        if fm.fileExists(atPath: dsh.path), fm.fileExists(atPath: dshSrc.path) {
            try? fm.removeItem(at: dsh); try? fm.copyItem(at: dshSrc, to: dsh)
        }
        let bundled = res.appendingPathComponent("characters")
        for dir in (try? fm.contentsOfDirectory(atPath: bundled.path)) ?? [] {
            replace(dir, in: charactersDir, from: bundled)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === settingsWeb { pushSettings(); return }
        if webView === devWeb {
            let info = ["version": currentVersion, "feedbackPath": feedbackURL.path]
            let data = (try? JSONSerialization.data(withJSONObject: info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            devJS("setAppInfo(\(data)); boot(\(manifestJSON))")
            return
        }
        ready = true
        loadCharacters()
        js("setAuraMode(\(quote(auraMode))); setShowName(\(showName))")
        stamps = [:]
        pollStates()
        refreshGPTQuota()
        refreshAntigravityQuota()
        if followApps, let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier, let id = appToCharacter[front] {
            switchTo(hostCharacter(id))
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
            var blinkBase: String?  // 眨眼帧是照着 idle 本身（不是 idle-2、idle-3）画的
            for f in files {
                let name = (f as NSString).deletingPathExtension
                let url = dir.appendingPathComponent(f).absoluteString
                if name == "idle-blink" { blink = url; continue }
                if name == "idle" { blinkBase = url }
                let pose = name.split(separator: "-").first.map(String.init) ?? name
                poses[pose, default: []].append(url)
            }
            let id = dir.lastPathComponent
            let isEgg = info["egg"] as? Bool == true  // 彩蛋角色：不进菜单、不绑应用
            guard isEgg ? poses["pop"] != nil : (poses["idle"] != nil || poses["default"] != nil) else { continue }
            if !isEgg { defaultNames[id] = info["name"] as? String ?? id }
            if !isEgg, let custom = renamed[id], !custom.isEmpty { info["name"] = custom }
            info["poses"] = poses
            info["blink"] = blink ?? NSNull()
            info["blinkBase"] = blinkBase ?? NSNull()
            chars[id] = info
            if isEgg { continue }
            characterIds.append(id)
            displayNames[id] = info["name"] as? String ?? id
            for app in (info["apps"] as? [String]) ?? [] { appToCharacter[app] = id }
        }
        guard let json = try? JSONSerialization.data(withJSONObject: ["characters": chars]),
              let arg = String(data: json, encoding: .utf8) else { return }
        manifestJSON = arg
        js("init(\(arg))")
        devJS("boot(\(arg))")
    }

    func switchTo(_ id: String) {
        currentId = id
        js("setCharacter(\(quote(id)))")
        pushSettings()
    }

    /// 一个 App 里能用好几家模型（比如 DeepSeek Harness）：它的接入插件把当前角色写在 <角色>-host.json，
    /// 切到这个 App 时换成那个角色。一天内写的才算，角色不存在就还用 character.json 里绑定的
    func hostCharacter(_ id: String) -> String {
        let url = stateDir.appendingPathComponent("\(id)-host.json")
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let stamp = attrs[.modificationDate] as? Date, Date().timeIntervalSince(stamp) < 86400,
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let c = obj["character"] as? String, characterIds.contains(c) else { return id }
        return c
    }

    /// 切到某个 AI 的 App 后，要在它上面停留一会儿才换角色：
    /// App 启动时窗口会短暂地抢焦点、让焦点，立即响应会来回闪。
    @objc func appActivated(_ note: Notification) {
        guard ready, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        pendingSwitch?.cancel()
        guard followApps, let bundle = app.bundleIdentifier, let mapped = appToCharacter[bundle] else { return }
        let id = hostCharacter(mapped)
        guard id != currentId else { return }
        let work = DispatchWorkItem { [weak self] in
            guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundle else { return }
            self?.switchTo(id)
        }
        pendingSwitch = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
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
                devJS("logEvent(\(quote(id)), \(quote(kind)), \(text), \(pauseRealEvents))")
                if pauseRealEvents { continue }
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
        var files: [(URL, Date)] = []
        for back in 0..<4 {
            guard let day = cal.date(byAdding: .day, value: -back, to: Date()) else { continue }
            let c = cal.dateComponents([.year, .month, .day], from: day)
            let dir = base.appendingPathComponent(String(format: "%04d/%02d/%02d", c.year!, c.month!, c.day!))
            for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            where f.pathExtension == "jsonl" {
                files.append((f, (try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast))
            }
        }
        // 从最新的会话往前找：刚开的会话可能还没有额度记录
        for (file, _) in files.sorted(by: { $0.1 > $1.1 }).prefix(8) {
            if let q = quotaIn(file) { return q }
        }
        return nil
    }

    func quotaIn(_ file: URL) -> [String: Any]? {
        guard let h = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? h.close() }
        let size = (try? h.seekToEnd()) ?? 0
        try? h.seek(toOffset: size > 1_000_000 ? size - 1_000_000 : 0)
        guard let data = try? h.readToEnd() else { return nil }
        let text = String(decoding: data, as: UTF8.self)  // 从中间截断可能切在中文字符里，容错解码
        for line in text.split(separator: "\n").reversed() where line.contains("\"rate_limits\"") {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)),
                  let rl = findRateLimits(obj) else { continue }
            // 各窗口显示「剩余」百分比（和 Codex 自己的「使用情况」一致），只给剩得最少的那个标重置时间
            var windows: [(label: String, used: Double, reset: Double?)] = []
            for key in ["primary", "secondary"] {
                guard let w = rl[key] as? [String: Any], let used = (w["used_percent"] as? NSNumber)?.doubleValue else { continue }
                let minutes = (w["window_minutes"] as? NSNumber)?.intValue ?? 0
                let label = minutes >= 7 * 24 * 60 ? "本周" : minutes >= 24 * 60 ? "今日" : "\(max(1, minutes / 60))小时"
                windows.append((label, used, (w["resets_at"] as? NSNumber)?.doubleValue))
            }
            guard !windows.isEmpty else { continue }
            let now = Date().timeIntervalSince1970
            let live = windows.filter { ($0.reset ?? 0) == 0 || $0.reset! > now }
            let maxUsed = live.map { $0.used }.max() ?? 0
            var marked = false
            let parts = windows.map { w -> String in
                // 记录之后过了重置时间、又没有新记录（没再用 Codex）：这个窗口现在是满的
                if let r = w.reset, r > 0, r <= now { return "\(w.label) 剩余 100%" }
                var piece = "\(w.label) 剩余 \(max(0, 100 - Int(w.used.rounded())))%"
                if !marked, w.used == maxUsed, let reset = w.reset {
                    marked = true
                    let d = Date(timeIntervalSince1970: reset)
                    let fmt = DateFormatter()
                    fmt.dateFormat = d.timeIntervalSinceNow < 86400 ? "HH:mm" : "M/d"
                    piece += " · \(fmt.string(from: d)) 重置"
                }
                return piece
            }
            // windows 给桌宠比对用：某个窗口在预定重置时间前突然恢复一大截 → 播 reset 动画
            let raw = windows.map { w -> [String: Any] in ["label": w.label, "used": w.used, "reset": w.reset ?? 0] }
            return ["text": parts.joined(separator: " ｜ "), "low": maxUsed >= 90, "windows": raw]
        }
        return nil
    }

    // MARK: Gemini 额度（可选，默认关）
    // Antigravity 在本机跑着一个后台服务（language_server），它自己的界面就是向它要额度的。
    // 这里做同样的事：从它的启动参数里取本机接口的防伪令牌（每次启动随机生成、只在本机有效，不是账号凭据），
    // 只调「用户状态」接口、只取额度数字；令牌只在内存里用，不存盘、不外传。Antigravity 没开就不显示。
    var agySession: URLSession?
    var agyPort: (pid: Int32, port: Int)?

    func refreshAntigravityQuota() {
        guard ready, defaults.bool(forKey: "agyQuota") else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            guard let (pid, token) = self.antigravityServer() else {
                DispatchQueue.main.async { self.js("setQuota('gemini', null)") }
                return
            }
            let ports = self.agyPort?.pid == pid ? [self.agyPort!.port] : self.listeningPorts(pid)
            self.askAntigravity(pid: pid, token: token, ports: ports)
        }
    }

    /// 找到 Antigravity 的 language_server 进程，返回 (pid, 令牌)
    func antigravityServer() -> (Int32, String)? {
        guard let out = run("/bin/ps", ["-axo", "pid=,command="]) else { return nil }
        for line in out.split(separator: "\n") where line.contains("Antigravity.app/Contents/Resources/bin/language_server") {
            let parts = line.split(separator: " ").map(String.init)
            guard let pid = Int32(parts.first ?? "") else { continue }
            for (i, a) in parts.enumerated() {
                if a.hasPrefix("--csrf_token=") { return (pid, String(a.dropFirst("--csrf_token=".count))) }
                if a == "--csrf_token", i + 1 < parts.count { return (pid, parts[i + 1]) }
            }
        }
        return nil
    }

    func listeningPorts(_ pid: Int32) -> [Int] {
        guard let out = run("/usr/sbin/lsof", ["-nP", "-a", "-p", "\(pid)", "-iTCP", "-sTCP:LISTEN"]) else { return [] }
        return out.split(separator: "\n").dropFirst().compactMap { line in
            line.split(separator: " ").first { $0.contains("127.0.0.1:") }.flatMap { Int($0.split(separator: ":").last ?? "") }
        }
    }

    func run(_ path: String, _ args: [String]) -> String? {
        let p = Process(), pipe = Pipe()
        p.executableURL = URL(fileURLWithPath: path); p.arguments = args
        p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(data: data, encoding: .utf8)
    }

    func askAntigravity(pid: Int32, token: String, ports: [Int]) {
        guard let port = ports.first else { return }
        var req = URLRequest(url: URL(string: "https://127.0.0.1:\(port)/exa.language_server_pb.LanguageServerService/GetUserStatus")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 5
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "X-Codeium-Csrf-Token")
        req.httpBody = #"{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}"#.data(using: .utf8)
        if agySession == nil { agySession = URLSession(configuration: .ephemeral, delegate: LocalhostTrust(), delegateQueue: nil) }
        agySession!.dataTask(with: req) { [weak self] data, resp, _ in
            guard let self else { return }
            guard (resp as? HTTPURLResponse)?.statusCode == 200, let data,
                  let obj = try? JSONSerialization.jsonObject(with: data), let q = Self.antigravityQuota(obj) else {
                self.agyPort = nil
                self.askAntigravity(pid: pid, token: token, ports: Array(ports.dropFirst()))  // 换下一个端口试
                return
            }
            self.agyPort = (pid, port)
            guard let json = try? JSONSerialization.data(withJSONObject: q), let arg = String(data: json, encoding: .utf8) else { return }
            DispatchQueue.main.async { self.js("setQuota('gemini', \(arg))") }
        }.resume()
    }

    /// 额度按「额度池」共享（比如所有 Gemini 模型一个池，Claude 和 GPT-OSS 一个池）：
    /// 按 (剩余比例, 重置时间) 分组，每组用模型家族名命名，Gemini 池排前面。
    /// 不写死「5 小时 / 每周」：24 小时内重置显示时刻，否则显示日期，免费版和会员都适用。
    static func antigravityQuota(_ obj: Any) -> [String: Any]? {
        guard let st = (obj as? [String: Any])?["userStatus"] as? [String: Any],
              let cfg = st["cascadeModelConfigData"] as? [String: Any],
              let models = cfg["clientModelConfigs"] as? [[String: Any]] else { return nil }
        var pools: [(key: String, left: Double, reset: Date?, families: [String])] = []
        let iso = ISO8601DateFormatter()
        for m in models {
            guard let qi = m["quotaInfo"] as? [String: Any] else { continue }
            let left = (qi["remainingFraction"] as? NSNumber)?.doubleValue ?? 0  // 用完时这个字段会被省略
            let resetText = qi["resetTime"] as? String ?? ""
            let family = (m["label"] as? String ?? "").split(separator: " ").first.map(String.init) ?? "?"
            let key = "\(left)|\(resetText)"
            if let i = pools.firstIndex(where: { $0.key == key }) {
                if !pools[i].families.contains(family) { pools[i].families.append(family) }
            } else {
                pools.append((key, left, iso.date(from: resetText), [family]))
            }
        }
        guard !pools.isEmpty else { return nil }
        pools.sort { ($0.families.contains("Gemini") ? 0 : 1, $0.left) < ($1.families.contains("Gemini") ? 0 : 1, $1.left) }
        let minLeft = pools.map { $0.left }.min() ?? 1
        let fmt = DateFormatter()
        let parts = pools.enumerated().map { i, p -> String in
            var piece = "\(p.families.joined(separator: "/")) 剩余 \(Int((p.left * 100).rounded()))%"
            // 重置时间标在排第一的池（有 Gemini 时就是 Gemini 池）上；别的池快用完了也标
            if i == 0 || p.left <= 0.1, let d = p.reset {
                fmt.dateFormat = d.timeIntervalSinceNow < 86400 ? "HH:mm" : "M/d"
                piece += " · \(fmt.string(from: d)) 重置"
            }
            return piece
        }
        return ["text": parts.joined(separator: " ｜ "), "low": minLeft <= 0.1]
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
        if let r = latestRelease {
            if canSelfUpdate {
                add(menu, updating ? "⬆️ 正在更新到 \(r.tag)…" : "⬆️ 更新到 \(r.tag)", #selector(selfUpdate))
            } else {
                add(menu, "⬆️ 有新版本 \(r.tag)，点这里下载", #selector(openRelease))
            }
            menu.addItem(.separator())
        }
        add(menu, "摸摸头", #selector(pat))
        add(menu, "戳一下", #selector(poke))
        add(menu, "召唤彩蛋", #selector(egg))
        if characterIds.count > 1 {
            menu.addItem(.separator())
            let switchItem = NSMenuItem(title: "换角色", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for id in characterIds {
                let item = NSMenuItem(title: displayNames[id] ?? id, action: #selector(switchCharacter(_:)), keyEquivalent: "")
                item.representedObject = id
                item.target = self
                item.state = id == currentId ? .on : .off
                sub.addItem(item)
            }
            switchItem.submenu = sub
            menu.addItem(switchItem)
        }
        menu.addItem(.separator())
        add(menu, "设置…", #selector(openSettings))
        if NSEvent.modifierFlags.contains(.option) {  // 按住 ⌥ 右键才出现：给自己换立绘、加角色的人检查效果用
            add(menu, "开发者控制台…", #selector(openDevConsole))
        }
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

    @objc func toggleAntigravityQuota() {
        let on = !defaults.bool(forKey: "agyQuota")
        defaults.set(on, forKey: "agyQuota")
        if on { refreshAntigravityQuota() } else { js("setQuota('gemini', null)") }
    }

    /// 背景光晕：auto（跟着系统深浅色，深色模式下关）/ on / off
    var auraMode: String { defaults.string(forKey: "auraMode") ?? "auto" }
    @objc func setAura(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        defaults.set(mode, forKey: "auraMode")
        js("setAuraMode(\(quote(mode)))")
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

    // MARK: 设置
    // 一个独立窗口（web/settings.html，和 Windows 版共用），右键菜单只留常用的几项，其余都在这里
    static let baseSize = NSSize(width: 260, height: 362)
    var petScale: CGFloat {
        let v = defaults.double(forKey: "size")
        return v >= 0.6 && v <= 1.6 ? CGFloat(v) : 1
    }
    var showName: Bool { defaults.object(forKey: "showName") as? Bool ?? true }
    var followApps: Bool { defaults.object(forKey: "followApps") as? Bool ?? true }

    /// 改大小：窗口和网页一起按比例缩放，底边中点不动（脚下的位置不变）
    func applyScale(_ scale: CGFloat) {
        let old = panel.frame
        let size = NSSize(width: Self.baseSize.width * scale, height: Self.baseSize.height * scale)
        let origin = NSPoint(x: old.midX - size.width / 2, y: old.minY)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
        web.pageZoom = scale
        defaults.set([origin.x, origin.y], forKey: "origin")
    }

    /// 拖滑块时每次只变一点，直接跟手；一下子变很多（点「还原」）时用 0.2 秒过渡过去
    var scaleTimer: Timer?
    var shownScale: CGFloat = 0
    func animateScale(to target: CGFloat) {
        scaleTimer?.invalidate()
        let from = shownScale > 0 ? shownScale : petScale
        guard abs(target - from) > 0.06 else { shownScale = target; applyScale(target); return }
        let start = Date()
        scaleTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] t in
            guard let self else { t.invalidate(); return }
            let k = min(1, Date().timeIntervalSince(start) / 0.2)
            let eased = 1 - pow(1 - k, 3)
            self.shownScale = from + (target - from) * CGFloat(eased)
            self.applyScale(self.shownScale)
            if k >= 1 { t.invalidate() }
        }
    }

    @objc func openSettings() {
        if let w = settingsWindow {
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            return
        }
        let config = WKWebViewConfiguration()
        config.userContentController.add(DevBridge(app: self, settings: true), name: "settings")
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 680),
                         styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "CrossPet 设置"
        w.isReleasedWhenClosed = false
        w.center()
        let v = WKWebView(frame: w.contentView!.bounds, configuration: config)
        v.autoresizingMask = [.width, .height]
        v.navigationDelegate = self
        v.loadFileURL(root.appendingPathComponent("web/settings.html"), allowingReadAccessTo: root)
        w.contentView!.addSubview(v)
        settingsWindow = w
        settingsWeb = v
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            self?.settingsWeb = nil
            self?.settingsWindow = nil
        }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    func settingsState() -> [String: Any] {
        let names = defaults.dictionary(forKey: "names") as? [String: String] ?? [:]
        var state: [String: Any] = [
            "version": currentVersion, "platform": "mac",
            "size": Double(petScale), "showName": showName, "aura": auraMode, "followApps": followApps,
            "gptQuota": defaults.bool(forKey: "gptQuota"), "agyQuota": defaults.bool(forKey: "agyQuota"),
            "login": SMAppService.mainApp.status == .enabled,
            "character": currentId ?? characterIds.first ?? "",
            "characters": characterIds.map { ["id": $0, "name": displayNames[$0] ?? $0, "defaultName": defaultNames[$0] ?? $0, "custom": names[$0] ?? ""] },
            "updating": updating,
        ]
        if let r = latestRelease, canSelfUpdate { state["update"] = r.tag }
        return state
    }

    func pushSettings() {
        guard settingsWeb != nil else { return }
        // 当前角色以桌宠页面里正在演的为准（启动时由页面自己恢复上次的角色）
        web.evaluateJavaScript("charId") { [weak self] r, _ in
            guard let self, let v = self.settingsWeb else { return }
            // 只在还不知道当前角色时（刚启动、页面自己恢复了上次的角色）问页面；换角色有 0.33 秒过渡，过渡中页面里还是旧角色
            if self.currentId == nil, let id = r as? String, self.characterIds.contains(id) { self.currentId = id }
            guard let data = try? JSONSerialization.data(withJSONObject: self.settingsState()),
                  let text = String(data: data, encoding: .utf8) else { return }
            v.evaluateJavaScript("setState(\(text))", completionHandler: nil)
        }
    }

    func handleSettings(_ body: Any) {
        guard let msg = body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
        switch cmd {
        case "set":
            guard let key = msg["key"] as? String else { return }
            let value = msg["value"]
            switch key {
            case "size":
                if let n = value as? Double { let v = min(1.6, max(0.6, (n * 100).rounded() / 100)); defaults.set(v, forKey: "size"); animateScale(to: CGFloat(v)) }
            case "showName":
                let on = value as? Bool ?? true; defaults.set(on, forKey: "showName"); js("setShowName(\(on))")
            case "aura":
                if let mode = value as? String, ["auto", "on", "off"].contains(mode) { defaults.set(mode, forKey: "auraMode"); js("setAuraMode(\(quote(mode)))") }
            case "followApps":
                defaults.set(value as? Bool ?? true, forKey: "followApps")
            case "gptQuota":
                if (value as? Bool ?? false) != defaults.bool(forKey: "gptQuota") { toggleGPTQuota() }
            case "agyQuota":
                if (value as? Bool ?? false) != defaults.bool(forKey: "agyQuota") { toggleAntigravityQuota() }
            case "login":
                if (value as? Bool ?? false) != (SMAppService.mainApp.status == .enabled) { toggleLogin() }
            case "character":
                if let id = value as? String, characterIds.contains(id) { switchTo(id) }
            default: break
            }
            pushSettings()
        case "rename":
            guard let id = msg["id"] as? String, characterIds.contains(id) else { return }
            var names = defaults.dictionary(forKey: "names") as? [String: String] ?? [:]
            let value = (msg["name"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            if value.isEmpty { names.removeValue(forKey: id) } else { names[id] = value }
            defaults.set(names, forKey: "names")
            loadCharacters()
            js("setName(\(quote(id)), \(quote(displayNames[id] ?? id)))")
            pushSettings()
        case "action":
            switch msg["name"] as? String {
            case "update": selfUpdate()
            case "checkUpdate": checkForUpdate(manual: true)
            case "openCharacters": openCharacters()
            case "openData": NSWorkspace.shared.open(root)
            case "devConsole": openDevConsole()
            default: break
            }
            pushSettings()
        default:
            pushSettings()
        }
    }

    // MARK: 工具

    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

    // MARK: 开发者控制台
    // 一个独立窗口（web/devconsole.html），直接调用桌宠页面里真实的动作代码：逐个检查姿态、跑场景、记反馈。
    var feedbackURL: URL { root.appendingPathComponent("dev-feedback.md") }

    func devJS(_ code: String) { devWeb?.evaluateJavaScript(code, completionHandler: nil) }

    @objc func openDevConsole() {
        if let w = devWindow {
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            return
        }
        let config = WKWebViewConfiguration()
        config.userContentController.add(DevBridge(app: self), name: "dev")
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1060, height: 760),
                         styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "CrossPet 开发者控制台"
        w.isReleasedWhenClosed = false
        w.center()
        let v = WKWebView(frame: w.contentView!.bounds, configuration: config)
        v.autoresizingMask = [.width, .height]
        v.navigationDelegate = self
        v.loadFileURL(root.appendingPathComponent("web/devconsole.html"), allowingReadAccessTo: root)
        w.contentView!.addSubview(v)
        devWindow = w
        devWeb = v
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.pauseRealEvents = false
            self.js("devRelease()")
            self.devWeb = nil
            self.devWindow = nil
        }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    func handleDev(_ body: Any) {
        guard let msg = body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
        switch cmd {
        case "pet":       // 在桌宠页面里执行一段代码（控制台自己的页面发来的，只在本机）
            if let code = msg["code"] as? String { js(code) }
        case "status":    // 读桌宠当前状态，回给控制台
            web.evaluateJavaScript("JSON.stringify(devStatus())") { [weak self] r, _ in
                if let text = r as? String { self?.devJS("onPetStatus(\(text))") }
            }
        case "pause":
            pauseRealEvents = msg["on"] as? Bool ?? false
        case "save":
            let text = msg["text"] as? String ?? ""
            try? text.write(to: feedbackURL, atomically: true, encoding: .utf8)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            devJS("onSaved(\(quote(feedbackURL.path)))")
        case "reveal":
            NSWorkspace.shared.activateFileViewerSelecting([feedbackURL])
        case "reload":
            web.reload()
        default:
            break
        }
    }
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

/// 只信任本机 127.0.0.1 的自签名证书（Antigravity 后台服务用的是自签名 HTTPS）
final class LocalhostTrust: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async
        -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        if challenge.protectionSpace.host == "127.0.0.1", let trust = challenge.protectionSpace.serverTrust {
            return (.useCredential, URLCredential(trust: trust))
        }
        return (.performDefaultHandling, nil)
    }
}

/// 控制台页面 → App 的消息通道（单独一个对象，避免 WKUserContentController 强引用 App 造成循环）
final class DevBridge: NSObject, WKScriptMessageHandler {
    weak var app: App?
    let settings: Bool   // true：设置页的消息；false：开发者控制台的消息
    init(app: App, settings: Bool = false) { self.app = app; self.settings = settings }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        if settings { app?.handleSettings(message.body) } else { app?.handleDev(message.body) }
    }
}

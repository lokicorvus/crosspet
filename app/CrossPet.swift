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
    var onDragStart: (() -> Void)?
    var onDragEnd: (() -> Void)?
    var onShake: (() -> Void)?        // 按住快速来回甩（逗她）
    private var shook = false          // 这次拖动甩过：松手不贴边
    private var swingX: CGFloat = 0, swingDir: CGFloat = 0, swings: [Date] = [], shakeSaid = Date.distantPast
    private var downAt: NSPoint = .zero
    private var originAt: NSPoint = .zero
    private var dragged = false

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        dragged = false
    }
    override func mouseDragged(with event: NSEvent) {
        let p = NSEvent.mouseLocation
        if !dragged {
            guard abs(p.x - downAt.x) + abs(p.y - downAt.y) > 3 else { return }
            dragged = true
            onDragStart?()
            originAt = window?.frame.origin ?? .zero
            downAt = p
            shook = false; swingX = p.x; swingDir = 0; swings = []
        }
        // 甩：横向来回反转方向。记住这个方向上拖到的最远点，从那里往回拖超过 18 点算一次反转，0.9 秒内反转两次以上就算在甩
        if swingDir == 0 {
            if abs(p.x - swingX) > 18 { swingDir = p.x > swingX ? 1 : -1; swingX = p.x }
        } else if (p.x - swingX) * swingDir > 0 {
            swingX = p.x   // 同方向继续拖：更新最远点
        } else if (swingX - p.x) * swingDir > 18 {
            swingDir = -swingDir; swingX = p.x
            swings.append(Date())
            swings = swings.filter { Date().timeIntervalSince($0) < 0.9 }
            if swings.count >= 2, Date().timeIntervalSince(shakeSaid) > 0.3 { shook = true; shakeSaid = Date(); onShake?() }
        }
        // 自己跟着鼠标挪（不用 performDrag 交给系统：macOS 15 起系统拖到屏幕边缘会弹「窗口分屏」预览、松手还会去动窗口，跟贴边抢位置）
        window?.setFrameOrigin(NSPoint(x: originAt.x + p.x - downAt.x, y: originAt.y + p.y - downAt.y))
    }
    override func mouseUp(with event: NSEvent) {
        if dragged {
            if let o = window?.frame.origin { defaults.set([o.x, o.y], forKey: "origin") }
            if !shook { onDragEnd?() }   // 甩她的时候松手不贴边
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
    var skinChoices: [String: [(id: String, name: String)]] = [:]   // 角色 → 可换的衣服（皮肤）
    var baseOutfit: [String: String] = [:]   // 原版衣服叫什么（character.json 的 outfit，比如「女仆装」）
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
    var feedbackWindow: NSWindow?
    var feedbackWeb: WKWebView?
    var defaultNames: [String: String] = [:]   // id → character.json 里的原名（设置页显示占位用）
    var pauseRealEvents = false                // 控制台里测试时，先不让真实 AI 的状态打扰桌宠

    // MARK: 启动

    func applicationDidFinishLaunching(_ note: Notification) {
        syncBundledResources()
        markLaunched()

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
        panel.level = layerMode == "normal" ? .normal : .floating
        panel.hidesOnDeactivate = false
        applyFullscreenBehavior()

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
        drag.onDragStart = { [weak self] in self?.undock() }
        drag.onDragEnd = { [weak self] in self?.checkDock() }
        drag.onShake = { [weak self] in self?.js("shaken()") }
        container.addSubview(drag)

        panel.contentView = container
        panel.orderFrontRegardless()
        setupStatusItem()

        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(appActivated(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.pollStates() }
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.updateClickThrough() }
        quotaTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshGPTQuota(); self?.refreshAntigravityQuota() }
        // 检查更新：启动后 20 秒、之后每 3 小时，电脑从睡眠中醒来时也查一次（很多人的电脑一直不关机，只是合盖）
        Timer.scheduledTimer(withTimeInterval: 3 * 3600, repeats: true) { [weak self] _ in self?.checkForUpdate(manual: false) }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self?.checkForUpdate(manual: false) }   // 等网络连上
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.checkForUpdate(manual: false) }
    }

    // MARK: 更新
    // 每 3 小时（和电脑醒来时）查一次 GitHub 上最新的 Release（只读公开的版本号，不发送任何数据）。
    // 自己 fork 的话改这里的仓库名。
    let repoSlug = "lokicorvus/crosspet"
    // 完整版本号（测试版带后缀，如 1.2.5-beta.1）存在自定义字段里；CFBundleShortVersionString 按苹果要求只放数字部分
    var currentVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CrossPetVersion") ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")) as? String ?? "0"
    }

    /// 语义化版本比较：先比 主.次.补丁；一样时正式版比测试版新（1.2.4 < 1.2.5-beta.1 < 1.2.5-beta.2 < 1.2.5）
    func isNewer(_ tag: String, than current: String) -> Bool {
        func parse(_ v: String) -> (core: [Int], pre: [String]) {
            let s = v.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
            let parts = s.split(separator: "-", maxSplits: 1).map(String.init)
            let core = (parts.first ?? "").split(separator: ".").map { Int($0) ?? 0 }
            let pre = parts.count > 1 ? parts[1].split(separator: ".").map(String.init) : []
            return (core, pre)
        }
        let a = parse(tag), b = parse(current)
        for i in 0..<max(a.core.count, b.core.count, 3) {
            let x = i < a.core.count ? a.core[i] : 0, y = i < b.core.count ? b.core[i] : 0
            if x != y { return x > y }
        }
        if a.pre.isEmpty || b.pre.isEmpty { return a.pre.isEmpty && !b.pre.isEmpty }   // 正式版 > 同号测试版
        for i in 0..<max(a.pre.count, b.pre.count) {
            guard i < a.pre.count else { return false }
            guard i < b.pre.count else { return true }
            let x = a.pre[i], y = b.pre[i]
            if x == y { continue }
            if let nx = Int(x), let ny = Int(y) { return nx > ny }
            if Int(x) != nil { return false }   // 数字段比文字段小（semver 规则）
            if Int(y) != nil { return true }
            return x > y
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
        js("setUpdateProgress(0, \(quote("正在下载新版本…")))")
        let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/CrossPet-update.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", "curl -fsSL https://raw.githubusercontent.com/\(repoSlug)/main/get.sh | bash"]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
        env["CROSSPET_CONNECT"] = "none"   // 只刷新已经接入的，不问新的
        env["CROSSPET_PREFER_DIR"] = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL.path  // 装回原来的位置
        // 下载进度：安装命令把 curl 的进度条写进这个文件，这边每半秒读一次，在气泡里显示百分比
        let progressURL = FileManager.default.temporaryDirectory.appendingPathComponent("crosspet-update-progress.txt")
        try? FileManager.default.removeItem(at: progressURL)
        env["CROSSPET_PROGRESS_FILE"] = progressURL.path
        var lastShown = -1
        let progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self, let text = try? String(contentsOf: progressURL, encoding: .utf8) else { return }
            // curl 的进度条形如「####    45.3%」，取最后一个百分号前面的数字
            guard let end = text.lastIndex(of: "%") else { return }
            let digits = text[..<end].reversed().prefix { $0.isNumber || $0 == "." }
            guard let value = Double(String(digits.reversed())), case let p = Int(value), p != lastShown else { return }
            lastShown = p
            self.js("setUpdateProgress(\(p), \(self.quote(p >= 100 ? "下载好了，正在安装…" : "正在下载新版本 \(p)%…")))")
        }
        p.environment = env
        if let log = try? FileHandle(forWritingTo: logURL) { p.standardOutput = log; p.standardError = log }
        // 正常情况下安装命令会关掉这个旧版、装好后打开新版，走不到这里；还活着说明没成功
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                progressTimer.invalidate()
                guard let self else { return }
                self.updating = false
                guard proc.terminationStatus != 0 else { return }
                self.js("endUpdate()")
                let fail = NSAlert()
                fail.messageText = "自动更新没成功"
                fail.informativeText = "详情在 ~/Library/Logs/CrossPet-update.log。要打开下载页手动更新吗？"
                fail.addButton(withTitle: "打开下载页")
                fail.addButton(withTitle: "取消")
                NSApp.activate(ignoringOtherApps: true)
                if fail.runModal() == .alertFirstButtonReturn { self.openRelease() }
            }
        }
        do { try p.run() } catch { progressTimer.invalidate(); updating = false; js("endUpdate()"); openRelease() }
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
        if webView === feedbackWeb { return }   // 反馈页面自己发 get 来要信息
        if webView === devWeb {
            let info = ["version": currentVersion, "feedbackPath": feedbackURL.path]
            let data = (try? JSONSerialization.data(withJSONObject: info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            devJS("setAppInfo(\(data)); boot(\(manifestJSON))")
            return
        }
        ready = true
        loadCharacters()
        if let side = defaults.string(forKey: "dock"), edgeDockEnabled {   // 上次是贴着边的
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.setDock(side) }
        }
        js("setAuraMode(\(quote(auraMode))); setShowName(\(showName)); setEggsEnabled(\(eggsEnabled))")
        stamps = [:]
        pollStates()
        refreshGPTQuota()
        refreshAntigravityQuota()
        if followApps, let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
           let id = appToCharacter[front] ?? hostApp(front), characterIds.contains(hostCharacter(id)) {
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
        let dirs = ((try? fm.contentsOfDirectory(at: charactersDir, includingPropertiesForKeys: nil)) ?? [])
            .sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        // 立绘：<文件名去掉 -2、-3> 是姿态名，idle-blink 是眨眼帧（照着 idle 本身画的）
        func sprites(_ dir: URL) -> (poses: [String: [String]], blink: String?, blinkBase: String?) {
            let files = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? [])
                .filter { $0.hasSuffix(".webp") || $0.hasSuffix(".png") }.sorted()
            var poses: [String: [String]] = [:]
            var blink: String?, blinkBase: String?
            for f in files {
                let name = (f as NSString).deletingPathExtension
                let url = dir.appendingPathComponent(f).absoluteString
                if name == "idle-blink" { blink = url; continue }
                if name == "idle" { blinkBase = url }
                let pose = name.split(separator: "-").first.map(String.init) ?? name
                poses[pose, default: []].append(url)
            }
            return (poses, blink, blinkBase)
        }
        // 皮肤（另一套衣服）：character.json 里写 "skinOf": "<角色>"，不单独算角色；选了它，那个角色就用这套立绘，台词、动作逻辑照旧
        skinChoices = [:]
        var skinSprites: [String: (poses: [String: [String]], blink: String?, blinkBase: String?)] = [:]
        var skinInfo: [String: [String: Any]] = [:]
        for dir in dirs {
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("character.json")),
                  let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let base = info["skinOf"] as? String else { continue }
            let sp = sprites(dir)
            guard sp.poses["idle"] != nil else { continue }
            skinChoices[base, default: []].append((dir.lastPathComponent, info["skinName"] as? String ?? dir.lastPathComponent))
            skinSprites[dir.lastPathComponent] = sp
            skinInfo[dir.lastPathComponent] = info
        }
        let chosen = defaults.dictionary(forKey: "skins") as? [String: String] ?? [:]
        for dir in dirs {
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("character.json")),
                  var info = try? JSONSerialization.jsonObject(with: data) as? [String: Any], info["skinOf"] == nil else { continue }
            let id = dir.lastPathComponent
            var sp = sprites(dir)
            if let skin = chosen[id], let s = skinSprites[skin], skinChoices[id]?.contains(where: { $0.id == skin }) == true {
                sp = s
                info["skin"] = skin   // 网页据此挑彩蛋（有的彩蛋只在穿某件衣服时出现）
                // 皮肤可以有自己的台词 / 登场招呼：写了的覆盖原版，没写的照旧
                if let own = skinInfo[skin]?["lines"] as? [String: Any] {
                    var lines = info["lines"] as? [String: Any] ?? [:]
                    for (k, v) in own { lines[k] = v }
                    info["lines"] = lines
                }
                if let g = skinInfo[skin]?["greeting"] { info["greeting"] = g }
            }
            let (poses, blink, blinkBase) = sp
            let isEgg = info["egg"] as? Bool == true  // 彩蛋角色：不进菜单、不绑应用
            guard isEgg ? poses["pop"] != nil : (poses["idle"] != nil || poses["default"] != nil) else { continue }
            if !isEgg { defaultNames[id] = info["name"] as? String ?? id; baseOutfit[id] = info["outfit"] as? String }
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
        // 刚更新完（上次打开的是别的版本）：让她说一声
        let last = defaults.string(forKey: "lastVersion")
        if last != currentVersion {
            defaults.set(currentVersion, forKey: "lastVersion")
            if last != nil, isNewer(currentVersion, than: last!) { js("justUpdated(\(quote("v" + currentVersion)))") }
        }
    }

    func switchTo(_ id: String) {
        currentId = id
        if dock != nil, !dockOut { DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.applyDock() } }   // 换了角色，切口位置跟着变
        js("setCharacter(\(quote(id)))")
        pushSettings()
    }

    /// 一个 App 里能用好几家模型（比如 DeepSeek Harness）：它的接入插件把当前角色写在 <角色>-host.json，
    /// 切到这个 App 时换成那个角色。一天内写的才算，角色不存在就还用 character.json 里绑定的
    /// 本身不对应角色、而是能用好几家模型的 App：切过去时按它的接入写的 <宿主>-host.json 换角色，
    /// 当前模型没有对应角色时不换（hostCharacter 返回宿主名，不是角色）
    func hostApp(_ bundle: String) -> String? {
        if bundle.hasPrefix("com.workbuddy.") { return "workbuddy" }
        if bundle == "dev.zcode.app" { return "zcode" }
        return nil
    }

    func hostCharacter(_ id: String) -> String {
        let url = stateDir.appendingPathComponent("\(id)-host.json")
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let stamp = attrs[.modificationDate] as? Date, Date().timeIntervalSince(stamp) < 86400,
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // 还不知道它在用哪个模型（刚装好、还没对话过）：先按它默认的模型换，比如 ZCode 默认是 GLM
            if let d = Self.hostDefaults[id], characterIds.contains(d) { return d }
            return id
        }
        guard let c = obj["character"] as? String, characterIds.contains(c) else { return id }
        return c
    }
    static let hostDefaults = ["zcode": "glm"]

    /// 切到某个 AI 的 App 后，要在它上面停留一会儿才换角色：
    /// App 启动时窗口会短暂地抢焦点、让焦点，立即响应会来回闪。
    @objc func appActivated(_ note: Notification) {
        guard ready, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        pendingSwitch?.cancel()
        guard followApps, let bundle = app.bundleIdentifier, let mapped = appToCharacter[bundle] ?? hostApp(bundle) else { return }
        let id = hostCharacter(mapped)
        guard id != currentId, characterIds.contains(id) else { return }
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
        // current：多模型宿主（WorkBuddy）里没有对应角色的模型，由当前角色来演；它只有状态，没有额度
        for id in characterIds + ["current"] {
            // sessions：同一个 AI 好几个对话同时干活时，每个对话各自的状态（演「手忙脚乱」用）
            for kind in ["state", "quota", "sessions"] where !(id == "current" && kind == "quota") {
                let url = stateDir.appendingPathComponent("\(id)-\(kind).json")
                let key = "\(id)-\(kind)"
                guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                      let stamp = attrs[.modificationDate] as? Date, stamp != stamps[key] else { continue }
                stamps[key] = stamp
                // 状态只认 10 分钟内的，免得开机读到旧状态
                if kind == "state", Date().timeIntervalSince(stamp) > 600 { continue }
                guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { continue }
                if kind == "state", let pose = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["pose"] as? String {
                    lastPose[id] = (pose, stamp)
                }
                if kind == "sessions" { if !pauseRealEvents { js("setSessions(\(quote(id)), \(text))") }; continue }
                devJS("logEvent(\(quote(id)), \(quote(kind)), \(text), \(pauseRealEvents))")
                if pauseRealEvents { continue }
                js(kind == "state" ? "applyCharState(\(quote(id)), \(text))" : "setQuota(\(quote(id)), \(text))")
            }
        }
        applyLayer()
        updateDock()
        // 多模型宿主（DeepSeek Harness、WorkBuddy、ZCode）正在前台、里面换了模型：马上换成那个模型的角色
        for host in ["deepseek", "workbuddy", "zcode"] {
            let url = stateDir.appendingPathComponent("\(host)-host.json")
            guard let stamp = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date,
                  stamp != stamps["\(host)-host"] else { continue }
            stamps["\(host)-host"] = stamp
            guard followApps, !pauseRealEvents, let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                  (appToCharacter[front] ?? hostApp(front)) == host else { continue }
            let id = hostCharacter(host)
            if id != currentId, characterIds.contains(id) { switchTo(id) }
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
        NSMenu.popUpContextMenu(buildMenu(), with: event, for: view)
    }

    func buildMenu() -> NSMenu {
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
        add(menu, "逗她", #selector(tease))
        add(menu, "召唤彩蛋", #selector(egg))
        if characterIds.count > 1 {
            menu.addItem(.separator())
            let switchItem = NSMenuItem(title: "换角色", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            // 有别的衣服（皮肤）的角色展开成几项：「DeepSeek · 女仆装」「DeepSeek · Claude 卫衣」
            let worn = defaults.dictionary(forKey: "skins") as? [String: String] ?? [:]
            for id in characterIds {
                let name = displayNames[id] ?? id
                let outfits: [(skin: String, title: String)] = skinChoices[id].map { skins in
                    [("", "\(name) · \(baseOutfit[id] ?? "原版")")] + skins.map { ($0.id, "\(name) · \($0.name)") }
                } ?? [("", name)]
                for o in outfits {
                    let item = NSMenuItem(title: o.title, action: #selector(switchCharacter(_:)), keyEquivalent: "")
                    item.representedObject = "\(id)|\(o.skin)"
                    item.target = self
                    item.state = id == currentId && (worn[id] ?? "") == o.skin ? .on : .off
                    sub.addItem(item)
                }
            }
            switchItem.submenu = sub
            menu.addItem(switchItem)
        }
        menu.addItem(.separator())
        let layerItem = NSMenuItem(title: "显示层级", action: nil, keyEquivalent: "")
        let layerMenu = NSMenu()
        for (mode, title) in [("always", "始终在最上层"), ("ai", "跟着 AI（用 AI 时才浮在最上层）"), ("normal", "普通窗口（不置顶）")] {
            let item = NSMenuItem(title: title, action: #selector(setLayer(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode
            item.state = layerMode == mode ? .on : .off
            layerMenu.addItem(item)
        }
        layerItem.submenu = layerMenu
        menu.addItem(layerItem)
        add(menu, "设置…", #selector(openSettings))
        add(menu, "反馈问题…", #selector(openFeedback))
        if NSEvent.modifierFlags.contains(.option) {  // 按住 ⌥ 右键才出现：给自己换立绘、加角色的人检查效果用
            add(menu, "开发者控制台…", #selector(openDevConsole))
        }
        add(menu, "回到右下角", #selector(resetPosition))
        menu.addItem(.separator())
        add(menu, "退出 CrossPet", #selector(quit))
        return menu
    }

    // MARK: 菜单栏图标
    // Mac 版不在程序坞和 ⌘Tab 里：她被别的窗口挡住（显示层级选了「普通窗口」或「跟着 AI」）、
    // 被拖到看不见的地方时，从这里找她。左键：叫到最前面；右键：和桌宠右键一样的菜单（和 Windows 的托盘图标对应）
    var statusItem: NSStatusItem?

    func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.autosaveName = "CrossPetStatusItem"   // 记住用户按住 ⌘ 拖到的位置
        if let button = item.button {
            let image = NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: "CrossPet")
            image?.isTemplate = true
            button.image = image
            button.toolTip = "CrossPet：单击把她叫到最前面，右键打开菜单"
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        statusItem = item
    }

    @objc func statusItemClicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            // 临时挂上菜单再「点一下」：菜单从图标正下方弹出，关掉后摘下，免得左键也变成弹菜单
            statusItem?.menu = buildMenu()
            sender.performClick(nil)
            statusItem?.menu = nil
        } else {
            bringToFront()
        }
    }

    /// 叫到最前面：在当前屏幕看不见（被拖出屏幕、换了显示器）就先回到右下角
    @objc func bringToFront() {
        let visible = NSScreen.screens.contains { $0.visibleFrame.intersects(panel.frame.insetBy(dx: 40, dy: 40)) }
        if !visible { resetPosition() }
        panel.orderFrontRegardless()
        js("handleClick('pat')")
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
    @objc func tease() { js("tease()") }

    @objc func switchCharacter(_ item: NSMenuItem) {
        guard let value = item.representedObject as? String else { return }
        let parts = value.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        if parts.count == 2 { wear(parts[0], parts[1]) }
        switchTo(parts[0])
    }
    /// 换衣服（皮肤）：记下来，重新载入立绘；正在显示的就是她的话马上换上
    func wear(_ id: String, _ skin: String) {
        var skins = defaults.dictionary(forKey: "skins") as? [String: String] ?? [:]
        guard (skins[id] ?? "") != skin else { return }
        if skin.isEmpty { skins.removeValue(forKey: id) } else { skins[id] = skin }
        defaults.set(skins, forKey: "skins")
        loadCharacters()
        js("refreshLook(\(quote(id)))")
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
        undock()
        guard let screen = NSScreen.main?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: screen.maxX - panel.frame.width - 40, y: screen.minY + 100))
        defaults.removeObject(forKey: "origin")
    }
    // MARK: 跟着 AI 出现
    // 接入的 AI 开始工作时，钩子脚本 / DSH 插件发现桌宠没在跑就把它打开（看 /tmp/crosspet/pet.pid）。
    // 从菜单手动退出 = 这会儿不想看到它：记下 user-quit（看文件修改时间），在那之前就开着的 AI 不再把它拉起来；
    // AI 程序关掉重开、重启电脑后就作废，自己打开桌宠也会清掉。
    // 设置里关掉「AI 开始工作时自动出现」= 写 ai-autostart-off。两个记号都放在 Application Support，重启电脑也不丢。
    var userQuitFlag: URL { root.appendingPathComponent("user-quit") }
    var aiAutostartOffFlag: URL { root.appendingPathComponent("ai-autostart-off") }
    var aiAutostart: Bool { !FileManager.default.fileExists(atPath: aiAutostartOffFlag.path) }
    func setAIAutostart(_ on: Bool) {
        if on { try? FileManager.default.removeItem(at: aiAutostartOffFlag) }
        else { try? Data().write(to: aiAutostartOffFlag) }
    }
    func markLaunched() {
        try? FileManager.default.removeItem(at: userQuitFlag)
        try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
        try? String(ProcessInfo.processInfo.processIdentifier).write(to: stateDir.appendingPathComponent("pet.pid"), atomically: true, encoding: .utf8)
    }
    func applicationWillTerminate(_ note: Notification) {
        try? FileManager.default.removeItem(at: stateDir.appendingPathComponent("pet.pid"))
    }

    /// 菜单里的「退出」：用户主动退出。第一次退出时说一句，让人知道什么时候会再出来
    @objc func quit() {
        try? Data().write(to: userQuitFlag)
        // 挥手道别再走；第一次退出时说明什么时候会再出来，多停一会儿让人看清
        let hint = aiAutostart && !defaults.bool(forKey: "quitHinted")
        if hint { defaults.set(true, forKey: "quitHinted") }
        js(hint ? "farewell('我先走啦～下次重新打开 AI 我再出来', 5000)" : "farewell(null, 2000)")
        DispatchQueue.main.asyncAfter(deadline: .now() + (hint ? 5 : 2)) { NSApp.terminate(nil) }
    }

    // MARK: 显示层级
    // always：始终在最上层；ai：前台是 AI 应用、AI 等你回答、刚干完活时在最上层，其他时候是普通窗口（会被挡住）；
    // normal：普通窗口。全屏时隐藏用 macOS 自己的机制：不允许出现在全屏程序的空间里
    var layerMode: String { defaults.string(forKey: "layer") ?? "always" }
    var hideInFullscreen: Bool { defaults.object(forKey: "hideFullscreen") as? Bool ?? true }
    var lastPose: [String: (pose: String, at: Date)] = [:]   // 各角色最近一次状态（判断 AI 在不在干活）

    var aiActive: Bool {
        if let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
           appToCharacter[front] != nil || hostApp(front) != nil { return true }
        let now = Date()
        return lastPose.values.contains { p in
            let age = now.timeIntervalSince(p.at)
            if p.pose == "asking" { return age < 600 }                        // 等你回答：一直等到你回答
            return age < 8 && ["happy", "proud"].contains(p.pose)              // 刚干完活：浮上来一会儿
            // AI 在后台干活时不浮上来：选这个模式的人就是嫌挡路，干活时往往正是你切去忙别的
        }
    }

    func applyLayer() {
        let top = layerMode == "always" || (layerMode == "ai" && aiActive)
        let level: NSWindow.Level = top ? .floating : .normal
        guard panel.level != level else { return }
        // 原本被别的窗口挡着、要浮上来：先藏起来，换完层级再淡入（没被挡住就直接换，免得闪一下）
        guard top, isCovered() else {
            panel.level = level
            if top { panel.orderFrontRegardless() } else { orderBelowFrontWindow() }
            return
        }
        web.evaluateJavaScript("sink()") { [weak self] _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                guard let self, self.layerMode == "always" || (self.layerMode == "ai" && self.aiActive) else { self?.js("surface()"); return }
                self.panel.level = .floating
                self.panel.orderFrontRegardless()
                self.js("surface()")
            }
        }
    }

    // MARK: 贴边
    // 拖到屏幕左 / 右边缘松手：她缩到屏幕外，只露半个身子扒着边缘（额度、名牌、气泡都藏起来）。
    // AI 干活时（或在等你回答）自己跑出来，干完过约 10 秒缩回去；鼠标移到露出来的那截上她会探出来一点。
    // 拖离边缘就不贴了。另一块屏幕接在这边时不算边缘
    var dock: String?            // "left" / "right"
    var dockOut = false          // 跑出来了
    var dockHover = false
    var dockLeaveAt: Date?
    var dockedAt = Date.distantPast   // 刚拖到边上：之前就在进行的工作不算，先缩进去给个反应，AI 有新动作再跑出来
    var edgeDockEnabled: Bool { defaults.object(forKey: "edgeDock") as? Bool ?? true }

    func undock() {
        guard dock != nil else { return }
        dock = nil; dockOut = false; dockHover = false; dockTucked = false
        defaults.removeObject(forKey: "dock")
        js("setTucked(null)")
    }
    func checkDock() {
        guard edgeDockEnabled, let screen = panel.screen ?? NSScreen.main else { return }
        let f = panel.frame, vf = screen.visibleFrame, reach = f.width * 0.3
        func neighbor(_ left: Bool) -> Bool {
            NSScreen.screens.contains { s in s != screen && s.frame.minY < f.maxY && s.frame.maxY > f.minY &&
                (left ? abs(s.frame.maxX - screen.frame.minX) < 2 : abs(s.frame.minX - screen.frame.maxX) < 2) }
        }
        if f.midX - vf.minX < reach, !neighbor(true) { setDock("left") }
        else if vf.maxX - f.midX < reach, !neighbor(false) { setDock("right") }
    }
    func setDock(_ side: String) {
        dock = side
        dockedAt = Date()
        defaults.set(side, forKey: "dock")
        dockOut = dockBusy
        applyDock()
    }
    /// AI 在干活 / 等你回答 / 刚干完（10 秒内）：跑出来
    var dockBusy: Bool {
        let now = Date()
        return lastPose.values.contains { p in
            guard p.at > dockedAt else { return false }
            let age = now.timeIntervalSince(p.at)
            switch p.pose {
            case "asking": return age < 600
            case "happy", "proud", "oops", "surprised": return age < 10
            case "idle", "sleeping", "tired": return false
            default: return age < 180
            }
        }
    }
    func updateDock() {
        guard dock != nil else { return }
        let busy = dockBusy
        if busy != dockOut { dockOut = busy; dockHover = false; applyDock() }
    }
    func applyDock() {
        guard let side = dock, let screen = panel.screen ?? NSScreen.main else { return }
        hitRects = []; hitRectsAt = .distantPast   // 换了样子，可点区域重新量（旧的范围会让她误以为鼠标在身上，来回闪）
        let vf = screen.visibleFrame
        var f = panel.frame
        f.origin.y = min(max(f.origin.y, vf.minY - f.height * 0.15), vf.maxY - f.height)
        if dockOut {
            dockTucked = false
            js("setTucked(null)")
            f.origin.x = side == "left" ? vf.minX : vf.maxX - f.width
            slide(to: f)
            return
        }
        // 窗口还没到边上（刚拖过来松手）：先整个滑到屏幕边缘，滑完再缩进去。一次只做一个动作，不然窗口在滑、人物也在窗口里滑，看着乱
        if !dockTucked {
            var g = f; g.origin.x = side == "left" ? vf.minX : vf.maxX - f.width
            if abs(panel.frame.origin.x - g.origin.x) > 1 || abs(panel.frame.origin.y - g.origin.y) > 1 {
                slide(to: g)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.37) { [weak self] in self?.tuck(side, vf) }
                return
            }
        }
        tuck(side, vf)
    }
    var dockTucked = false   // 现在是缩着的样子（之后换探出来不用先挪窗口）
    /// 缩进去（或换成探出来那张），按切口位置对齐屏幕边缘。有贴边立绘时切口就是窗口边，窗口不用再动
    func tuck(_ side: String, _ vf: NSRect) {
        guard dock == side, !dockOut else { return }
        dockTucked = true
        var f = panel.frame
        // 鼠标移上来：换成探出来更多的那张（edge_*_peek），切口照样对齐屏幕边缘（不能光把窗口往外挪，切口会露在屏幕中间）
        let peek = dockHover
        js("setTucked(\(quote(side)), \(peek))")
        let key = side + (peek ? "-peek" : "") + currentIdKey
        let place = { [weak self] (cut: Double) in
            guard let self, self.dock == side, !self.dockOut, self.dockHover == peek else { return }
            let zoom = f.width / Self.baseSize.width
            f.origin.x = side == "left" ? vf.minX - CGFloat(cut) * zoom : vf.maxX - CGFloat(cut) * zoom
            if abs(f.origin.x - self.panel.frame.origin.x) > 1 { self.slide(to: f) }
        }
        if let cut = dockCut[key] { place(cut); return }
        // 换成贴边立绘后再量切口（图要先载入），量过的记下来
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            guard let self, self.dock == side, !self.dockOut, self.dockHover == peek else { return }
            self.web.evaluateJavaScript("dockCut(\(self.quote(side)))") { [weak self] r, _ in
                guard let cut = (r as? NSNumber)?.doubleValue else { return }
                self?.dockCut[key] = cut
                place(cut)
            }
        }
    }
    var dockCut: [String: Double] = [:]   // 切口位置（网页像素），按 边 + 角色 记
    var currentIdKey: String { currentId ?? "" }
    func slide(to frame: NSRect) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.35
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(frame, display: true)
        }
    }
    /// 缩着时鼠标在露出来的那截上停 0.15 秒：探出来；移开 0.3 秒后缩回去
    var dockEnterAt: Date?
    func updateDockHover(_ inside: Bool) {
        guard dock != nil, !dockOut else { return }
        if inside {
            dockLeaveAt = nil
            guard !dockHover else { return }
            if dockEnterAt == nil { dockEnterAt = Date() }   // 停一小会儿才探出来，路过不算
            else if Date().timeIntervalSince(dockEnterAt!) > 0.15 { dockEnterAt = nil; dockHover = true; applyDock() }
            return
        }
        dockEnterAt = nil
        if dockHover {
            if dockLeaveAt == nil { dockLeaveAt = Date() }
            else if Date().timeIntervalSince(dockLeaveAt!) > 0.3 { dockHover = false; dockLeaveAt = nil; applyDock() }
        }
    }

    // MARK: 点击穿透
    // 窗口比桌宠大（给动作、气泡留的空间）：鼠标不在桌宠本体、气泡、名牌、额度上时让窗口不接鼠标，点击落到后面的窗口
    var hitRects: [CGRect] = []
    var hitRectsAt = Date.distantPast

    func updateClickThrough() {
        let p = NSEvent.mouseLocation, f = panel.frame
        guard f.contains(p) else { updateDockHover(false); return }
        if NSEvent.pressedMouseButtons != 0 { return }   // 正在拖、正在点：别中途换
        // 贴着边时量得勤一点：探出来 / 缩回去要马上跟着鼠标
        if Date().timeIntervalSince(hitRectsAt) > (dock != nil ? 0.08 : 0.25) {
            hitRectsAt = Date()
            web.evaluateJavaScript("hitRects()") { [weak self] r, _ in
                guard let text = r as? String, let data = text.data(using: .utf8),
                      let list = try? JSONSerialization.jsonObject(with: data) as? [[Double]] else { return }
                self?.hitRects = list.filter { $0.count == 4 }.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            }
        }
        let zoom = f.width / Self.baseSize.width   // 网页像素 → 屏幕点
        let point = CGPoint(x: (p.x - f.minX) / zoom, y: (f.maxY - p.y) / zoom)
        let over = hitRects.isEmpty || hitRects.contains { $0.contains(point) }
        if panel.ignoresMouseEvents == over { panel.ignoresMouseEvents = !over }
        updateDockHover(over && !hitRects.isEmpty)   // 缩着时鼠标在露出来的那截上：探出来
    }

    /// 降到普通层级后还排在所有普通窗口最前面、压在你正在用的窗口上：挪到前台程序最前面那个窗口的后面
    func orderBelowFrontWindow() {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier, pid != ProcessInfo.processInfo.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let front = list.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }),
              let number = front[kCGWindowNumber as String] as? Int else { return }
        panel.order(.below, relativeTo: number)
    }

    /// 桌宠中间那块有没有被别的普通窗口挡住（只看窗口位置和层级，不需要录屏权限）
    func isCovered() -> Bool {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenAboveWindow, .excludeDesktopElements],
                                                    CGWindowID(panel.windowNumber)) as? [[String: Any]] else { return false }
        let screenTop = NSScreen.screens.first?.frame.maxY ?? 0
        let f = panel.frame
        let core = CGRect(x: f.minX, y: screenTop - f.maxY, width: f.width, height: f.height).insetBy(dx: f.width * 0.25, dy: f.height * 0.2)
        return list.contains { w in
            guard (w[kCGWindowLayer as String] as? Int) == 0, (w[kCGWindowAlpha as String] as? Double ?? 1) > 0.05,
                  let b = w[kCGWindowBounds as String] as? NSDictionary,
                  let r = CGRect(dictionaryRepresentation: b) else { return false }
            return r.intersects(core)
        }
    }

    @objc func setLayer(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        defaults.set(mode, forKey: "layer")
        applyLayer()
    }

    func applyFullscreenBehavior() {
        panel.collectionBehavior = hideInFullscreen ? [.canJoinAllSpaces, .stationary] : [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    }

    // MARK: 设置
    // 一个独立窗口（web/settings.html，和 Windows 版共用），右键菜单只留常用的几项，其余都在这里
    static let baseSize = NSSize(width: 260, height: 362)
    var petScale: CGFloat {
        let v = defaults.double(forKey: "size")
        return v >= 0.6 && v <= 1.6 ? CGFloat(v) : 1
    }
    var showName: Bool { defaults.object(forKey: "showName") as? Bool ?? true }
    var followApps: Bool { defaults.object(forKey: "followApps") as? Bool ?? true }
    var eggsEnabled: Bool { defaults.object(forKey: "eggs") as? Bool ?? true }

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
            if k >= 1 { t.invalidate(); if self.dock != nil { self.applyDock() } }   // 贴着边时调完大小重新对齐边缘
        }
    }

    @objc func openSettings() {
        if let w = settingsWindow {
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            return
        }
        let config = WKWebViewConfiguration()
        config.userContentController.add(DevBridge(app: self, kind: .settings), name: "settings")
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
            "size": Double(petScale), "showName": showName, "eggs": eggsEnabled, "hideFullscreen": hideInFullscreen, "aura": auraMode, "followApps": followApps,
            "gptQuota": defaults.bool(forKey: "gptQuota"), "agyQuota": defaults.bool(forKey: "agyQuota"),
            "login": SMAppService.mainApp.status == .enabled,
            "edgeDock": edgeDockEnabled,
            "aiAutostart": aiAutostart,
            "character": currentId ?? characterIds.first ?? "",
            "characters": characterIds.map { id -> [String: Any] in
                var c: [String: Any] = ["id": id, "name": displayNames[id] ?? id, "defaultName": defaultNames[id] ?? id, "custom": names[id] ?? ""]
                if let skins = skinChoices[id], !skins.isEmpty {   // 有别的衣服：原版排第一
                    c["skins"] = [["id": "", "name": baseOutfit[id] ?? "原版"]] + skins.map { ["id": $0.id, "name": $0.name] }
                    c["skin"] = (defaults.dictionary(forKey: "skins") as? [String: String])?[id] ?? ""
                }
                return c
            },
            "updating": updating,
        ]
        if let r = latestRelease, canSelfUpdate { state["update"] = r.tag }
        if let list = integrated, integrateScript != nil {
            state["integrations"] = Self.integrationTargets.map {
                ["id": $0.id, "label": $0.label, "note": $0.note, "installed": list.contains($0.id)] as [String: Any]
            }
        }
        return state
    }

    // MARK: 接入 AI（设置窗口里）
    // App 里自带接入工具（Resources/tools/integrate.py），用系统的 python3 跑；和终端里的安装命令做的是同一件事
    static let integrationTargets: [(id: String, label: String, note: String)] = [
        ("claude-mod", "Claude Code 增强版 mod", "能显示额度；终端里要 2.1.287 以上，桌面 App 2.1.286 以上"),
        ("claude-hooks", "Claude Code 标准钩子", "所有版本可用，不显示额度；和增强版二选一"),
        ("codex", "Codex", "接入后要在 Codex 里用 /hooks 信任一次"),
        ("deepseek", "DeepSeek Harness", "工作状态 + 余额；完全退出再打开 Harness 生效"),
        ("antigravity", "Antigravity", "桌面版和命令行都有效"),
        ("gemini", "Gemini CLI", "Gemini 桌面 App 没有接口"),
        ("workbuddy", "WorkBuddy", "按当前模型换角色"),
        ("zcode", "ZCode（智谱）", "按会话的模型换角色"),
        ("hermes", "Hermes Agent", "按当前模型换角色；新开的会话生效"),
    ]
    var integrated: [String]?
    var integrateScript: URL? {
        let url = Bundle.main.resourceURL!.appendingPathComponent("tools/integrate.py")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// 后台跑一次接入工具，回调里拿到输出和退出码
    func runIntegrate(_ args: [String], done: @escaping (String, Int32) -> Void) {
        guard let script = integrateScript else { done("App 里没有接入工具", -1); return }
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            p.arguments = [script.path] + args
            var env = ProcessInfo.processInfo.environment
            env["PYTHONDONTWRITEBYTECODE"] = "1"   // 别往 App 包里写缓存（会破坏签名）
            env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "")
            p.environment = env
            let pipe = Pipe()
            p.standardOutput = pipe; p.standardError = pipe
            var output = ""
            do {
                try p.run()
                output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                p.waitUntilExit()
            } catch { output = error.localizedDescription }
            let code = p.isRunning ? -1 : p.terminationStatus
            DispatchQueue.main.async { done(output, code) }
        }
    }

    func refreshIntegrated() {
        runIntegrate(["installed"]) { [weak self] out, code in
            guard let self else { return }
            let last = out.split(separator: "\n").last.map(String.init) ?? "[]"
            self.integrated = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String] ?? []
            self.pushSettings()
        }
    }

    func integrate(_ action: String, _ target: String) {
        guard let t = Self.integrationTargets.first(where: { $0.id == target }), ["install", "uninstall"].contains(action) else { return }
        runIntegrate([action, target]) { [weak self] out, code in
            // 没找到 AI 的配置目录时脚本正常退出但什么都没改，不能显示成「已接入」
            let missing = out.contains("没找到")
            let alert = NSAlert()
            alert.messageText = "\(t.label)：" + (code != 0 ? "没有完成" : missing ? "没有接入：没找到这个 AI 的配置" : action == "install" ? "已接入" : "已撤销")
            alert.informativeText = out.trimmingCharacters(in: .whitespacesAndNewlines)
                .split(separator: "\n").filter { !$0.contains("已备份") }.joined(separator: "\n")
            alert.alertStyle = code != 0 || missing ? .warning : .informational
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
            self?.refreshIntegrated()
        }
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
            case "hideFullscreen":
                defaults.set(value as? Bool ?? true, forKey: "hideFullscreen"); applyFullscreenBehavior()
            case "eggs":
                let on = value as? Bool ?? true; defaults.set(on, forKey: "eggs"); js("setEggsEnabled(\(on))")
            case "gptQuota":
                if (value as? Bool ?? false) != defaults.bool(forKey: "gptQuota") { toggleGPTQuota() }
            case "agyQuota":
                if (value as? Bool ?? false) != defaults.bool(forKey: "agyQuota") { toggleAntigravityQuota() }
            case "edgeDock":
                let on = value as? Bool ?? true
                defaults.set(on, forKey: "edgeDock")
                if !on { undock() }
            case "aiAutostart":
                setAIAutostart(value as? Bool ?? true)
            case "login":
                if (value as? Bool ?? false) != (SMAppService.mainApp.status == .enabled) { toggleLogin() }
            case "character":
                if let id = value as? String, characterIds.contains(id) { switchTo(id) }
            default: break
            }
            pushSettings()
        case "integrate":
            if let target = msg["target"] as? String, let action = msg["action"] as? String { integrate(action, target) }
        case "skin":   // 换衣服：记下来，重新载入立绘；正在显示的就是她的话马上换上
            guard let id = msg["id"] as? String, characterIds.contains(id), let skin = msg["skin"] as? String else { return }
            wear(id, skin)
            switchTo(id)
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
            case "feedback": openFeedback()
            default: break
            }
            pushSettings()
        default:   // get：设置窗口刚打开
            if integrated == nil { refreshIntegrated() }
            pushSettings()
        }
    }

    // MARK: 反馈问题
    // 右键「反馈问题…」：web/feedback.html 里点选「哪方面」+ 必填一句「具体是哪里」，App 附上版本、系统、接入情况、最近日志，
    // 由页面拼成卡片，发到飞书群机器人。地址可用 `defaults write io.github.crosspet feedbackURL <地址>` 改（测试用）
    static let feedbackEndpoint = "https://open.feishu.cn/open-apis/bot/v2/hook/854f8a9a-d3f4-4705-b6f8-15cc007f714b"

    @objc func openFeedback() {
        if let w = feedbackWindow {
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            return
        }
        let config = WKWebViewConfiguration()
        config.userContentController.add(DevBridge(app: self, kind: .feedback), name: "feedback")
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 400),
                         styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "CrossPet 反馈问题"
        w.isReleasedWhenClosed = false
        w.center()
        let v = WKWebView(frame: w.contentView!.bounds, configuration: config)
        v.autoresizingMask = [.width, .height]
        v.navigationDelegate = self
        v.loadFileURL(root.appendingPathComponent("web/feedback.html"), allowingReadAccessTo: root)
        w.contentView!.addSubview(v)
        feedbackWindow = w
        feedbackWeb = v
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            self?.feedbackWeb = nil
            self?.feedbackWindow = nil
        }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    /// 每台机器一个随机 id，只用来让服务端限流、合并同一个人的多条反馈
    var installId: String {
        if let id = defaults.string(forKey: "installId") { return id }
        let id = UUID().uuidString
        defaults.set(id, forKey: "installId")
        return id
    }

    /// 去掉日志里的隐私：家目录换成 ~，路径里的用户名、像 API Key 的字符串打码，顺便去掉终端颜色控制符
    static func redact(_ text: String) -> String {
        var s = text.replacingOccurrences(of: NSHomeDirectory(), with: "~")
        let rules: [(String, String)] = [
            (#"\x{1B}\[[0-9;]*[A-Za-z]"#, ""),                       // 终端颜色控制符
            (#"(/Users/|\\Users\\)[^/\\\s]+"#, "$1<user>"),        // 别的用户目录里的用户名
            (#"sk-[A-Za-z0-9_\-]{8,}"#, "sk-***"),
            (#"(?i)(bearer|token|key|secret|password)([\s\"':=]+)[A-Za-z0-9_\-\.]{8,}"#, "$1$2***"),
        ]
        for (pattern, tmpl) in rules {
            if let re = try? NSRegularExpression(pattern: pattern) {
                s = re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: tmpl)
            }
        }
        return s
    }

    func feedbackInfo() -> [String: Any] {
        let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/CrossPet-update.log")
        let lines = ((try? String(contentsOf: logURL, encoding: .utf8)) ?? "").split(separator: "\n", omittingEmptySubsequences: false)
        let tail = lines.suffix(40).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        var arch = "arm64"
        #if arch(x86_64)
        arch = "x86_64"
        #endif
        return [
            "version": currentVersion, "platform": "mac",
            "os": "macOS \(ProcessInfo.processInfo.operatingSystemVersionString) \(arch)",
            "character": currentId ?? characterIds.first ?? "",
            "integrations": integrated ?? [],
            "displays": displaysSummary(),
            "log": String(Self.redact(tail).suffix(6000)),
            "install": installId,
        ]
    }

    /// 反馈附带的显示信息：几块显示器、各自大小和相对主屏的位置、桌宠在哪块、显示器是否各有空间、显示层级 / 全屏隐藏 / 贴边
    func displaysSummary() -> String {
        let screens = NSScreen.screens
        guard let main = screens.first else { return "" }
        let parts = screens.enumerated().map { i, s -> String in
            let f = s.frame
            var where_ = "主屏"
            if i > 0 {
                where_ = f.minX >= main.frame.maxX - 1 ? "右侧" : f.maxX <= main.frame.minX + 1 ? "左侧" : f.minY >= main.frame.maxY - 1 ? "上方" : f.maxY <= main.frame.minY + 1 ? "下方" : "重叠"
            }
            let here = panel.screen == s ? "（桌宠在这）" : ""
            return "\(Int(f.width))×\(Int(f.height))@\(Int(s.backingScaleFactor))x \(where_)\(here)"
        }
        var flags = ["层级 \(layerMode)", hideInFullscreen ? "全屏隐藏" : "全屏不隐藏"]
        if screens.count > 1 { flags.append(NSScreen.screensHaveSeparateSpaces ? "各屏单独空间" : "各屏共用空间") }
        if let d = dock { flags.append("贴\(d == "left" ? "左" : "右")边") }
        return "\(screens.count) 块：" + parts.joined(separator: "、") + "；" + flags.joined(separator: "，")
    }

    func pushFeedbackInfo() {
        guard let v = feedbackWeb, let data = try? JSONSerialization.data(withJSONObject: feedbackInfo()),
              let text = String(data: data, encoding: .utf8) else { return }
        v.evaluateJavaScript("setInfo(\(text))", completionHandler: nil)
    }

    func handleFeedback(_ body: Any) {
        guard let msg = body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
        let done = { [weak self] (ok: Bool, text: String) in
            DispatchQueue.main.async {
                self?.feedbackWeb?.evaluateJavaScript("onSent(\(ok), \(self?.quote(text) ?? "''"))", completionHandler: nil)
                if ok { self?.js("show('happy', true); say('收到反馈啦，谢谢你！')") }
            }
        }
        switch cmd {
        case "send":
            let endpoint = defaults.string(forKey: "feedbackURL") ?? Self.feedbackEndpoint
            guard let url = URL(string: endpoint), url.scheme != nil else { done(false, "反馈暂时关闭了"); return }
            guard let body = msg["body"] as? String, body.utf8.count <= 20_000 else { done(false, "内容太长了，删短一点再发"); return }
            // 本机限流：一小时最多 5 条（飞书群机器人的地址是公开的，不能让一台机器刷屏）
            let now = Date().timeIntervalSince1970
            let recent = (defaults.array(forKey: "feedbackTimes") ?? [])
                .compactMap { ($0 as? NSNumber)?.doubleValue ?? Double("\($0)") }.filter { now - $0 < 3600 }
            guard recent.count < 5 else { done(false, "发得有点多啦，过一会儿再发"); return }
            var req = URLRequest(url: url, timeoutInterval: 15)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = Data(body.utf8)
            URLSession.shared.dataTask(with: req) { data, _, err in
                // 飞书不论成败都回 HTTP 200，看返回里的 code：0 才是发到了群里
                let reply = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                let code = (reply?["code"] as? NSNumber)?.intValue ?? -1
                if code == 0 {
                    DispatchQueue.main.async { defaults.set(recent + [now], forKey: "feedbackTimes") }
                    done(true, "")
                } else if err != nil { done(false, "连不上网络，稍后再试试") }
                else if code == 11232 { done(false, "反馈的人有点多，过一会儿再发") }
                else { done(false, "没发出去（\(code)），稍后再试试") }
            }.resume()
        default:   // get：反馈窗口刚打开
            pushFeedbackInfo()
            if integrated == nil, integrateScript != nil {
                runIntegrate(["installed"]) { [weak self] out, _ in
                    let last = out.split(separator: "\n").last.map(String.init) ?? "[]"
                    self?.integrated = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String] ?? []
                    self?.pushFeedbackInfo()
                }
            }
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
        config.userContentController.add(DevBridge(app: self, kind: .dev), name: "dev")
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
    enum Kind { case dev, settings, feedback }
    weak var app: App?
    let kind: Kind
    init(app: App, kind: Kind) { self.app = app; self.kind = kind }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        switch kind {
        case .dev: app?.handleDev(message.body)
        case .settings: app?.handleSettings(message.body)
        case .feedback: app?.handleFeedback(message.body)
        }
    }
}

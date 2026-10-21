import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 更新
    // 每 3 小时（和电脑醒来时）查一次 GitHub 上最新的 Release（只读公开的版本号，不发送任何数据）。
    // 自己 fork 的话改这里的仓库名。
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
        // 装的是测试版：也收下一个测试版。releases/latest 不含测试版，改看发布页的订阅源（releases.atom，不限流），
        // 在比现在新的版本里挑最新、且 macOS 安装包真的在的（测试版发布页删了、标签还留着的不算）；没有就照常查正式版
        if currentVersion.contains("-"), let feed = URL(string: "https://github.com/\(repoSlug)/releases.atom") {
            URLSession.shared.dataTask(with: URLRequest(url: feed, timeoutInterval: 15)) { [weak self] data, _, _ in
                guard let self else { return }
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let re = try? NSRegularExpression(pattern: "/releases/tag/([^\"<]+)")
                let tags = Set((re?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []).compactMap { m in
                    Range(m.range(at: 1), in: text).map { String(text[$0]) } })
                let newer = tags.filter { self.isNewer($0, than: self.currentVersion) }.sorted { self.isNewer($0, than: $1) }
                self.firstWithAsset(newer) { tag in
                    if let tag { self.gotLatest(tag, page: URL(string: "https://github.com/\(self.repoSlug)/releases/tag/\(tag)"), manual: manual) }
                    else { self.checkStable(manual: manual) }
                }
            }.resume()
            return
        }
        checkStable(manual: manual)
    }
    /// 依次看这些版本的 macOS 安装包在不在，回调第一个在的（都不在就 nil）
    func firstWithAsset(_ tags: [String], done: @escaping (String?) -> Void) {
        guard let tag = tags.first, let url = URL(string: "https://github.com/\(repoSlug)/releases/download/\(tag)/CrossPet-macOS.zip") else { done(nil); return }
        var req = URLRequest(url: url, timeoutInterval: 15); req.httpMethod = "HEAD"
        URLSession.shared.dataTask(with: req) { [weak self] _, res, _ in
            if ((res as? HTTPURLResponse)?.statusCode ?? 0) == 200 { done(tag) } else { self?.firstWithAsset(Array(tags.dropFirst()), done: done) }
        }.resume()
    }

    func checkStable(manual: Bool) {
        guard let url = URL(string: "https://api.github.com/repos/\(repoSlug)/releases/latest") else { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self = self else { return }
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            if let tag = obj?["tag_name"] as? String, !tag.isEmpty {
                self.gotLatest(tag, page: (obj?["html_url"] as? String).flatMap(URL.init(string:)), manual: manual)
                return
            }
            // 接口限流（同一个网络每小时 60 次）或者返回了报错：改看网页 releases/latest 跳转到哪个版本（不限流，get.sh 也这么查）
            guard let latest = URL(string: "https://github.com/\(self.repoSlug)/releases/latest") else { return }
            URLSession.shared.dataTask(with: URLRequest(url: latest, timeoutInterval: 15)) { [weak self] _, res, _ in
                let path = res?.url?.path ?? ""
                let tag = path.range(of: "/tag/").map { String(path[$0.upperBound...]) } ?? ""
                self?.gotLatest(tag, page: res?.url, manual: manual)
            }.resume()
        }.resume()
    }

    func gotLatest(_ tag: String, page: URL?, manual: Bool) {
            DispatchQueue.main.async { self.lastUpdateCheck = "\(Self.clock()) " + (tag.isEmpty ? "没拿到版本号" : "最新 \(tag)") }
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
    }

    // 一键更新：在后台跑一遍官方安装命令（get.sh：下载最新的 macOS 安装包 → 替换 App → 按新版刷新已接入的 AI → 重新打开），
    // 和用户自己在终端里运行那条命令完全一样，只是不再逐个问要接入哪些 AI。只在装在默认位置（应用程序文件夹）时提供
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
        if let tag = latestRelease?.tag { env["CROSSPET_TAG"] = tag }   // 装检查到的那个版本（测试版用户会是下一个测试版）
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
        let cursorBridge = "crosspet-cursor-bridge.py"
        let cursorSrc = res.appendingPathComponent("integrations/cursor")
        if fm.fileExists(atPath: root.appendingPathComponent(cursorBridge).path),
           fm.fileExists(atPath: cursorSrc.appendingPathComponent(cursorBridge).path) {
            replace(cursorBridge, in: root, from: cursorSrc)
        }
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
        if webView === settingsWeb {
            pushSettings()
            if let tab = pendingSettingsTab { pendingSettingsTab = nil; webView.evaluateJavaScript("showTab(\(quote(tab)))", completionHandler: nil) }
            return
        }
        if webView === feedbackWeb { return }   // 反馈页面自己发 get 来要信息
        if webView === devWeb {
            let info = ["version": currentVersion, "feedbackPath": feedbackURL.path]
            let data = (try? JSONSerialization.data(withJSONObject: info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            devJS("setAppInfo(\(data)); boot(\(manifestJSON))")
            return
        }
        ready = true
        loadCharacters()
        // 恢复上次的角色（和 Windows 一致：先恢复，再让下面的「跟随前台」按前台程序覆盖）。
        // 没存过 / 那个角色已经不在了：保持 init() 里选的第一个。quiet：不演登场招呼
        if let saved = defaults.string(forKey: "character"), characterIds.contains(saved) {
            currentId = saved
            js("setCharacter(\(quote(saved)), true)")
        }
        if let side = defaults.string(forKey: "dock"), edgeDockEnabled {   // 上次是贴着边的
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.setDock(side) }
        }
        js("setAuraMode(\(quote(auraMode))); setShowName(\(showName)); setEggsEnabled(\(eggsEnabled)); setPowerSave(\(powerSave)); setQuotaAggregate(\(quotaAggregate)); setCodexResets(\(codexResets)); setPeakStyle(\(quote(peakStyle))); setPeakSkins(\(peakSkinsJSON))")
        applySizes(anchor: .corner)   // 解锁过文字大小的：按画布重设窗口，左下角不动（锁着的尺寸不变）
        updatePageHidden()
        stamps = [:]
        pollStates()
        refreshCodexQuota(.now)
        refreshAntigravityQuota()
        refreshPlugins(tellPet: true)   // 插件旧了：等她闲下来提醒一句
        if followApps, let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
           let id = appToCharacter[front] ?? hostApp(front), characterIds.contains(hostCharacter(id)) {
            switchTo(hostCharacter(id))
        }
    }

}

import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
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
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: Self.fitHeight(700)),
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

    /// 反馈窗口第一步就要的：开头、第二步的选项（已接入的 AI、角色、打开了的额度）；sections 是这一类要附的段落（见 web/feedback-plan.js）
    func feedbackFacts(_ sections: [String: String], key: String? = nil) -> [String: Any] {
        var arch = "arm64"
        #if arch(x86_64)
        arch = "x86_64"
        #endif
        let skins = (defaults.dictionary(forKey: "skins") as? [String: String]) ?? [:]
        var quotas: [String] = []
        if defaults.bool(forKey: "gptQuota") { quotas.append("gpt") }
        if defaults.bool(forKey: "agyQuota") { quotas.append("gemini") }
        if dsQuotaEnabled { quotas.append("deepseek") }
        let header: [String: Any] = ["version": currentVersion, "platform": "mac", "os": "macOS \(ProcessInfo.processInfo.operatingSystemVersionString) \(arch)",
                                     "install": installId, "character": currentId ?? "", "skin": skins[currentId ?? ""] ?? "",
                                     "uptimeMin": Int(Date().timeIntervalSince(launchedAt) / 60)]
        let characters: [[String: String]] = characterIds.map { ["id": $0, "name": displayNames[$0] ?? $0] }
        var facts: [String: Any] = ["header": header, "integrations": integrated ?? [], "characters": characters, "quotas": quotas,
                                    "sections": sections.mapValues { Self.redact($0) }]
        if let key { facts["key"] = key }   // 收集的结果带回 collect 时的 key，页面据此丢掉上一类迟到的结果
        return facts
    }

    static func clock(from d: Date = Date()) -> String { let f = DateFormatter(); f.dateFormat = "MM-dd HH:mm"; return f.string(from: d) }
    static func hm(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d) }

    /// 收集反馈要的段落（want 来自 web/feedback-plan.js 的 sectionsFor）。网页自报和接入诊断是异步的：网页 2 秒不回就写「网页没有回应」
    func collectFeedback(_ want: [String], done: @escaping ([String: String]) -> Void) {
        var out: [String: String] = [:]
        let group = DispatchGroup()
        let fm = FileManager.default
        func file(_ url: URL) -> String { (try? String(contentsOf: url, encoding: .utf8)) ?? "" }
        for id in want {
            switch id {
            case "window":
                let f = panel.frame
                let onScreen = NSScreen.screens.contains { $0.visibleFrame.intersects(f.insetBy(dx: 40, dy: 40)) }
                out[id] = "位置 \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))×\(Int(f.height))\(onScreen ? "" : "（不在任何屏幕里）")；显示中 \(panel.isVisible ? "是" : "否")，透明度 \(panel.alphaValue)；"
                    + "层级 \(layerMode)（现在\(panel.level == .floating ? "置顶" : "普通")）；贴边 \(dock ?? "无")\(dock != nil ? (dockOut ? "·跑出来了" : "·缩着") : "")；大小 \(Int(petScale * 100))%"
            case "displays": out[id] = displaysSummary()
            case "dpi": out[id] = displaysSummary() + "\n人物大小 \(Int(petScale * 100))%，文字大小 \(Int(textScale * 100))%"
            case "front":
                let front = NSWorkspace.shared.frontmostApplication
                out[id] = "前台 \(front?.localizedName ?? "-")（\(front?.bundleIdentifier ?? "-")）\(front?.bundleIdentifier == "com.apple.finder" ? "，可能是桌面" : "")；"
                    + "没被别的窗口挡住 \(panel.occlusionState.contains(.visible) ? "是" : "否")"
            case "hidden":
                out[id] = "因全屏收着 \(hiddenForFullscreen ? "是" : "否")，快捷键藏着 \(userHidden ? "是" : "否")，从菜单退出的标记 \(fm.fileExists(atPath: userQuitFlag.path) ? "有" : "无")，全屏时被叫出来 \(fullscreenOverride ? "是" : "否")"
            case "crashes":
                let dir = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
                let items = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []).filter { $0.lastPathComponent.hasPrefix("CrossPet") }
                let newest = items.compactMap { (try? $0.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate }.max()
                out[id] = "崩溃报告 \(items.count) 份\(newest.map { "，最近一份 \(Self.clock(from: $0))" } ?? "")"
            case "install":
                let res = Bundle.main.resourceURL!
                let missing = ["web", "characters", "integrations"].filter { !fm.fileExists(atPath: res.appendingPathComponent($0).path) }
                out[id] = "装在 \(Bundle.main.bundlePath.replacingOccurrences(of: NSHomeDirectory(), with: "~"))\(canSelfUpdate ? "" : "（不在应用程序文件夹，不能一键更新）")；缺少 \(missing.isEmpty ? "无" : missing.joined(separator: "、"))；开发者工具/python3 \(pythonReady ? "有" : "没有")；检查更新 \(lastUpdateCheck)"
            case "log": out[id] = Ledger.tail(Self.logURL, 400)
            case "updateLog": out[id] = Ledger.tail(fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/CrossPet-update.log"), 100)
            case "seen":
                let seen = lastSeen
                let m = Dictionary(uniqueKeysWithValues: Self.seenKeys.map { ($0.key, seen[$0.value] ?? 0) })
                out[id] = (try? JSONSerialization.data(withJSONObject: m)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            case "petEvents": out[id] = Ledger.tail(petEventsURL, 200)
            case "switches": out[id] = Ledger.tail(switchesURL, 200)
            case "settings":
                let skins = (defaults.dictionary(forKey: "skins") as? [String: String]) ?? [:]
                out[id] = "跟随前台 \(followApps ? "开" : "关")，跟随事件 \(followEvents ? "开" : "关")，AI 干活自动出现 \(aiAutostart ? "开" : "关")，衣服 \(skins.isEmpty ? "无" : "\(skins)")，"
                    + "峰谷换装 \(peakSkins.isEmpty ? "无" : "\(peakSkins)")，省电 \(powerSave ? "开" : "关")，彩蛋 \(eggsEnabled ? "开" : "关")，额度合并 \(quotaAggregate ? "开" : "关")，额度样式 \(quotaStyle)，重置提醒 \(codexResets ? "开" : "关")"
            case "characters": out[id] = characterFolders()
            case "quota:gpt": out[id] = "最近一次 \(lastGptQuota)\(codexNote.isEmpty ? "" : "；" + codexNote)\n额度文件 \(file(stateDir.appendingPathComponent("gpt-quota.json")))"
            case "quota:gemini": out[id] = "找服务 \(lastAgyNote)\n额度文件 \(file(stateDir.appendingPathComponent("gemini-quota.json")))"
            case "quota:deepseek": out[id] = "插件自检 \(file(stateDir.appendingPathComponent("deepseek-plugin.json")))\n余额文件 \(file(stateDir.appendingPathComponent("deepseek-quota.json")))"
            case "perf":
                let ps = Process(); ps.executableURL = URL(fileURLWithPath: "/bin/ps"); ps.arguments = ["-o", "%cpu=,rss=", "-p", "\(ProcessInfo.processInfo.processIdentifier)"]
                let pipe = Pipe(); ps.standardOutput = pipe; try? ps.run(); ps.waitUntilExit()
                let usage = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "?"
                out[id] = "CrossPet 进程 CPU% / 内存KB：\(usage)（网页进程由系统共用，不单独统计）；省电 \(powerSave ? "开" : "关")；屏幕刷新率 \(NSScreen.screens.map { "\($0.maximumFramesPerSecond)Hz" }.joined(separator: "、"))；"
                    + "GPT 额度 \(defaults.bool(forKey: "gptQuota") ? "开" : "关")，Gemini 额度 \(defaults.bool(forKey: "agyQuota") ? "开" : "关")，DeepSeek 余额 \(dsQuotaEnabled ? "开" : "关")"
            case "page":
                group.enter()
                var answered = false
                let finish = { (text: String) in if !answered { answered = true; out["page"] = text; group.leave() } }
                web.evaluateJavaScript("JSON.stringify(diagnoseDisplay())") { r, _ in finish(r as? String ?? "网页没有回应") }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { finish("网页没有回应") }
            case "diag":
                if diagText.isEmpty, pythonReady, integrateScript != nil {
                    // 诊断要跑 python，卡住的话整份反馈都等不来：最多等 3 秒，到点先写「诊断超时」
                    group.enter()
                    var answered = false
                    let finish = { (text: String) in if !answered { answered = true; out["diag"] = text; group.leave() } }
                    runIntegrate(["diagnose"]) { [weak self] text, _ in
                        DispatchQueue.main.async {
                            self?.diagText = text.trimmingCharacters(in: .whitespacesAndNewlines)
                            finish(self?.diagText ?? "")
                        }
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish("诊断超时（3 秒内没跑完）") }
                } else { out[id] = diagText }
            default:
                if id.hasPrefix("events:") { out[id] = Ledger.tail(eventsDir.appendingPathComponent("\(id.dropFirst(7)).jsonl"), 200) }
                else if id.hasPrefix("state:") {
                    // state:<角色>|<宿主>：状态、多会话按角色记；轮次、按模型换角色按宿主名记（见 web/feedback-plan.js）
                    let parts = id.dropFirst(6).split(separator: "|").map(String.init)
                    let c = parts.first ?? "", host = parts.count > 1 ? parts[1] : c
                    out[id] = ["state", "sessions", "turns", "host"].compactMap { kind -> String? in
                        let t = file(stateDir.appendingPathComponent("\(kind == "turns" || kind == "host" ? host : c)-\(kind).json")).trimmingCharacters(in: .whitespacesAndNewlines)
                        return t.isEmpty ? nil : "\(kind)：\(String(t.prefix(800)))"
                    }.joined(separator: "\n")
                }
            }
        }
        group.notify(queue: .main) { done(out) }
    }

    /// 角色文件夹对照表：包里带的和数据目录里的，每个文件夹一行（json 能不能读、有没有待机图、几张立绘、加载了没有）
    func characterFolders() -> String {
        let fm = FileManager.default
        let skinIds = Set(skinChoices.values.flatMap { $0.map(\.id) })
        let rows = [("包里", Bundle.main.resourceURL!.appendingPathComponent("characters")), ("数据目录", charactersDir)].flatMap { (place, dir) -> [String] in
            let dirs = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []).filter { $0.hasDirectoryPath }.sorted { $0.lastPathComponent < $1.lastPathComponent }
            return dirs.map { d in
                let name = d.lastPathComponent
                let jsonOk = (try? Data(contentsOf: d.appendingPathComponent("character.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) } != nil
                let files = (try? fm.contentsOfDirectory(atPath: d.path)) ?? []
                let sprites = files.filter { $0.hasSuffix(".webp") || $0.hasSuffix(".png") }
                let idle = sprites.contains { $0.hasPrefix("idle.") || $0.hasPrefix("default.") }
                let state = characterIds.contains(name) ? "已加载" : skinIds.contains(name) ? "已加载（衣服）" : name.hasPrefix("egg-") ? "彩蛋" : !jsonOk ? "没加载：character.json 读不出" : !idle ? "没加载：缺待机图" : "没加载"
                return "\(place) \(name)：json \(jsonOk ? "能读" : "读不出")，待机图 \(idle ? "有" : "无")，立绘 \(sprites.count) 张，\(state)"
            }
        }
        return rows.joined(separator: "\n")
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

    func pushFacts(_ sections: [String: String], key: String? = nil) {
        guard let v = feedbackWeb, let data = try? JSONSerialization.data(withJSONObject: feedbackFacts(sections, key: key)),
              let text = String(data: data, encoding: .utf8) else { return }
        v.evaluateJavaScript("setFacts(\(text))", completionHandler: nil)
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
        case "collect":   // 选好了类型（和补选）：按 web/feedback-plan.js 给的段落清单收集
            let want = msg["want"] as? [String] ?? [], key = msg["key"] as? String ?? ""
            collectFeedback(want) { [weak self] sections in self?.pushFacts(sections, key: key) }
        default:   // get：反馈窗口刚打开，先给开头和第二步的选项
            pushFacts([:])
            diagText = ""   // 每次打开反馈都重新诊断一次（要用时再跑）
            if integrated == nil, integrateScript != nil {
                runIntegrate(["installed"]) { [weak self] out, _ in
                    let last = out.split(separator: "\n").last.map(String.init) ?? "[]"
                    self?.integrated = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String] ?? []
                    self?.pushFacts([:])
                }
            }
        }
    }

}

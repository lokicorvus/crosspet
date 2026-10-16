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
            "runtime": Self.redact(runtimeSummary()),
            "diag": Self.redact(diagText),
        ]
    }

    static func clock() -> String { let f = DateFormatter(); f.dateFormat = "MM-dd HH:mm"; return f.string(from: Date()) }
    static func hm(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d) }

    /// 反馈附带的运行状态：一次把排查要用的都列出来（不读对话、不带 Key）
    func runtimeSummary() -> String {
        var L: [String] = []
        let front = NSWorkspace.shared.frontmostApplication
        L.append("前台程序 \(front?.localizedName ?? "-")（\(front?.bundleIdentifier ?? "-")）")
        let f = panel.frame
        let onScreen = NSScreen.screens.contains { $0.visibleFrame.intersects(f.insetBy(dx: 40, dy: 40)) }
        L.append("窗口 \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))×\(Int(f.height))\(onScreen ? "" : "（不在任何屏幕里）")；"
                 + "显示中 \(panel.isVisible ? "是" : "否")，没被挡住 \(panel.occlusionState.contains(.visible) ? "是" : "否")，因全屏收着 \(hiddenForFullscreen ? "是" : "否")，快捷键藏着 \(userHidden ? "是" : "否")，透明度 \(panel.alphaValue)；"
                 + "层级 \(layerMode)（现在\(panel.level == .floating ? "置顶" : "普通")）；贴边 \(dock ?? "无")\(dock != nil ? (dockOut ? "·跑出来了" : "·缩着") : "")；大小 \(Int(petScale * 100))%")
        let skins = (defaults.dictionary(forKey: "skins") as? [String: String]) ?? [:]
        L.append("角色 \(currentId ?? "-")\(skins.isEmpty ? "" : "，衣服 \(skins)")；设置：名字 \(showName ? "开" : "关")，光晕 \(auraMode)，省电 \(powerSave ? "开" : "关")，彩蛋 \(eggsEnabled ? "开" : "关")，"
                 + "跟随前台 \(followApps ? "开" : "关")，跟随事件 \(followEvents ? "开" : "关")，AI 干活自动出现 \(aiAutostart ? "开" : "关")，贴边 \(edgeDockEnabled ? "开" : "关")，"
                 + "GPT 额度 \(defaults.bool(forKey: "gptQuota") ? "开" : "关")，Gemini 额度 \(defaults.bool(forKey: "agyQuota") ? "开" : "关")，DeepSeek 余额 \(dsQuotaEnabled ? "开" : "关")，额度合并 \(quotaAggregate ? "开" : "关")")
        let now = Date()
        let poses = lastPose.map { "\($0.key)=\($0.value.pose)（\(Int(now.timeIntervalSince($0.value.at)))秒前）" }.sorted()
        L.append("最近状态 \(poses.isEmpty ? "无" : poses.joined(separator: "，"))")
        let seen = lastSeen
        L.append("最近收到消息 " + Self.seenKeys.keys.sorted().map { "\($0) \(Self.agoText(seen[Self.seenKeys[$0]!]))" }.joined(separator: "，"))
        if defaults.bool(forKey: "gptQuota") { L.append("GPT 额度最近一次读到 \(lastGptQuota)") }
        L.append("装在 \(Bundle.main.bundlePath.replacingOccurrences(of: NSHomeDirectory(), with: "~"))\(canSelfUpdate ? "" : "（不在应用程序文件夹，不能一键更新）")；"
                 + "开发者工具/python3 \(pythonReady ? "有" : "没有")；检查更新 \(lastUpdateCheck)；已运行 \(Int(now.timeIntervalSince(launchedAt) / 60)) 分钟")
        return L.joined(separator: "\n")
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
            if pythonReady, integrateScript != nil {
                runIntegrate(["diagnose"]) { [weak self] out, _ in
                    self?.diagText = String(out.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000))
                    self?.pushFeedbackInfo()
                }
            }
            if integrated == nil, integrateScript != nil {
                runIntegrate(["installed"]) { [weak self] out, _ in
                    let last = out.split(separator: "\n").last.map(String.init) ?? "[]"
                    self?.integrated = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String] ?? []
                    self?.pushFeedbackInfo()
                }
            }
        }
    }

}

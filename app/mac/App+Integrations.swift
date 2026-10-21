import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
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
        ("cursor", "Cursor", "跟着工作状态动。默认演 GPT，命令末尾可以改成自己的角色"),
        ("qwen", "Qwen Code（阿里）", "按当前模型换角色；新开的会话生效"),
    ]
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

    // MARK: 接入被别的工具冲掉时接回去
    // CC Switch 3.x 切换服务商会整个重写 ~/.claude/settings.json，CrossPet 的 mod / 钩子跟着没了，她就不跟着 Claude 动了。
    // 每 3 秒看一眼这个文件，有改动就等 2 秒（等对方写完）跑一次 integrate.py heal：只补 CrossPet 自己的那一项，
    // 在 CrossPet 里撤销过的不管。启动时也看一次（桌宠关着时被冲掉的）。一小时最多接 6 次，免得和别的工具来回打架
    /// 系统自带的 python3 能直接用（装了开发者工具）：没装时一调用就弹「安装命令行工具」，后台的自动检查不能弹窗
    var claudeSettingsURL: URL {
        let dir = ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude")
        return dir.appendingPathComponent("settings.json")
    }
    // MARK: 心跳：各个 AI 最近一次发来消息的时间
    // 钩子 / 插件每收到一条事件就在状态目录写 seen-<名字>（时间戳）。状态目录 /tmp 重启会清空，所以桌宠把读到的最新时间存进设置。
    // 设置里据此标出「接上了但从没收到过消息」，反馈里也带着
    static let seenKeys = ["claude-hooks": "claude", "claude-mod": "claude-mod", "codex": "gpt", "deepseek": "deepseek", "gemini": "gemini",
                           "antigravity": "antigravity", "workbuddy": "workbuddy", "zcode": "zcode", "hermes": "hermes", "qwen": "qwen", "cursor": "cursor"]
    var lastSeen: [String: Double] {
        get { (defaults.dictionary(forKey: "seen") as? [String: Double]) ?? [:] }
        set { defaults.set(newValue, forKey: "seen") }
    }
    func refreshSeen() {
        var seen = lastSeen, changed = false
        for key in Set(Self.seenKeys.values) {
            guard let text = try? String(contentsOf: stateDir.appendingPathComponent("seen-\(key)"), encoding: .utf8),
                  let ts = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)), ts > (seen[key] ?? 0) else { continue }
            seen[key] = ts; changed = true
        }
        if changed { lastSeen = seen; if settingsWeb != nil { pushSettings() } }
    }
    static func agoText(_ ts: Double?) -> String {
        guard let ts else { return "从没收到" }
        let d = Date().timeIntervalSince1970 - ts
        return d >= 86400 ? "\(Int(d / 86400)) 天前" : d >= 3600 ? "\(Int(d / 3600)) 小时前" : d >= 60 ? "\(Int(d / 60)) 分钟前" : "刚刚"
    }

    func watchClaudeConfig() {
        refreshSeen()
        guard ready, let stamp = (try? FileManager.default.attributesOfItem(atPath: claudeSettingsURL.path))?[.modificationDate] as? Date,
              stamp != claudeConfigStamp else { return }
        claudeConfigStamp = stamp
        healPending?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.healIntegrations() }
        healPending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }
    func healIntegrations() {
        healTimes = healTimes.filter { Date().timeIntervalSince($0) < 3600 }
        guard healTimes.count < 6, pythonReady, integrateScript != nil else { return }
        runIntegrate(["heal"]) { [weak self] out, code in
            guard let self, code == 0 else { return }
            let last = out.split(separator: "\n").last.map(String.init) ?? "[]"
            let healed = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String] ?? []
            guard !healed.isEmpty else { return }
            self.healTimes.append(Date())
            NSLog("CrossPet: 接回被冲掉的接入 \(healed)")
            self.js("configHealed()")
            self.refreshIntegrated()
        }
    }

    func refreshIntegrated() {
        runIntegrate(["installed"]) { [weak self] out, code in
            guard let self else { return }
            let last = out.split(separator: "\n").last.map(String.init) ?? "[]"
            self.integrated = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String] ?? []
            self.pushSettings()
        }
        refreshPlugins()
    }

    /// 插件版本（只读检查，不改任何配置）：有新版本 / 更新了还没重开时，设置页那一行挂提醒；tellPet：桌宠刚启动，让她闲下来时说一句。
    /// 只提醒、不自动更新——改别家配置一律让用户自己点「更新」。和 Windows 版 RefreshPlugins 一致
    func refreshPlugins(tellPet: Bool = false) {
        runIntegrate(["plugins"]) { [weak self] out, code in
            guard let self, code == 0, let last = out.split(separator: "\n").last.map(String.init),
                  (try? JSONSerialization.jsonObject(with: Data(last.utf8))) is [Any] else { return }
            DispatchQueue.main.async {
                self.pluginStatus = last
                if tellPet { self.js("setPluginUpdates(\(last))") }
                self.pushSettings()
            }
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
        // 当前角色以桌宠页面里正在演的为准（启动时外壳会先从 UserDefaults 恢复上次的角色，见 didFinish）
        web.evaluateJavaScript("charId") { [weak self] r, _ in
            guard let self, let v = self.settingsWeb else { return }
            // 只在还不知道当前角色时（刚启动、没存过上次的角色）问页面；换角色有 0.33 秒过渡，过渡中页面里还是旧角色
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
                if let n = value as? Double { let v = min(1.6, max(0.6, (n * 100).rounded() / 100)); defaults.set(v, forKey: "size"); applySizes(animateTo: CGFloat(v)) }
            case "textSize":   // 单独调文字：同时记为解锁
                if let n = value as? Double {
                    defaults.set(min(1.6, max(0.6, (n * 100).rounded() / 100)), forKey: "textSize")
                    defaults.set(false, forKey: "textLinked")
                    applySizes()
                }
            case "textLinked":
                defaults.set(value as? Bool ?? true, forKey: "textLinked"); applySizes()
            case "showName":
                let on = value as? Bool ?? true; defaults.set(on, forKey: "showName"); js("setShowName(\(on))")
            case "aura":
                if let mode = value as? String, ["auto", "on", "off"].contains(mode) { defaults.set(mode, forKey: "auraMode"); js("setAuraMode(\(quote(mode)))") }
            case "followApps":
                defaults.set(value as? Bool ?? true, forKey: "followApps")
            case "followEvents":
                defaults.set(value as? Bool ?? false, forKey: "followEvents")
            case "hideFullscreen":
                defaults.set(value as? Bool ?? true, forKey: "hideFullscreen"); applyFullscreenBehavior()
            case "eggs":
                let on = value as? Bool ?? true; defaults.set(on, forKey: "eggs"); js("setEggsEnabled(\(on))")
            case "gptQuota":
                if (value as? Bool ?? false) != defaults.bool(forKey: "gptQuota") { toggleGPTQuota() }
            case "agyQuota":
                if (value as? Bool ?? false) != defaults.bool(forKey: "agyQuota") { toggleAntigravityQuota() }
            case "hideHotkey":
                if let v = value as? String { defaults.set(v, forKey: "hideHotkey"); registerHotKey() }
            case "powerSave":
                let on = value as? Bool ?? false
                defaults.set(on, forKey: "powerSave"); js("setPowerSave(\(on))")
            case "quotaAggregate":
                let on = value as? Bool ?? false
                defaults.set(on, forKey: "quotaAggregate"); js("setQuotaAggregate(\(on))")
            case "whatsNewSeen":   // 打开了「新功能」页：记为看过，小红点消失
                if let v = value as? String { defaults.set(v, forKey: "whatsNewSeen") }
            case "codexResets":
                let on = value as? Bool ?? false
                defaults.set(on, forKey: "codexResets"); js("setCodexResets(\(on))")
            case "peakSkins":
                defaults.set(Self.cleanPeakSkins(value), forKey: "peakSkins"); js("setPeakSkins(\(peakSkinsJSON))")
            case "peakStyle":
                if let s = value as? String, ["bar", "text", "off"].contains(s) { defaults.set(s, forKey: "peakStyle"); js("setPeakStyle(\(quote(s)))") }
            case "dsQuota":
                let on = value as? Bool ?? true
                defaults.set(on, forKey: "dsQuota")
                stamps["deepseek-quota"] = nil   // 重新打开时马上读一次
                if !on { js("setQuota('deepseek', null)") }
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
            case "openCodexResets": NSWorkspace.shared.open(URL(string: "https://codex-resets.com")!)
            case "openData": NSWorkspace.shared.open(root)
            case "openReleases": NSWorkspace.shared.open(URL(string: "https://github.com/lokicorvus/crosspet/releases")!)
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

}

import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 角色

    /// 扫描 characters/<id>/：character.json + 立绘（.webp / .png）。文件名去掉 -2、-3 后缀是姿态名，idle-blink 是眨眼帧。
    func loadCharacters() {
        followEventGeneration &+= 1
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
        // 「新功能」页看到哪一版了（设置里的小红点用）：没记过时，老用户按上次的版本算（有没看过的就亮），新安装按当前版本（不亮）。要在下面改掉 lastVersion 之前记
        if defaults.string(forKey: "whatsNewSeen") == nil { defaults.set(last ?? currentVersion, forKey: "whatsNewSeen") }
        if last != currentVersion {
            defaults.set(currentVersion, forKey: "lastVersion")
            // 带上上次的版本：这版（跳过的几版合在一起）有新功能就弹「新功能」卡片（见 whats-new.js）
            if last != nil, isNewer(currentVersion, than: last!) { js("justUpdated(\(quote("v" + currentVersion)), \(quote(last!)))") }
        }
    }

    func switchTo(_ id: String) {
        currentId = id
        defaults.set(id, forKey: "character")   // 重启后恢复（didFinish 里）；Windows 的 SwitchTo 也是这么记的
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
        if bundle == "com.todesktop.230313mzl4w4u92" { return "cursor" }
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
        guard let c = obj["character"] as? String, characterIds.contains(c) else { return id == "cursor" ? (Self.hostDefaults[id].flatMap { characterIds.contains($0) ? $0 : nil } ?? id) : id }
        return c
    }
    static let hostDefaults = ["zcode": "glm", "qwen": "qwen", "cursor": "gpt"]

    // 菜单和控制台都能直接 reload；统一在导航开始时撤销旧页面上的异步选择。
    // didFinish 仍按原流程恢复角色、清空 stamps 并重新跟随前台，不改 pendingSwitch 的调度。
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard webView === web else { return }
        followEventGeneration &+= 1
        ready = false
    }

    /// 切到某个 AI 的 App 后，要在它上面停留一会儿才换角色：
    /// App 启动时窗口会短暂地抢焦点、让焦点，立即响应会来回闪。
    @objc func spaceChanged(_ note: Notification) {
        fullscreenOverride = false
        // 进全屏的动画要一会儿，窗口大小稳定了再看
        for delay in [0.1, 0.8] { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.checkFullscreen() } }
    }

    @objc func appActivated(_ note: Notification) {
        followEventGeneration &+= 1
        spaceChanged(note)
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

}

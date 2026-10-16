import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 设置
    // 一个独立窗口（web/settings.html，和 Windows 版共用），右键菜单只留常用的几项，其余都在这里
    static let baseSize = NSSize(width: 260, height: 362)
    var petScale: CGFloat {
        let v = defaults.double(forKey: "size")
        return v >= 0.6 && v <= 1.6 ? CGFloat(v) : 1
    }
    /// 文字大小（只在解锁时用）和锁：没存过 = 锁着，文字跟着人物，和以前一样
    var textScale: Double {
        let v = defaults.double(forKey: "textSize")
        return v >= 0.6 && v <= 1.6 ? v : 1
    }
    var textLinked: Bool { defaults.object(forKey: "textLinked") as? Bool ?? true }
    var showName: Bool { defaults.object(forKey: "showName") as? Bool ?? true }
    var followApps: Bool { defaults.object(forKey: "followApps") as? Bool ?? true }
    var followEvents: Bool { defaults.object(forKey: "followEvents") as? Bool ?? true }
    var eggsEnabled: Bool { defaults.object(forKey: "eggs") as? Bool ?? true }

    /// 换大小时窗口锚在哪：
    /// - corner：启动 / 网页重载。存下的位置本来就是这个画布的窗口，左下角不动只换大小（不然解锁的人每次启动都往旁边漂）
    /// - bottom：改人物大小。底边中点不动（脚下的位置不变），和以前一样；屏幕上的底栏高 = 62 × 文字大小，没变
    /// - feet：改文字大小。底栏在屏幕上变高 / 变矮多少，窗口底边就往下 / 往上挪多少，人物不动
    enum Anchor: String { case corner, bottom, feet }

    /// 纯计算（tests/window_place_probe.sh 测），屏幕点、y 向上。oldFoot / newFoot：底栏在屏幕上的高
    static func placeWindow(old: NSRect, size: NSSize, oldFoot: CGFloat, newFoot: CGFloat, anchor: Anchor, visibleMinY: CGFloat?) -> NSRect {
        switch anchor {
        case .corner:
            return NSRect(origin: old.origin, size: size)
        case .bottom:
            return NSRect(x: old.midX - size.width / 2, y: old.minY, width: size.width, height: size.height)
        case .feet:
            var y = old.minY - (newFoot - oldFoot)
            // 往下扩出了可见区：挪回来，但不挪到比原来还高（用户本来就放在边上的不动）
            if let v = visibleMinY, y < v, y < old.minY { y = min(old.minY, v) }
            return NSRect(x: old.midX - size.width / 2, y: y, width: size.width, height: size.height)
        }
    }

    /// 改大小：窗口 = 画布 × 人物大小，网页按人物大小缩放；放在哪见 Anchor
    func applyScale(_ scale: CGFloat, anchor: Anchor = .bottom) {
        let size = NSSize(width: pageSize.width * scale, height: pageSize.height * scale)
        let f = Self.placeWindow(old: panel.frame, size: size, oldFoot: shownFootPt, newFoot: pageFoot * scale, anchor: anchor,
                                 visibleMinY: (panel.screen ?? NSScreen.main)?.visibleFrame.minY)
        panel.setFrame(f, display: true)
        web.pageZoom = scale
        shownFootPt = pageFoot * scale
        defaults.set([f.minX, f.minY], forKey: "origin")
    }

    /// 人物大小 / 文字大小变了：交给网页算画布（规则在 app/web/text-size.js），按回来的尺寸设窗口。
    /// target：人物大小要动画到哪（底边不动）；nil = 文字变了（anchor .feet）或网页刚加载完（.corner），按现在的人物大小重设一次
    func applySizes(animateTo target: CGFloat? = nil, anchor: Anchor = .feet) {
        if shownFootPt == 0 { shownFootPt = pageFoot * panel.frame.width / pageSize.width }   // 还没按画布设过：按现在的窗口算
        let finish = { [weak self] in
            guard let self else { return }
            if let t = target { self.animateScale(to: t); return }
            self.applyScale(self.shownScale > 0 ? self.shownScale : self.petScale, anchor: anchor)
            if anchor == .feet, self.dock != nil { self.applyDock() }   // 贴着边时改了文字：窗口变宽了，重新对齐屏幕边
        }
        guard ready else { finish(); return }   // 网页还没加载完：先按旧画布，加载完（didFinish）会再调一次
        web.evaluateJavaScript("setSizes(\(Double(target ?? petScale)), \(textScale), \(textLinked))") { [weak self] r, _ in
            guard let self else { return }
            if let text = r as? String, let data = text.data(using: .utf8),
               let o = try? JSONSerialization.jsonObject(with: data) as? [String: Double],
               let w = o["w"], let h = o["h"], let foot = o["foot"] {
                let page = NSSize(width: w, height: h)
                if page != self.pageSize || CGFloat(foot) != self.pageFoot { self.dockCut = [:] }   // 画布变了：贴边切口要重新量
                self.pageSize = page
                self.pageFoot = CGFloat(foot)
            }
            finish()
        }
    }

    /// 拖滑块时每次只变一点，直接跟手；一下子变很多（点「还原」）时用 0.2 秒过渡过去
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
            "size": Double(petScale), "textSize": textScale, "textLinked": textLinked, "showName": showName, "eggs": eggsEnabled, "hideFullscreen": hideInFullscreen, "aura": auraMode, "followApps": followApps, "followEvents": followEvents,
            "gptQuota": defaults.bool(forKey: "gptQuota"), "agyQuota": defaults.bool(forKey: "agyQuota"), "gptQuotaNote": codexNote,
            "login": SMAppService.mainApp.status == .enabled,
            "edgeDock": edgeDockEnabled, "dsQuota": dsQuotaEnabled, "quotaAggregate": quotaAggregate, "powerSave": powerSave,
            "hideHotkey": hideHotkey, "hotkeyFailed": hotkeyFailed, "hotkeys": [["id": "off", "label": "不用快捷键"]] + Self.hotkeyChoices.map { ["id": $0.id, "label": $0.label] },
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
            "plugins": (try? JSONSerialization.jsonObject(with: Data(pluginStatus.utf8))) ?? [],
        ]
        if let r = latestRelease, canSelfUpdate { state["update"] = r.tag }
        if let list = integrated, integrateScript != nil {
            state["integrations"] = Self.integrationTargets.map {
                ["id": $0.id, "label": $0.label, "note": $0.note, "installed": list.contains($0.id),
                 "lastSeen": lastSeen[Self.seenKeys[$0.id] ?? ""].map { Date().timeIntervalSince1970 - $0 as Any } ?? NSNull()] as [String: Any]
            }
        }
        return state
    }

}

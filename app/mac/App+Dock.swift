import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 贴边
    // 拖到屏幕左 / 右边缘松手：她缩到屏幕外，只露半个身子扒着边缘（额度、名牌、气泡都藏起来）。
    // AI 干活时（或在等你回答）自己跑出来，干完过约 10 秒缩回去；鼠标移到露出来的那截上她会探出来一点。
    // 拖离边缘就不贴了。另一块屏幕接在这边时不算边缘
    var edgeDockEnabled: Bool { defaults.object(forKey: "edgeDock") as? Bool ?? true }
    /// DeepSeek 余额（默认开）：用别家订阅（OpenCode Go……）跑 DeepSeek 模型时官方账户没钱，她会一直没精神，可以关掉
    var dsQuotaEnabled: Bool { defaults.object(forKey: "dsQuota") as? Bool ?? true }
    /// 额度合并显示（默认关）：小窗把各家 AI 的额度排成几行，而不是只显示当前角色的。怎么排在网页里（quota-aggregate.js）
    var quotaAggregate: Bool { defaults.bool(forKey: "quotaAggregate") }
    var quotaStyle: String { defaults.string(forKey: "quotaStyle") == "bars" ? "bars" : "text" }   // 额度怎么显示：text 文字（默认）/ bars 额度条（网页层 quota-bars.js）
    var peakStyle: String { ["text", "off"].contains(defaults.string(forKey: "peakStyle") ?? "") ? defaults.string(forKey: "peakStyle")! : "bar" }   // 额度栏怎么显示峰谷时段：bar 时间条（默认）/ text 一行文字 / off（规则在网页层 peak-hours.js）
    /// 按时段换衣服：{ 角色: { peak: 皮肤, valley: 皮肤 } }（"" = 原版，没写 = 不换）。判断在网页层（peak-hours.js），这里只存
    var peakSkins: [String: [String: String]] { Self.cleanPeakSkins(defaults.dictionary(forKey: "peakSkins")) }
    static func cleanPeakSkins(_ v: Any?) -> [String: [String: String]] {
        var out: [String: [String: String]] = [:]
        for (id, x) in v as? [String: Any] ?? [:] {
            guard let d = x as? [String: Any] else { continue }
            var e: [String: String] = [:]
            for k in ["peak", "valley"] { if let s = d[k] as? String { e[k] = s } }
            if !e.isEmpty { out[id] = e }
        }
        return out
    }
    var peakSkinsJSON: String {
        guard let data = try? JSONSerialization.data(withJSONObject: peakSkins), let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }
    var codexResets: Bool { defaults.bool(forKey: "codexResets") }   // Codex 重置提醒（默认关，数据来自 codex-resets.com）
    /// 省电模式（默认关）：特效每秒 15 帧、闲着 10 秒就停（平时 30 帧、30 秒）
    var powerSave: Bool { defaults.bool(forKey: "powerSave") }
    // 看不见的时候（窗口被完全挡住、锁屏、屏幕休眠）让网页把动画全停了
    func updatePageHidden() {
        guard ready else { return }
        js("setPageHidden(\(screensAsleep || userHidden || hiddenForFullscreen || !panel.occlusionState.contains(.visible)))")
        // 藏着 / 屏幕休眠时定时的不查：从那种状态回来时补一次（自带 5 分钟 / 1 分钟间隔，不会多问）
        let away = screensAsleep || userHidden
        if wasAway && !away { refreshCodexQuota(.tick) }
        wasAway = away
    }

    func undock() {
        guard dock != nil else { return }
        dock = nil; dockOut = false; dockHover = false; dockTucked = false
        defaults.removeObject(forKey: "dock")
        js("setTucked(null)")
    }
    func checkDock() {
        guard edgeDockEnabled, let screen = panel.screen ?? NSScreen.main else { return }
        let f = panel.frame, vf = screen.visibleFrame, reach = f.width * (Self.baseSize.width / pageSize.width) * 0.3   // 按人物那块的宽算：画布因为文字变宽时不该更容易贴边
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
            let zoom = f.width / self.pageSize.width
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
    var currentIdKey: String { currentId ?? "" }
    func slide(to frame: NSRect) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.35
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(frame, display: true)
        }
    }
    /// 缩着时鼠标在露出来的那截上停 0.15 秒：探出来；移开 0.3 秒后缩回去
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

}

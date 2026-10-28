import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 点击穿透
    // 窗口比桌宠大（给动作、气泡留的空间）：鼠标不在桌宠本体、气泡、名牌、额度上时让窗口不接鼠标，点击落到后面的窗口

    func updateClickThrough() {
        if userHidden || hiddenForFullscreen {   // 收着：透明的窗口不能接鼠标（下面会按命中区域反复切换，这里先拦住）
            if !panel.ignoresMouseEvents { panel.ignoresMouseEvents = true }
            return
        }
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
        let zoom = f.width / pageSize.width   // 网页像素 → 屏幕点（画布可能因为文字大小比 260 宽）
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
        appLog("显示层级改成 \(mode)")
        applyLayer()
    }

    /// 收起来 / 放回来（全屏时收着、快捷键藏起来）：只改透明度和鼠标，窗口始终在所有桌面里。
    /// 不 orderOut：退出全屏程序的那一刻窗口如果是摘下来的，「所有桌面都显示」就失效了，
    /// 之后再放回来也只在退出全屏的那个桌面有她（isOnActiveSpace 为 false，别的桌面上右键也没反应）
    func applyHiddenState() {
        let hidden = userHidden || hiddenForFullscreen
        panel.alphaValue = hidden ? 0 : 1
        if hidden { panel.ignoresMouseEvents = true }
        updatePageHidden()
    }

    /// 一直允许出现在全屏程序的空间里：AI 程序（Codex、Claude……）全屏时要照常显示，别的程序全屏时由 checkFullscreen 藏起来
    func applyFullscreenBehavior() {
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        checkFullscreen()
    }

    // 全屏时隐藏：光靠上面的 collectionBehavior 不够（「所有空间都显示」的浮动面板照样会盖在全屏程序上），
    // 所以自己看：桌宠所在的那块屏幕上，前台程序有没有一个盖满整块屏幕的窗口（全屏程序、全屏视频、演示）。
    // 有就收起来，退出全屏再放回来。只看窗口位置和大小，不需要录屏权限；每秒看一次，切换空间 / 前台程序时马上看
    func checkFullscreen() {
        fullscreenCheckedAt = Date()
        if userHidden { return }   // 你用快捷键藏起来的：全屏规则不管她
        // 全屏的是 AI 程序（专心和 AI 干活）：照常显示；看视频、演示、玩游戏才藏
        let full = hideInFullscreen && !fullscreenOverride && !frontIsAI && frontIsFullscreen()
        guard full != hiddenForFullscreen else { return }
        hiddenForFullscreen = full
        if full {
            // 不 orderOut：窗口一直留着，只是透明、不接鼠标、动画停掉（hiddenForFullscreen 的 didSet 里做，
            // 原因见 applyHiddenState；Windows 也是这么藏的）
        } else {
            panel.orderFrontRegardless()
            if layerMode != "always" { orderBelowFrontWindow() }
        }
    }
    func frontIsFullscreen() -> Bool {
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              let screen = panel.screen ?? NSScreen.main, let primary = NSScreen.screens.first,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]
        else { return false }
        // NSScreen 是左下角原点，窗口列表是主屏左上角原点
        let f = screen.frame
        let t = CGRect(x: f.minX, y: primary.frame.maxY - f.maxY, width: f.width, height: f.height)
        let near = { (a: CGFloat, b: CGFloat) in abs(a - b) < 2 }
        func rect(_ w: [String: Any]) -> CGRect? {
            guard let b = w[kCGWindowBounds as String] as? [String: CGFloat], let x = b["X"], let y = b["Y"], let wd = b["Width"], let h = b["Height"] else { return nil }
            return CGRect(x: x, y: y, width: wd, height: h)
        }
        let pid = { (w: [String: Any]) in w[kCGWindowOwnerPID as String] as? Int32 }
        let layer = { (w: [String: Any]) in w[kCGWindowLayer as String] as? Int ?? -1 }
        // 前台程序的普通窗口：左右铺满、底边到屏幕底。有刘海的屏幕全屏时顶上会让出刘海那一条（约 37 点）
        let topSlack = max(screen.safeAreaInsets.top, 24) + 16   // 实测：刘海安全区 32，全屏窗口让出 37；后面还有一道确认，这里放宽
        var exact = false, fills = false
        for w in list where pid(w) == app.processIdentifier && layer(w) == 0 {
            guard let r = rect(w), near(r.minX, t.minX), near(r.width, t.width), near(r.maxY, t.maxY) else { continue }
            if near(r.minY, t.minY) { exact = true } else if r.minY - t.minY <= topSlack { fills = true }
        }
        if exact { return true }
        guard fills else { return false }
        // 顶上让出了刘海：再确认真的是全屏（不是 Dock 自动隐藏时的最大化窗口）——
        // 全屏时前台程序在屏幕顶上有一条同宽的高层窗口（隐藏起来的标题栏），而平时铺满屏幕的程序坞窗口不在了
        let strip = list.contains { w in
            guard pid(w) == app.processIdentifier, layer(w) > 0, let r = rect(w) else { return false }
            return near(r.minX, t.minX) && near(r.minY, t.minY) && near(r.width, t.width) && r.height <= 80
        }
        let dockPid = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first?.processIdentifier
        let dockOverlay = list.contains { w in
            guard dockPid != nil, pid(w) == dockPid, let r = rect(w) else { return false }
            return near(r.minX, t.minX) && near(r.minY, t.minY) && near(r.width, t.width) && near(r.height, t.height)
        }
        return strip || !dockOverlay
    }

}

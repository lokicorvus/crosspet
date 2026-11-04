import Cocoa
import WebKit

/// 多桌宠：额外那一只的窗口。和主桌宠同一个进程、同一套网页（index.html，同源、同一份 localStorage），
/// 页面先 setRole('companion') 再 init：只显示，不做只该做一次的事（那些在主桌宠页面里做）。
/// 状态、会话（按她的客户端过滤）、额度都由 App 转发，她自己不读文件（见 App+Companions.swift）。
/// 拖动、贴边、点击穿透各自管；位置记在 origin-<key>、贴边记在 dock-<key>（key = <角色>@<客户端>），主桌宠原来的键不动。
/// 贴边的计算和主桌宠共用 App+Dock.swift 里的纯函数；这里只放她自己的状态。
final class Companion: NSObject, WKNavigationDelegate {
    unowned let app: App
    let id: String              // 窗口身份（页面给的，集合来的收编客户端后 key 变、id 不变）
    private(set) var character: String   // 主桌宠换成她的角色时就地对调成主桌宠原来的角色（窗口、位置不变）
    private(set) var key: String
    private(set) var client: String?   // 集合来、还没收编客户端时是 nil
    private(set) var quota: Bool       // 同一个角色只有一只显示额度
    private(set) var label: String     // 「桌面」「终端」小字（同一个角色站了两只时）
    let panel: NSPanel
    let web: WKWebView
    private(set) var ready = false
    private(set) var leaving = false
    private(set) var closed = false
    var lastPose: (pose: String, at: Date)?   // 她最近一次状态（贴边时判断跑不跑出来）

    // 尺寸：画布（网页 CSS 尺寸）× 人物大小，和主桌宠一样由网页 setSizes 算
    var pageSize: NSSize, pageFoot: CGFloat, shownFootPt: CGFloat
    // 点击穿透
    var hitRects: [CGRect] = []
    var hitRectsAt = Date.distantPast
    // 贴边
    var dock: String?
    var dockOut = false, dockHover = false, dockTucked = false
    var dockedAt = Date.distantPast
    var dockEnterAt: Date?, dockLeaveAt: Date?
    var dockCut: [String: Double] = [:]
    private var observers: [NSObjectProtocol] = []
    private var crashes = 0   // 网页进程崩了几次

    var originKey: String { "origin-\(key)" }
    /// 自动记位置。集合来、还没收编客户端的（<角色>@gather）不记：下次集合要在主桌宠旁边重新排开；你拖过的照样记（DragView）
    func saveOrigin() {
        guard !key.hasSuffix("@gather") else { return }
        defaults.set([panel.frame.minX, panel.frame.minY], forKey: originKey)
    }
    var dockKey: String { "dock-\(key)" }

    /// pet：主桌宠页面 companions 列表里的一项 { id, key, character, client, quota, label }（App.syncCompanions 已检查过 id 和角色）
    init(app: App, pet: [String: Any]) {
        self.app = app
        let id = pet["id"] as? String ?? "", key = pet["key"] as? String ?? id
        self.id = id
        character = pet["character"] as? String ?? ""
        self.key = key
        client = pet["client"] as? String
        quota = pet["quota"] as? Bool ?? false
        label = pet["label"] as? String ?? ""
        pageSize = app.pageSize; pageFoot = app.pageFoot; shownFootPt = app.shownFootPt
        let size = app.panel.frame.size   // 和主桌宠一样大（共用人物大小、文字大小）
        panel = PetPanel(contentRect: NSRect(origin: app.companionOrigin(key: key, size: size), size: size),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        let config = WKWebViewConfiguration()
        let bridge = DevBridge(app: app, kind: .companion)
        config.userContentController.add(bridge, name: "pet")   // 页面里 toShell 走的是 pet 这个通道
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        web = WKWebView(frame: container.bounds, configuration: config)
        super.init()
        bridge.companion = self
        saveOrigin()   // 走了以后这个客户端又干活：回到这里出现

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = app.panel.level
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = app.panel.collectionBehavior
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.pageZoom = app.petScale
        web.loadFileURL(app.root.appendingPathComponent("web/index.html"), allowingReadAccessTo: app.root)
        container.addSubview(web)

        let drag = DragView(frame: container.bounds)
        drag.autoresizingMask = [.width, .height]
        drag.originKey = originKey
        drag.onClick = { [weak self, weak drag] p in
            guard let self, let drag else { return }
            let z = max(self.web.pageZoom, 0.01)
            self.js(String(format: "handleClick('pat', %.1f, %.1f)", p.x / z, (drag.bounds.height - p.y) / z))
        }
        drag.onMenu = { [weak self, weak drag] e in if let self, let drag { self.showMenu(e, in: drag) } }
        drag.onDragStart = { [weak self] in self?.undock() }
        drag.onDragEnd = { [weak self] in self?.checkDock() }
        drag.onShake = { [weak self] in self?.js("shaken()") }
        drag.topRoom = { [weak self] in self.map { s in (s.hitRects.map(\.minY).min() ?? 0) * s.web.pageZoom } ?? 0 }   // 可点区域是画布坐标（左上角起），× 人物大小 = 窗口里的点
        container.addSubview(drag)
        panel.contentView = container

        let hidden = app.userHidden || app.hiddenForFullscreen
        panel.alphaValue = hidden ? 0 : 1
        panel.ignoresMouseEvents = hidden
        panel.orderFrontRegardless()
        if panel.level != .floating { panel.order(.below, relativeTo: app.panel.windowNumber) }
        observers.append(NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: panel, queue: .main) { [weak self] _ in
            self?.updatePageHidden()
        })
    }

    // MARK: 网页

    func js(_ code: String) {
        guard ready, !closed else { return }   // 没加载完的调用不排队：加载完（didFinish）按缓存的状态补一遍
        web.evaluateJavaScript(code, completionHandler: nil)
    }

    var roleInfoJSON: String {
        let info: [String: Any] = ["id": id, "key": key, "character": character, "client": client as Any? ?? NSNull(), "label": label]
        return (try? JSONSerialization.data(withJSONObject: info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { ready = false }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !closed else { return }
        ready = true
        // 一定先 setRole 再 init / setCharacter：不然页面按主桌宠演登场招呼，会写共用的 crosspet-greeted
        js("setRole('companion', \(roleInfoJSON))")
        js("init(\(app.manifestJSON))")
        js(app.companionLookJS)
        js("setCharacter(\(app.quote(character)))")   // 不 quiet：「噗」一下出现，说一句登场招呼
        applySizes(anchor: .corner)
        updatePageHidden()
        app.feedCompanion(self)
        if leaving { web.evaluateJavaScript("leaveNow()", completionHandler: nil) }
        if let side = defaults.string(forKey: dockKey), app.edgeDockEnabled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, !self.closed, self.dock == nil else { return }
                self.setDock(side)
            }
        }
    }
    /// 网页进程崩了：重新载入（didFinish 会重新 setRole、补状态）
    /// 最多重载 3 次：一直崩就关掉（主桌宠页面下次发列表时会重开一只）
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        guard !closed else { return }
        crashes += 1
        if crashes > 3 { close() } else { webView.reload() }
    }

    /// 她的页面发来的消息：摸头记给主桌宠页面（友谊记账只在那里做）；道别演完了关窗口
    func handleMessage(_ body: Any) {
        guard let d = body as? [String: Any] else { return }
        if d["patted"] as? Bool == true { app.js("notePat(\(app.quote(character)))") }
        if d["gone"] as? Bool == true { close() }
    }

    /// 列表里同一个 id 的新内容：收编了客户端（key / client 变了）、小字变了、额度归不归她、对调成了别的角色
    func update(_ pet: [String: Any]) {
        let newKey = pet["key"] as? String ?? key, newClient = pet["client"] as? String
        let newQuota = pet["quota"] as? Bool ?? false, newLabel = pet["label"] as? String ?? ""
        let newCharacter = pet["character"] as? String ?? character
        let characterChanged = newCharacter != character
        let roleChanged = newKey != key || newClient != client || newLabel != label || characterChanged
        let clientChanged = newClient != client || characterChanged
        character = newCharacter
        let quotaChanged = newQuota != quota
        if newKey != key {
            key = newKey
            (panel.contentView?.subviews.compactMap { $0 as? DragView }.first)?.originKey = originKey
            saveOrigin()
            if let side = dock { defaults.set(side, forKey: dockKey) }
        }
        client = newClient; quota = newQuota; label = newLabel
        guard ready else { return }
        if roleChanged { js("setRole('companion', \(roleInfoJSON))") }   // 页面按新的 label 改小字
        if characterChanged { js("setCharacter(\(app.quote(character)))") }   // 噗一下换成她、说登场招呼
        if clientChanged { app.feedCompanion(self) }
        else if quotaChanged {
            if quota { app.quotaCodes(character).forEach { js($0) } } else { js("setQuota(\(app.quote(character)), null)") }
        }
    }

    /// 主桌宠页面让她走：说 bye、冒烟，页面发 gone 后关；页面没回（还没加载完、卡住）3 秒后也关
    func leave() {
        guard !leaving, !closed else { return }
        leaving = true
        js("leaveNow()")
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.close() }
    }

    func close() {
        guard !closed else { return }
        closed = true
        ready = false
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        web.stopLoading()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "pet")
        panel.orderOut(nil)
        panel.close()
        app.companionClosed(self)
    }

    /// 她的状态（按客户端的那份；旧钩子时是按角色的那份）
    func applyState(_ text: String, at stamp: Date) {
        if let data = text.data(using: .utf8), let s = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let pose = s["pose"] as? String {
            lastPose = (pose, stamp)
        }
        js("applyCharState(\(app.quote(character)), \(text))")
    }

    // MARK: 菜单（精简版：换角色、彩蛋、更新、退出只在主桌宠菜单里）

    func showMenu(_ event: NSEvent, in view: NSView) {
        let menu = NSMenu()
        for (title, action) in [("摸摸头", #selector(pat)), ("戳一下", #selector(poke)), ("让她先回去", #selector(sendHome))] as [(String, Selector)] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        // 换衣服：这个角色有别的衣服（皮肤）时列出来，原版排第一。衣服按角色记，同一个角色的几只一起换（App.wear）
        if let skins = app.skinChoices[character], !skins.isEmpty {
            let worn = (defaults.dictionary(forKey: "skins") as? [String: String] ?? [:])[character] ?? ""
            let outfitItem = NSMenuItem(title: "换衣服", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for o in [("", app.baseOutfit[character] ?? "原版")] + skins.map({ ($0.id, $0.name) }) {
                let item = NSMenuItem(title: o.1, action: #selector(wearOutfit(_:)), keyEquivalent: "")
                item.representedObject = o.0
                item.target = self
                item.state = worn == o.0 ? .on : .off
                sub.addItem(item)
            }
            outfitItem.submenu = sub
            menu.addItem(outfitItem)
        }
        menu.addItem(.separator())
        let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: "")
        settings.target = self
        menu.addItem(settings)
        NSMenu.popUpContextMenu(menu, with: event, for: view)
    }
    @objc func pat() { js("handleClick('pat')") }
    @objc func poke() { js("handleClick('poke')") }
    /// 让她先回去：交给主桌宠页面判（她这个客户端开始新的一轮活之前不再出现），页面再发 companionLeave 让她走
    @objc func sendHome() { app.js("sendHome(\(app.quote(id)))") }
    @objc func openSettings() { app.openSettings() }
    @objc func wearOutfit(_ sender: NSMenuItem) { if let skin = sender.representedObject as? String { app.wear(character, skin) } }

    // MARK: 大小、藏起来、层级（跟着主桌宠）

    /// 和主桌宠的 applySizes 一样：网页按人物大小、文字大小算画布，窗口 = 画布 × 人物大小；放在哪见 App.Anchor
    func applySizes(anchor: App.Anchor) {
        guard ready else { return }
        let scale = app.petScale
        if shownFootPt == 0 { shownFootPt = pageFoot * panel.frame.width / pageSize.width }
        web.evaluateJavaScript("setSizes(\(Double(scale)), \(app.textScale), \(app.textLinked))") { [weak self] r, _ in
            guard let self, !self.closed else { return }
            if let text = r as? String, let data = text.data(using: .utf8),
               let o = try? JSONSerialization.jsonObject(with: data) as? [String: Double],
               let w = o["w"], let h = o["h"], let foot = o["foot"] {
                let page = NSSize(width: w, height: h)
                if page != self.pageSize || CGFloat(foot) != self.pageFoot { self.dockCut = [:] }
                self.pageSize = page
                self.pageFoot = CGFloat(foot)
            }
            let size = NSSize(width: self.pageSize.width * scale, height: self.pageSize.height * scale)
            let f = App.placeWindow(old: self.panel.frame, size: size, oldFoot: self.shownFootPt, newFoot: self.pageFoot * scale, anchor: anchor,
                                    visibleMinY: (self.panel.screen ?? NSScreen.main)?.visibleFrame.minY)
            self.panel.setFrame(f, display: true)
            self.web.pageZoom = scale
            self.shownFootPt = self.pageFoot * scale
            if self.dock != nil { self.applyDock() } else { self.saveOrigin() }
        }
    }

    func updatePageHidden() {
        js("setPageHidden(\(app.screensAsleep || app.userHidden || app.hiddenForFullscreen || !panel.occlusionState.contains(.visible)))")
    }

    /// 全屏隐藏、快捷键隐藏、显示层级跟着主桌宠（App.syncCompanionWindows 调）：透明度和鼠标、层级都照主桌宠的来
    func syncWithMain() {
        guard !closed else { return }
        let hidden = app.userHidden || app.hiddenForFullscreen
        let alpha: CGFloat = hidden ? 0 : 1
        if panel.alphaValue != alpha {
            panel.alphaValue = alpha
            if hidden { panel.ignoresMouseEvents = true }
            else {   // 放回来：和主桌宠一样回到前面（不 orderOut，原因见 App.applyHiddenState）
                panel.orderFrontRegardless()
                if app.panel.level != .floating { panel.order(.below, relativeTo: app.panel.windowNumber) }
            }
            updatePageHidden()
        }
        if panel.level != app.panel.level {
            panel.level = app.panel.level
            // 浮上来：到最前面；降成普通窗口：排在主桌宠后面（主桌宠已经挪到前台窗口后面了）
            if panel.level == .floating { panel.orderFrontRegardless() } else { panel.order(.below, relativeTo: app.panel.windowNumber) }
        }
    }

    // MARK: 点击穿透（和主桌宠的 updateClickThrough 一样）

    func updateClickThrough() {
        guard !closed else { return }
        if app.userHidden || app.hiddenForFullscreen {
            if !panel.ignoresMouseEvents { panel.ignoresMouseEvents = true }
            return
        }
        let p = NSEvent.mouseLocation, f = panel.frame
        guard f.contains(p) else { updateDockHover(false); return }
        if NSEvent.pressedMouseButtons != 0 { return }
        if ready, Date().timeIntervalSince(hitRectsAt) > (dock != nil ? 0.08 : 0.25) {
            hitRectsAt = Date()
            web.evaluateJavaScript("hitRects()") { [weak self] r, _ in
                guard let text = r as? String, let data = text.data(using: .utf8),
                      let list = try? JSONSerialization.jsonObject(with: data) as? [[Double]] else { return }
                self?.hitRects = list.filter { $0.count == 4 }.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            }
        }
        let zoom = f.width / pageSize.width
        let point = CGPoint(x: (p.x - f.minX) / zoom, y: (f.maxY - p.y) / zoom)
        let over = hitRects.isEmpty || hitRects.contains { $0.contains(point) }
        if panel.ignoresMouseEvents == over { panel.ignoresMouseEvents = !over }
        updateDockHover(over && !hitRects.isEmpty)
    }

    // MARK: 贴边（规则同主桌宠，见 App+Dock.swift；跑不跑出来只看她自己的状态）

    func undock() {
        guard dock != nil else { return }
        dock = nil; dockOut = false; dockHover = false; dockTucked = false
        defaults.removeObject(forKey: dockKey)
        js("setTucked(null)")
    }
    func checkDock() {
        guard app.edgeDockEnabled, let screen = panel.screen ?? NSScreen.main,
              let side = App.dockSide(frame: panel.frame, screen: screen, pageWidth: pageSize.width) else { return }
        setDock(side)
    }
    func setDock(_ side: String) {
        dock = side
        dockedAt = Date()
        defaults.set(side, forKey: dockKey)
        dockOut = dockBusy
        applyDock()
    }
    var dockBusy: Bool { App.dockBusy(lastPose.map { [$0] } ?? [], since: dockedAt, now: Date()) }
    func updateDock() {
        guard dock != nil, !closed else { return }
        let busy = dockBusy
        if busy != dockOut { dockOut = busy; dockHover = false; applyDock() }
    }
    func applyDock() {
        guard let side = dock, !closed, let screen = panel.screen ?? NSScreen.main else { return }
        hitRects = []; hitRectsAt = .distantPast
        let vf = screen.visibleFrame
        let f = App.dockClampY(panel.frame, vf)
        var g = f; g.origin.x = App.dockEdgeX(side, width: f.width, vf)
        if dockOut {
            dockTucked = false
            js("setTucked(null)")
            slide(to: g)
            return
        }
        // 先整个滑到屏幕边缘，滑完再缩进去（同主桌宠）
        if !dockTucked, abs(panel.frame.origin.x - g.origin.x) > 1 || abs(panel.frame.origin.y - g.origin.y) > 1 {
            slide(to: g)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.37) { [weak self] in self?.tuck(side, vf) }
            return
        }
        tuck(side, vf)
    }
    func tuck(_ side: String, _ vf: NSRect) {
        guard dock == side, !dockOut, !closed else { return }
        dockTucked = true
        var f = panel.frame
        let peek = dockHover
        js("setTucked(\(app.quote(side)), \(peek))")
        let cutKey = side + (peek ? "-peek" : "")
        let place = { [weak self] (cut: Double) in
            guard let self, self.dock == side, !self.dockOut, self.dockHover == peek else { return }
            f.origin.x = App.tuckX(side, cut: cut, zoom: f.width / self.pageSize.width, vf)
            if abs(f.origin.x - self.panel.frame.origin.x) > 1 { self.slide(to: f) }
        }
        if let cut = dockCut[cutKey] { place(cut); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            guard let self, self.ready, self.dock == side, !self.dockOut, self.dockHover == peek else { return }
            self.web.evaluateJavaScript("dockCut(\(self.app.quote(side)))") { [weak self] r, _ in
                guard let cut = (r as? NSNumber)?.doubleValue else { return }
                self?.dockCut[cutKey] = cut
                place(cut)
            }
        }
    }
    func slide(to frame: NSRect) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.35
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(frame, display: true)
        }
    }
    func updateDockHover(_ inside: Bool) {
        guard dock != nil, !dockOut else { return }
        if inside {
            dockLeaveAt = nil
            guard !dockHover else { return }
            if dockEnterAt == nil { dockEnterAt = Date() }
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

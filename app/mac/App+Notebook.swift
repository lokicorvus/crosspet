import Cocoa
import WebKit

/// 小本子的小窗：无边框、透明，能成为 key（收 Esc、点外面收起）但不激活整个程序
final class NotebookPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

/// 她的小本子（相处记录）：右键「我们的小本子」在她旁边弹出 web/notebook.html。
/// 数据由主桌宠页面算好（notebookFor），这里只开关窗口、摆位置、存备份 notebook.json、在后台补算一次。
/// 消息约定见 notebook.html；设计 docs/superpowers/specs/2026-11-08-notebook-design.md
extension App {
    // MARK: 备份（数据目录里的 notebook.json，规则同 friendship.json）

    var notebookFile: URL { root.appendingPathComponent("notebook.json") }

    func saveNotebookFile(_ store: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: store, options: [.sortedKeys]) else { return }
        try? data.write(to: notebookFile, options: .atomic)
    }

    /// 交给 restoreNotebook 的参数：文件里的 JSON 对象，没有 / 坏了就是 null
    func savedNotebookJSON() -> String {
        guard let data = try? Data(contentsOf: notebookFile),
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any],
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    // MARK: 补算（主桌宠页面第一次 init 完、还没补算过时发 notebookBackfill）

    func runNotebookBackfill() {
        guard !notebookBackfilling else { return }
        notebookBackfilling = true
        let root = self.root
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let t0 = Date()
            // 装 CrossPet 那天 = 数据目录建立的时间
            let created = (try? FileManager.default.attributesOfItem(atPath: root.path)[.creationDate] as? Date) ?? Date()
            let files = NotebookScan.scanAll(home: FileManager.default.homeDirectoryForCurrentUser)
            let count = files.reduce(0) { $0 + (($1["events"] as? [Any])?.count ?? 0) }
            let payload: [String: Any] = ["installedAt": Int64(created.timeIntervalSince1970 * 1000), "files": files]
            let json = (try? JSONSerialization.data(withJSONObject: payload)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
            let took = Date().timeIntervalSince(t0)
            DispatchQueue.main.async {
                guard let self else { return }
                self.notebookBackfilling = false
                self.appLog(String(format: "小本子补算：%d 个事件，用时 %.1fs", count, took))
                self.js("applyNotebookBackfill(\(json))")
            }
        }
    }

    // MARK: 窗口

    @objc func openOwnNotebook() {
        guard let id = currentId else { return }
        openNotebook(character: id, near: panel.frame, owner: "main")
    }

    /// owner：谁的右键打开的（"main" 或额外那只的 id）；她走了就收起
    func openNotebook(character: String, near: NSRect, owner: String) {
        closeNotebook(animated: false)
        guard ready else { return }
        let config = WKWebViewConfiguration()
        config.userContentController.add(DevBridge(app: self, kind: .notebook), name: "notebook")
        let p = NotebookPanel(contentRect: NSRect(x: near.maxX, y: near.minY, width: 408, height: 720),
                              styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        p.level = .floating
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.collectionBehavior = panel.collectionBehavior
        let v = WKWebView(frame: p.contentView!.bounds, configuration: config)
        v.setValue(false, forKey: "drawsBackground")
        v.autoresizingMask = [.width, .height]
        v.loadFileURL(root.appendingPathComponent("web/notebook.html"), allowingReadAccessTo: root)
        p.contentView!.addSubview(v)
        notebookPanel = p
        notebookWeb = v
        notebookCharacter = character
        notebookOwner = owner
        notebookNear = near
    }

    /// notebook.html 发来的：ready → 取数据画出来；size → 摆好、显示、翻开；closed → 关窗口
    func handleNotebook(_ body: Any) {
        guard let d = body as? [String: Any], let nv = notebookWeb, let ch = notebookCharacter else { return }
        if d["ready"] as? Bool == true {
            web.evaluateJavaScript("JSON.stringify(notebookFor(\(quote(ch))))") { [weak self, weak nv] r, _ in
                guard let self, let nv, nv === self.notebookWeb, let json = r as? String else { self?.closeNotebook(animated: false); return }
                nv.evaluateJavaScript("render(\(json))", completionHandler: nil)
            }
        }
        if let s = d["size"] as? [String: Any], let w = s["w"] as? Double, let h = s["h"] as? Double, let p = notebookPanel {
            let screen = (NSScreen.screens.first { $0.frame.intersects(notebookNear) } ?? NSScreen.main)?.visibleFrame ?? notebookNear
            p.setFrame(Self.notebookFrame(pet: notebookNear, size: NSSize(width: w, height: h), screen: screen), display: true)
            guard !p.isVisible else { return }
            p.orderFrontRegardless()
            p.makeKey()
            p.makeFirstResponder(nv)
            watchNotebookClicks()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak nv] in nv?.evaluateJavaScript("openBook()", completionHandler: nil) }
        }
        if d["closed"] as? Bool == true { closeNotebook(animated: false) }
    }

    /// 放她右边、上沿对齐她的上沿；右边放不下放左边；再夹进屏幕可用区域（Cocoa 坐标，原点在左下）
    static func notebookFrame(pet: NSRect, size: NSSize, screen: NSRect) -> NSRect {
        var x = pet.maxX - 12
        if x + size.width > screen.maxX { x = pet.minX - size.width + 12 }
        x = min(max(x, screen.minX), screen.maxX - size.width)
        var y = pet.maxY - size.height
        y = min(max(y, screen.minY), screen.maxY - size.height)
        return NSRect(x: x, y: y, width: size.width, height: size.height)
    }

    /// 点面板外面就收起：别的程序（全局监听）和我们自己的别的窗口（本地监听）
    func watchNotebookClicks() {
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown]
        let global = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] _ in self?.closeNotebook() }
        let local = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] e in
            if let self, e.window !== self.notebookPanel { self.closeNotebook() }
            return e
        }
        notebookMonitors = [global, local].compactMap { $0 }
    }

    /// animated：先让页面翻回去（closeBook，翻完发 closed），页面没回 1 秒后也关
    func closeNotebook(animated: Bool = true) {
        guard let p = notebookPanel else { return }
        if animated, p.isVisible, let nv = notebookWeb, !notebookClosing {
            notebookClosing = true
            nv.evaluateJavaScript("closeBook()", completionHandler: nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak p] in
                if let self, let p, p === self.notebookPanel { self.closeNotebook(animated: false) }
            }
            return
        }
        notebookMonitors.forEach { NSEvent.removeMonitor($0) }
        notebookMonitors = []
        notebookWeb?.configuration.userContentController.removeScriptMessageHandler(forName: "notebook")
        notebookWeb?.stopLoading()
        p.orderOut(nil)
        p.close()
        notebookPanel = nil
        notebookWeb = nil
        notebookCharacter = nil
        notebookOwner = nil
        notebookClosing = false
    }
}

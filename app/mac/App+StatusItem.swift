import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 菜单栏图标
    // Mac 版不在程序坞和 ⌘Tab 里：她被别的窗口挡住（显示层级选了「普通窗口」或「跟着 AI」）、
    // 被拖到看不见的地方时，从这里找她。左键：叫到最前面；右键：和桌宠右键一样的菜单（和 Windows 的托盘图标对应）

    func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.autosaveName = "CrossPetStatusItem"   // 记住用户按住 ⌘ 拖到的位置
        if let button = item.button {
            let image = NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: "CrossPet")
            image?.isTemplate = true
            button.image = image
            button.toolTip = "CrossPet：单击把她叫到最前面，右键打开菜单"
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        statusItem = item
    }

    @objc func statusItemClicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            // 临时挂上菜单再「点一下」：菜单从图标正下方弹出，关掉后摘下，免得左键也变成弹菜单
            statusItem?.menu = buildMenu()
            sender.performClick(nil)
            statusItem?.menu = nil
        } else {
            bringToFront()
        }
    }

    /// 叫到最前面：在当前屏幕看不见（被拖出屏幕、换了显示器）就先回到右下角
    @objc func bringToFront() {
        let visible = NSScreen.screens.contains { $0.visibleFrame.intersects(panel.frame.insetBy(dx: 40, dy: 40)) }
        if !visible { resetPosition() }
        userHidden = false
        fullscreenOverride = true; hiddenForFullscreen = false   // 你主动叫她：全屏时也出来（切换空间 / 前台程序后再按规则收起来）
        panel.orderFrontRegardless()
        js("handleClick('pat')")
    }

    @discardableResult
    func add(_ menu: NSMenu, _ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc func pat() { js("handleClick('pat')") }
    @objc func poke() { js("handleClick('poke')") }
    @objc func egg() { js("playEgg(true)") }
    @objc func askReset() { js("askReset()") }

    /// 换衣服（皮肤）：记下来，重新载入立绘；正在显示的就是她的话马上换上
    func wear(_ id: String, _ skin: String) {
        var skins = defaults.dictionary(forKey: "skins") as? [String: String] ?? [:]
        guard (skins[id] ?? "") != skin else { return }
        if skin.isEmpty { skins.removeValue(forKey: id) } else { skins[id] = skin }
        defaults.set(skins, forKey: "skins")
        loadCharacters()
        js("refreshLook(\(quote(id)))")
        pushSettings()   // 设置页开着（角色页的衣服卡）时高亮跟着变：按时段自动换衣服也走这里
    }

    @objc func rename() {
        guard let id = currentId ?? characterIds.first else { return }
        let alert = NSAlert()
        alert.messageText = "给 \(displayNames[id] ?? id) 改名"
        alert.informativeText = "留空则恢复默认名字。"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 220, height: 24))
        field.stringValue = displayNames[id] ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "好")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var names = defaults.dictionary(forKey: "names") as? [String: String] ?? [:]
        let value = field.stringValue.trimmingCharacters(in: .whitespaces)
        if value.isEmpty { names.removeValue(forKey: id) } else { names[id] = value }
        defaults.set(names, forKey: "names")
        loadCharacters()
        js("setName(\(quote(id)), \(quote(displayNames[id] ?? id)))")
    }

    @objc func toggleAntigravityQuota() {
        let on = !defaults.bool(forKey: "agyQuota")
        defaults.set(on, forKey: "agyQuota")
        if on { refreshAntigravityQuota() } else { js("setQuota('gemini', null)") }
    }

    /// 背景光晕：auto（跟着系统深浅色，深色模式下关）/ on / off
    var auraMode: String { defaults.string(forKey: "auraMode") ?? "auto" }
    @objc func setAura(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        defaults.set(mode, forKey: "auraMode")
        js("setAuraMode(\(quote(mode)))")
    }

    @objc func toggleGPTQuota() {
        let on = !defaults.bool(forKey: "gptQuota")
        defaults.set(on, forKey: "gptQuota")
        if on { refreshCodexQuota(.now) } else { js("setCodexQuota(null)") }
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            let alert = NSAlert()
            alert.messageText = "设置失败"
            alert.informativeText = "请把 CrossPet.app 放进「应用程序」文件夹后再试。\n\(error.localizedDescription)"
            alert.runModal()
        }
    }

    @objc func openCharacters() { NSWorkspace.shared.open(charactersDir) }
    @objc func reload() { web.reload() }
    @objc func resetPosition() {
        undock()
        guard let screen = NSScreen.main?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: screen.maxX - panel.frame.width - 40, y: screen.minY + 100))
        defaults.removeObject(forKey: "origin")
    }
}

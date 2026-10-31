import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 快捷键隐藏
    // 全局快捷键（默认 ⌃⌥P）：按一下藏起来，再按一下出来；点菜单栏爪印也能叫出来。藏着时 AI 干活也不出来，重开 App 恢复显示。
    // 用 Carbon 的 RegisterEventHotKey：系统级快捷键，不需要「辅助功能」权限
    static let hotkeyChoices: [(id: String, label: String, key: UInt32)] = [("p", "⌃⌥P", UInt32(kVK_ANSI_P)), ("h", "⌃⌥H", UInt32(kVK_ANSI_H))]
    var hideHotkey: String { defaults.string(forKey: "hideHotkey") ?? "p" }
    var hotkeyLabel: String? { Self.hotkeyChoices.first { $0.id == hideHotkey }?.label }

    func registerHotKey() {
        if let r = hotKeyRef { UnregisterEventHotKey(r); hotKeyRef = nil }
        hotkeyFailed = false
        guard let choice = Self.hotkeyChoices.first(where: { $0.id == hideHotkey }) else { return }
        if !hotKeyHandlerInstalled {
            hotKeyHandlerInstalled = true
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, data in
                guard let data else { return noErr }
                let app = Unmanaged<App>.fromOpaque(data).takeUnretainedValue()
                DispatchQueue.main.async { app.toggleHidden() }
                return noErr
            }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        }
        let id = EventHotKeyID(signature: OSType(0x43505431), id: 1)   // 'CPT1'
        let status = RegisterEventHotKey(choice.key, UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
        hotkeyFailed = status != noErr   // 被别的程序占了
    }

    @objc func toggleHidden() { setUserHidden(!userHidden) }
    func setUserHidden(_ hidden: Bool) {
        userHidden = hidden   // 透明度 / 鼠标 / 动画在 didSet 里处理，不 orderOut（见 applyHiddenState）
        if !hidden {
            fullscreenOverride = true; hiddenForFullscreen = false   // 你主动叫她：全屏时也先出来
            panel.orderFrontRegardless()
            if layerMode == "normal" { orderBelowFrontWindow() }
        }
        syncCompanionWindows()   // 一次全藏 / 全叫出来（主桌宠先排好前后，额外那几只排在她后面）
        updatePageHidden()
    }

}

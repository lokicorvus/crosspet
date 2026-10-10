import Cocoa
import WebKit

@main struct NativePerformanceTests {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let suite = "io.github.crosspet.performance-tests"
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = App()
        app.web = WKWebView(frame: .zero)
        app.setupStatusItem()
        precondition(app.performanceMode == .full, "Unconfigured installation keeps original behavior")
        var oldState: Timer?, oldPointer: Timer?
        for _ in 0..<6 {
            for mode in PerformanceMode.allCases {
                app.handleSettings(["cmd":"set", "key":"performanceMode", "value":mode.rawValue])
                precondition(oldState?.isValid != true && oldPointer?.isValid != true, "Previous timers must be invalidated")
                precondition(app.timer?.timeInterval == mode.stateInterval && app.pointerTimer?.timeInterval == mode.pointerInterval)
                precondition(app.performanceMode == mode && app.settingsState()["performanceMode"] as? String == mode.rawValue)
                let item = app.buildMenu().items.first!
                precondition(item.title == "运行模式：\(mode.title)")
                precondition(item.submenu!.items.filter { $0.state == .on }.count == 1)
                precondition(item.submenu!.items.first { $0.state == .on }!.representedObject as? String == mode.rawValue)
                precondition(app.statusItem!.button!.toolTip!.contains(mode.title))
                oldState = app.timer; oldPointer = app.pointerTimer
            }
        }
        app.handleSettings(["cmd":"set", "key":"performanceMode", "value":"invalid"])
        precondition(app.performanceMode == .full && app.timer === oldState)
        precondition(app.lifecycleHost.isEmpty && app.configureHostLifecycle() && app.hostLifecycle == nil)
        app.lifecycleApplicationLookup = { id in id.hasPrefix("test.host.") ? [NSRunningApplication.current] : [] }
        app.handleSettings(["cmd":"set", "key":"lifecycleHost", "value":"test.host.first"])
        let first = app.hostLifecycle!
        precondition(app.lifecycleHost == "test.host.first" && first.check())
        precondition(App().lifecycleHost == "test.host.first", "Binding choice must persist")
        app.handleSettings(["cmd":"set", "key":"lifecycleHost", "value":"missing.host"])
        precondition(app.hostLifecycle === first && app.lifecycleHost == "test.host.first", "Absent selection must not change the binding")
        app.handleSettings(["cmd":"set", "key":"lifecycleHost", "value":"test.host.second"])
        let second = app.hostLifecycle!
        precondition(!first.check() && second.check(), "Replacing a binding must stop the old observer")
        app.handleSettings(["cmd":"set", "key":"lifecycleHost", "value":""])
        precondition(!second.check() && app.hostLifecycle == nil && app.lifecycleHost.isEmpty)
        precondition(app.settingsState()["lifecycleHost"] as? String == "")
        app.timer?.invalidate(); app.pointerTimer?.invalidate()
        print("PASS: native modes, timers, default unbound lifecycle, binding persistence/replacement/disable, absent selection")
    }
}

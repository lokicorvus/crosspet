import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 跟着 AI 出现
    // 接入的 AI 开始工作时，钩子脚本 / DSH 插件发现桌宠没在跑就把它打开（看 /tmp/crosspet/pet.pid）。
    // 从菜单手动退出 = 这会儿不想看到它：记下 user-quit（看文件修改时间），在那之前就开着的 AI 不再把它拉起来；
    // AI 程序关掉重开、重启电脑后就作废，自己打开桌宠也会清掉。
    // 设置里关掉「AI 开始工作时自动出现」= 写 ai-autostart-off。两个记号都放在 Application Support，重启电脑也不丢。
    var userQuitFlag: URL { root.appendingPathComponent("user-quit") }
    var aiAutostartOffFlag: URL { root.appendingPathComponent("ai-autostart-off") }
    var aiAutostart: Bool { !FileManager.default.fileExists(atPath: aiAutostartOffFlag.path) }
    func setAIAutostart(_ on: Bool) {
        if on { try? FileManager.default.removeItem(at: aiAutostartOffFlag) }
        else { try? Data().write(to: aiAutostartOffFlag) }
    }
    func markLaunched() {
        try? FileManager.default.removeItem(at: userQuitFlag)
        try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
        try? String(ProcessInfo.processInfo.processIdentifier).write(to: stateDir.appendingPathComponent("pet.pid"), atomically: true, encoding: .utf8)
    }
    func applicationWillTerminate(_ note: Notification) {
        try? FileManager.default.removeItem(at: stateDir.appendingPathComponent("pet.pid"))
    }

    /// 菜单里的「退出」：用户主动退出。第一次退出时说一句，让人知道什么时候会再出来
    @objc func quit() {
        try? Data().write(to: userQuitFlag)
        // 挥手道别再走；第一次退出时说明什么时候会再出来，多停一会儿让人看清
        let hint = aiAutostart && !defaults.bool(forKey: "quitHinted")
        if hint { defaults.set(true, forKey: "quitHinted") }
        js(hint ? "farewell('我先走啦～下次重新打开 AI 我再出来', 5000)" : "farewell(null, 2000)")
        companionsJS("farewell(null, \(hint ? 5000 : 2000))")   // 多桌宠：额外那几只也一起挥手、同一时刻走开
        DispatchQueue.main.asyncAfter(deadline: .now() + (hint ? 5 : 2)) { NSApp.terminate(nil) }
    }

}

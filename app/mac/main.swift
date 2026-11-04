import Carbon
import Cocoa
import ServiceManagement
import WebKit

// 往已经退出的子进程（codex app-server）写东西时，系统默认发 SIGPIPE 把整个 App 杀掉：忽略它，写失败只返回错误
signal(SIGPIPE, SIG_IGN)

// 测试用：只问一次 GPT 额度，打印 JSON 就退出（tests/codex_quota_probe.sh）
func probeResult(_ rl: [String: Any]?, _ err: String?, _ ms: Int) -> [String: Any] {
    CodexQuotaSource.payload(source: rl != nil ? "live" : "none", rateLimits: rl, error: rl != nil ? nil : err, ms: ms)
}
if CommandLine.arguments.contains("--codex-quota-probe") {
    let sem = DispatchSemaphore(value: 0); var out: [String: Any] = [:]
    if let bin = CodexQuotaSource.findBinary() {
        // CROSSPET_CODEX_TIMEOUT：测试时把 15 秒超时缩短
        let timeout = Double(ProcessInfo.processInfo.environment["CROSSPET_CODEX_TIMEOUT"] ?? "") ?? 15
        CodexQuotaSource.queryLive(binary: bin, timeout: timeout) { rl, err, ms in
            out = probeResult(rl, err, ms); sem.signal()
        }
        sem.wait()
    } else { out = probeResult(nil, "没找到 codex 程序", 0) }
    let d = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    print(String(decoding: d, as: UTF8.self)); exit(0)
}

// 测试用：定时到点时要不要问 GPT 额度，打印 yes / no 就退出（tests/codex_quota_probe.sh）。参数：离上次问过几秒、离上次干活几秒（-1 = 没有）
if let i = CommandLine.arguments.firstIndex(of: "--codex-tick-probe") {
    let n = CommandLine.arguments.dropFirst(i + 1).compactMap { Double($0) }
    guard n.count == 2 else { print("参数不对"); exit(1) }
    print(App.codexTickDue(since: n[0], busyAgo: n[1] < 0 ? nil : n[1]) ? "yes" : "no"); exit(0)
}

// 测试用：把一份 Antigravity 额度回复排版，打印结果 JSON 就退出（tests/antigravity_quota_probe.sh）
if let i = CommandLine.arguments.firstIndex(of: "--agy-quota-probe") {
    guard i + 1 < CommandLine.arguments.count, let data = FileManager.default.contents(atPath: CommandLine.arguments[i + 1]),
          let obj = try? JSONSerialization.jsonObject(with: data) else { print("null"); exit(1) }
    let q = App.antigravityParse(obj) ?? [:]
    print(String(decoding: try! JSONSerialization.data(withJSONObject: q), as: UTF8.self)); exit(0)
}

// 测试用：算一次「换大小时窗口放在哪」，打印 x y 宽 高 就退出（tests/window_place_probe.sh）
if let i = CommandLine.arguments.firstIndex(of: "--window-place-probe") {
    let a = Array(CommandLine.arguments.dropFirst(i + 1))
    let n = a.dropFirst().compactMap { Double($0) }.map { CGFloat($0) }
    guard let anchor = App.Anchor(rawValue: a.first ?? ""), n.count == 9 else { print("参数不对"); exit(1) }
    let r = App.placeWindow(old: NSRect(x: n[0], y: n[1], width: n[2], height: n[3]), size: NSSize(width: n[4], height: n[5]),
                            oldFoot: n[6], newFoot: n[7], anchor: anchor, visibleMinY: n[8])
    print([r.minX, r.minY, r.width, r.height].map { String(format: "%g", Double($0)) }.joined(separator: " ")); exit(0)
}

// 测试用：额外那几只第一次出现放在哪，每行打印一只的 x y 宽 高就退出（tests/companion_place_probe.sh）。
// 参数：主桌宠 x y 宽 高、几只、每只宽 高、可见区 x y 宽 高
if let i = CommandLine.arguments.firstIndex(of: "--companion-place-probe") {
    let n = CommandLine.arguments.dropFirst(i + 1).compactMap { Double($0) }.map { CGFloat($0) }
    guard n.count == 11 else { print("参数不对"); exit(1) }
    let slots = App.companionSlots(main: NSRect(x: n[0], y: n[1], width: n[2], height: n[3]), count: Int(n[4]),
                                   size: NSSize(width: n[5], height: n[6]), visible: NSRect(x: n[7], y: n[8], width: n[9], height: n[10]))
    for r in slots { print([r.minX, r.minY, r.width, r.height].map { String(format: "%g", Double($0)) }.joined(separator: " ")) }
    exit(0)
}

// 测试用：一只一只放（companionOrigin 的纯计算），参数同上，第 5 个是这一轮一共几只；后面每两个数是第几只记过的位置（-1 -1 = 没记过）
if let i = CommandLine.arguments.firstIndex(of: "--companion-seq-probe") {
    let n = CommandLine.arguments.dropFirst(i + 1).compactMap { Double($0) }.map { CGFloat($0) }
    guard n.count >= 11 else { print("参数不对"); exit(1) }
    let main = NSRect(x: n[0], y: n[1], width: n[2], height: n[3]), size = NSSize(width: n[5], height: n[6])
    let vf = NSRect(x: n[7], y: n[8], width: n[9], height: n[10]), total = Int(n[4])
    var placed: [NSRect] = []
    for k in 0..<total {
        let j = 11 + 2 * k
        let saved = j + 1 < n.count && n[j] >= 0 ? NSRect(x: n[j], y: n[j + 1], width: size.width, height: size.height) : nil
        let r = App.companionPick(main: main, others: placed, saved: saved, total: total, size: size, visible: vf)
        placed.append(r)
        print([r.minX, r.minY, r.width, r.height].map { String(format: "%g", Double($0)) }.joined(separator: " "))
    }
    exit(0)
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

/// 只信任本机 127.0.0.1 的自签名证书（Antigravity 后台服务用的是自签名 HTTPS）

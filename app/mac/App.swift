import Carbon
import Cocoa
import ServiceManagement
import WebKit

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var panel: NSPanel!
    var web: WKWebView!
    var timer: Timer?
    var quotaTimer: Timer?
    var followEventGeneration: UInt64 = 0
    var ready = false {
        didSet { if ready != oldValue { followEventGeneration &+= 1 } }
    }
    var currentId: String? {
        didSet { followEventGeneration &+= 1 }   // 同 id 的手动选择也要让旧事件答复失效。
    }

    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("CrossPet", isDirectory: true)
    var charactersDir: URL { root.appendingPathComponent("characters") }

    var characterIds: [String] = []           // 可切换的角色（不含彩蛋）
    var skinChoices: [String: [(id: String, name: String)]] = [:]   // 角色 → 可换的衣服（皮肤）
    var baseOutfit: [String: String] = [:]   // 原版衣服叫什么（character.json 的 outfit，比如「女仆装」）
    var displayNames: [String: String] = [:]  // id → 显示名（含用户改的名）
    var appToCharacter: [String: String] = [:]
    var stamps: [String: Date] = [:]
    var pendingSwitch: DispatchWorkItem?
    var latestRelease: (tag: String, url: URL)?
    var manifestJSON = "{}"                    // 最近一次发给桌宠的角色清单，开发者控制台也要用
    var devWindow: NSWindow?
    var devWeb: WKWebView?
    var settingsWindow: NSWindow?
    var settingsWeb: WKWebView?
    var pendingSettingsTab: String?   // 设置窗口加载完后切到哪个标签页（从「新功能」卡片打开时是 news）
    var feedbackWindow: NSWindow?
    var feedbackWeb: WKWebView?
    var defaultNames: [String: String] = [:]   // id → character.json 里的原名（设置页显示占位用）
    var pauseRealEvents = false {              // 控制台里测试时，先不让真实 AI 的状态打扰桌宠
        didSet { if pauseRealEvents != oldValue { followEventGeneration &+= 1 } }
    }


    // 更新 用的
    let repoSlug = "lokicorvus/crosspet"
    var lastUpdateCheck = "还没查过"
    var updating = false

    // GPT 额度 用的
    var codexLiveAt = Date.distantPast       // 上次问服务的时间（不管成没成）
    var codexBusyAt: Date?   // Codex 最近一次干活的事件（不是 Stop）；Stop 后清掉。干活时额度查得勤一点
    var codexInFlight = false
    var codexLast: (rateLimits: [String: Any], at: Date)?   // 最后一次问到的额度：问不到时接着显示它，并标上时间
    var codexNote = ""                       // 从没问到过时的原因，设置里那个开关下面显示
    var lastGptQuota = "还没读过"

    // Gemini 额度 用的
    var agySession: URLSession?
    var agyPort: (pid: Int32, port: Int)?

    // 快捷键隐藏 用的
    var userHidden = false {
        didSet { if userHidden != oldValue { applyHiddenState() } }   // 快捷键藏起来：和全屏时收着一样，只是透明
    }
    var hotKeyRef: EventHotKeyRef?
    var hotKeyHandlerInstalled = false
    var hotkeyFailed = false

    // 菜单栏图标 用的
    var statusItem: NSStatusItem?

    // 显示层级 用的
    var lastPose: [String: (pose: String, at: Date)] = [:]   // 各角色最近一次状态（判断 AI 在不在干活）

    // 贴边 用的
    var dock: String?            // "left" / "right"
    var dockOut = false          // 跑出来了
    var dockHover = false
    var dockLeaveAt: Date?
    var dockedAt = Date.distantPast   // 刚拖到边上：之前就在进行的工作不算，先缩进去给个反应，AI 有新动作再跑出来
    var screensAsleep = false
    var wasAway = false
    var dockTucked = false   // 现在是缩着的样子（之后换探出来不用先挪窗口）
    var dockCut: [String: Double] = [:]   // 切口位置（网页像素），按 边 + 角色 记
    var dockEnterAt: Date?

    // 点击穿透 用的
    var hitRects: [CGRect] = []
    var hitRectsAt = Date.distantPast
    var hiddenForFullscreen = false {
        didSet { if hiddenForFullscreen != oldValue { applyHiddenState() } }   // 透明度 / 鼠标 / 动画都跟着这个标记走
    }
    var fullscreenCheckedAt = Date.distantPast
    var fullscreenOverride = false   // 全屏时你点菜单栏图标叫她出来：切换空间 / 前台程序之前不再收起来

    // 设置 用的
    var scaleTimer: Timer?
    var shownScale: CGFloat = 0
    // 文字大小：网页按「人物大小、文字大小」算出的画布（网页 CSS 尺寸），窗口 = 画布 × 人物大小（app/web/text-size.js）
    var pageSize = NSSize(width: 260, height: 362)
    var pageFoot: CGFloat = 62    // 画布底栏高（名牌 + 额度），改文字大小时按它的变化挪窗口，人物不动
    var shownFootPt: CGFloat = 0  // 窗口现在的底栏在屏幕上多高（点）；0 = 还没按画布设过

    // 接入 AI 用的
    var integrated: [String]?
    var pluginStatus = "[]"      // 插件版本（接入工具的只读检查 integrate.py plugins，JSON 数组），桌宠和设置页据此提醒更新

    // 接入被别的工具冲掉时接回去 用的
    var claudeConfigStamp: Date?
    var healTimes: [Date] = []
    var healPending: DispatchWorkItem?
    lazy var pythonReady: Bool = {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
        p.arguments = ["-p"]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 } catch { return false }
    }()

    // 反馈问题 用的
    let launchedAt = Date()
    var diagText = ""   // 接入工具的诊断（integrate.py diagnose），反馈窗口打开时跑一次

    // MARK: 启动

    func applicationDidFinishLaunching(_ note: Notification) {
        syncBundledResources()
        markLaunched()

        let size = NSSize(width: Self.baseSize.width * petScale, height: Self.baseSize.height * petScale)
        var origin = NSPoint.zero
        if let saved = defaults.array(forKey: "origin") as? [Double], saved.count == 2 {
            origin = NSPoint(x: saved[0], y: saved[1])
        } else if let screen = NSScreen.main?.visibleFrame {
            origin = NSPoint(x: screen.maxX - size.width - 40, y: screen.minY + 100)
        }
        panel = NSPanel(contentRect: NSRect(origin: origin, size: size),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = layerMode == "normal" ? .normal : .floating
        panel.hidesOnDeactivate = false
        applyFullscreenBehavior()

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        let petConfig = WKWebViewConfiguration()
        petConfig.userContentController.add(DevBridge(app: self, kind: .pet), name: "pet")   // 桌宠页面 → App（「新功能」卡片的「去看看」）
        web = WKWebView(frame: container.bounds, configuration: petConfig)
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.pageZoom = petScale
        web.loadFileURL(root.appendingPathComponent("web/index.html"), allowingReadAccessTo: root)
        container.addSubview(web)

        let drag = DragView(frame: container.bounds)
        drag.autoresizingMask = [.width, .height]
        // 点的位置换成网页坐标（CSS 像素：除掉人物大小的缩放，y 轴翻过来）
        drag.onClick = { [weak self, weak drag] p in
            guard let self, let drag else { return }
            let z = max(self.web.pageZoom, 0.01)
            self.js(String(format: "handleClick('pat', %.1f, %.1f)", p.x / z, (drag.bounds.height - p.y) / z))
        }
        drag.onMenu = { [weak self] e in self?.showMenu(e, in: drag) }
        drag.onDragStart = { [weak self] in self?.undock() }
        drag.onDragEnd = { [weak self] in self?.checkDock() }
        drag.onShake = { [weak self] in self?.js("shaken()") }
        container.addSubview(drag)

        panel.contentView = container
        panel.orderFrontRegardless()
        setupStatusItem()
        registerHotKey()

        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(appActivated(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(spaceChanged(_:)),
            name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        // 看不见时停动画：窗口被完全挡住、屏幕休眠、锁屏（锁屏时会话失活）
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: panel, queue: .main) { [weak self] _ in self?.updatePageHidden() }
        let ws = NSWorkspace.shared.notificationCenter
        for (name, asleep) in [(NSWorkspace.screensDidSleepNotification, true), (NSWorkspace.screensDidWakeNotification, false),
                               (NSWorkspace.sessionDidResignActiveNotification, true), (NSWorkspace.sessionDidBecomeActiveNotification, false)] {
            ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.screensAsleep = asleep; self?.updatePageHidden() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.pollStates() }
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.updateClickThrough() }
        quotaTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshCodexQuota(.tick); self?.refreshAntigravityQuota() }
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.watchClaudeConfig() }
        // 检查更新：启动后 20 秒、之后每 3 小时，电脑从睡眠中醒来时也查一次（很多人的电脑一直不关机，只是合盖）
        Timer.scheduledTimer(withTimeInterval: 3 * 3600, repeats: true) { [weak self] _ in self?.checkForUpdate(manual: false) }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self?.checkForUpdate(manual: false) }   // 等网络连上
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.checkForUpdate(manual: false) }
    }

    // MARK: 工具

    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

}

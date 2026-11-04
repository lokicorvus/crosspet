import Carbon
import Cocoa
import ServiceManagement
import WebKit

/// 桌宠窗口（主桌宠、额外那只）：不让系统把窗口上沿按在菜单栏下面。窗口上面一截是透明的（留给气泡、名牌），
/// 按系统的规矩她的头够不到屏幕顶端；拖动时由 DragView 自己限制（看得见的最上面那块最多到菜单栏下沿）
final class PetPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class DragView: NSView {
    var onClick: ((NSPoint) -> Void)?   // 点在哪（这个视图的坐标）：网页要知道是不是点在「新功能」卡片的按钮上
    var onMenu: ((NSEvent) -> Void)?
    var onDragStart: (() -> Void)?
    var onDragEnd: (() -> Void)?
    var onShake: (() -> Void)?        // 按住快速来回甩（惹她生气）
    var topRoom: (() -> CGFloat)?     // 窗口上沿到看得见的最上面那块（气泡 / 头顶）空着多少点：拖到顶时可以伸出屏幕这么多
    var originKey = "origin"          // 松手时位置记在哪：主桌宠 origin，额外那只 origin-<角色>@<客户端>
    private var shook = false          // 这次拖动甩过：松手不贴边
    private var swingX: CGFloat = 0, swingDir: CGFloat = 0, swings: [Date] = [], shakeSaid = Date.distantPast
    private var downAt: NSPoint = .zero
    private var originAt: NSPoint = .zero
    private var dragged = false

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        dragged = false
    }
    override func mouseDragged(with event: NSEvent) {
        let p = NSEvent.mouseLocation
        if !dragged {
            guard abs(p.x - downAt.x) + abs(p.y - downAt.y) > 3 else { return }
            dragged = true
            onDragStart?()
            originAt = window?.frame.origin ?? .zero
            downAt = p
            shook = false; swingX = p.x; swingDir = 0; swings = []
        }
        // 甩：横向来回反转方向。记住这个方向上拖到的最远点，从那里往回拖超过 18 点算一次反转，0.9 秒内反转两次以上就算在甩
        if swingDir == 0 {
            if abs(p.x - swingX) > 18 { swingDir = p.x > swingX ? 1 : -1; swingX = p.x }
        } else if (p.x - swingX) * swingDir > 0 {
            swingX = p.x   // 同方向继续拖：更新最远点
        } else if (swingX - p.x) * swingDir > 18 {
            swingDir = -swingDir; swingX = p.x
            swings.append(Date())
            swings = swings.filter { Date().timeIntervalSince($0) < 0.9 }
            if swings.count >= 2, Date().timeIntervalSince(shakeSaid) > 0.3 { shook = true; shakeSaid = Date(); onShake?() }
        }
        // 自己跟着鼠标挪（不用 performDrag 交给系统：macOS 15 起系统拖到屏幕边缘会弹「窗口分屏」预览、松手还会去动窗口，跟贴边抢位置）
        guard let window else { return }
        var o = NSPoint(x: originAt.x + p.x - downAt.x, y: originAt.y + p.y - downAt.y)
        if let vf = (NSScreen.screens.first { $0.frame.contains(p) } ?? window.screen)?.visibleFrame {
            o.y = min(o.y, vf.maxY - window.frame.height + max(0, topRoom?() ?? 0))
        }
        window.setFrameOrigin(o)
    }
    override func mouseUp(with event: NSEvent) {
        if dragged {
            if let o = window?.frame.origin { defaults.set([o.x, o.y], forKey: originKey) }
            if !shook { onDragEnd?() }   // 甩她的时候松手不贴边
        } else {
            onClick?(convert(event.locationInWindow, from: nil))
        }
    }
    override func rightMouseDown(with event: NSEvent) { onMenu?(event) }
}

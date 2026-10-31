import Carbon
import Cocoa
import ServiceManagement
import WebKit

final class LocalhostTrust: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async
        -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        if challenge.protectionSpace.host == "127.0.0.1", let trust = challenge.protectionSpace.serverTrust {
            return (.useCredential, URLCredential(trust: trust))
        }
        return (.performDefaultHandling, nil)
    }
}

/// 控制台页面 → App 的消息通道（单独一个对象，避免 WKUserContentController 强引用 App 造成循环）
final class DevBridge: NSObject, WKScriptMessageHandler {
    enum Kind { case dev, settings, feedback, pet, companion }
    weak var app: App?
    weak var companion: Companion?   // kind 是 companion 时：消息是哪只额外桌宠的页面发来的
    let kind: Kind
    init(app: App, kind: Kind) { self.app = app; self.kind = kind }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        switch kind {
        case .dev: app?.handleDev(message.body)
        case .settings: app?.handleSettings(message.body)
        case .feedback: app?.handleFeedback(message.body)
        case .pet: app?.handlePet(message.body)
        case .companion: companion?.handleMessage(message.body)
        }
    }
}

import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 状态与额度

    /// 读 /tmp/crosspet/<id>-state.json 和 <id>-quota.json，有变化就交给画面。
    func pollStates() {
        guard ready else { return }
        var latestActive: (id: String?, ts: Double) = (nil, 0)
        // current：多模型宿主（WorkBuddy）里没有对应角色的模型，由当前角色来演；它只有状态，没有额度
        for id in characterIds + ["current"] {
            // sessions：同一个 AI 好几个对话同时干活时，每个对话各自的状态（演「手忙脚乱」用）
            for kind in ["state", "quota", "sessions"] where !(id == "current" && kind == "quota") && !(id == "deepseek" && kind == "quota" && !dsQuotaEnabled) {
                let url = stateDir.appendingPathComponent("\(id)-\(kind).json")
                let key = "\(id)-\(kind)"
                guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                      let stamp = attrs[.modificationDate] as? Date, stamp != stamps[key] else { continue }
                stamps[key] = stamp
                // 状态只认 10 分钟内的，免得开机读到旧状态
                if kind == "state", Date().timeIntervalSince(stamp) > 600 { notePet(id, nil, "skipped", "stale"); continue }
                guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { continue }
                if kind == "state", let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let pose = state["pose"] as? String {
                    lastPose[id] = (pose, stamp)
                    // 终端里的 AI 没有独立的前台 App：跟随最近一条正在工作的事件。
                    if id != "current", pose != "idle", pose != "sleeping",
                       let ts = state["ts"] as? Double, Date().timeIntervalSince1970 - ts < 30, ts > latestActive.ts {
                        latestActive = (id, ts)
                    }
                }
                if kind == "sessions" { if !pauseRealEvents { js("setSessions(\(quote(id)), \(text))") }; continue }
                devJS("logEvent(\(quote(id)), \(quote(kind)), \(text), \(pauseRealEvents))")
                let parsed = kind == "state" ? (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] : nil
                if pauseRealEvents { if kind == "state" { notePet(id, parsed, "skipped", "paused") }; continue }
                if kind == "state" { notePet(id, parsed, "played") }   // 交给网页了；网页自己的判断（不是当前角色、正在演彩蛋……）在 diagnoseDisplay 里
                js(kind == "state" ? "applyCharState(\(quote(id)), \(text))" : "setQuota(\(quote(id)), \(text))")
                // Codex 回完一轮：额度记录刚写进会话，马上读一次（不然要等每分钟一次的定时刷新）
                if kind == "state", id == "gpt" {
                    if text.contains("\"event\": \"Stop\"") || text.contains("\"event\":\"Stop\"") {
                        codexBusyAt = nil
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.refreshCodexQuota(.turnEnd) }
                    } else { codexBusyAt = stamp }   // 在干活：定时查额度改成 1 分钟一次（codexTickDue）
                }
            }
        }
        // 同角色的新事件也必须撤销更早的异步答复，否则旧请求可能把她切回另一个角色。
        if let id = latestActive.id { followEvent(id) }
        applyLayer()
        updateDock()
        // 多模型宿主（DeepSeek Harness、WorkBuddy、ZCode，以及接了别家接口的 Claude Code、Codex）正在前台、
        // 里面换了模型：马上换成那个模型的角色
        for host in ["deepseek", "workbuddy", "zcode", "claude", "gpt", "qwen", "cursor"] {
            let url = stateDir.appendingPathComponent("\(host)-host.json")
            guard let stamp = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date,
                  stamp != stamps["\(host)-host"] else { continue }
            stamps["\(host)-host"] = stamp
            guard followApps, !pauseRealEvents, let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                  (appToCharacter[front] ?? hostApp(front)) == host else { continue }
            let id = hostCharacter(host)
            if id != currentId, characterIds.contains(id) { switchTo(id, why: "host", via: host) }
        }
    }

    /// 两端使用网页层同一份优先级；这里只采集前台程序及设置并执行结果。
    func followEvent(_ id: String) {
        followEventGeneration &+= 1
        let generation = followEventGeneration
        guard ready, !pauseRealEvents, followEvents, id != currentId else { return }
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let host = front.flatMap { appToCharacter[$0] ?? hostApp($0) }
        let foregroundId = host.map { hostCharacter($0) }
        let currentAt = currentId, apps = followApps, events = followEvents
        let input: [String: Any] = ["eventId": id, "foregroundId": foregroundId as Any? ?? NSNull(),
                                    "followApps": apps, "followEvents": events, "characters": characterIds]
        guard let data = try? JSONSerialization.data(withJSONObject: input), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("FollowPolicy.eventTarget(\(json))") { [weak self] result, _ in
            // 和 Windows 一致：更新的事件、页面或选择已经到来时，旧答复不能再覆盖它。
            guard let self else { return }
            guard self.followEventGeneration == generation, self.ready, !self.web.isLoading,
                  !self.pauseRealEvents, self.currentId == currentAt,
                  NSWorkspace.shared.frontmostApplication?.bundleIdentifier == front,
                  self.followApps == apps, self.followEvents == events else { self.notePet(id, nil, "skipped", "answer-stale"); return }
            let currentHost = front.flatMap { self.appToCharacter[$0] ?? self.hostApp($0) }
            guard currentHost == host, currentHost.map({ self.hostCharacter($0) }) == foregroundId,
                  self.characterIds.contains(id) else { self.notePet(id, nil, "skipped", "answer-stale"); return }
            guard result as? String == id else { self.notePet(id, nil, "skipped", "front-ai"); return }
            guard id != self.currentId else { return }
            self.switchTo(id, why: "event")
        }
    }

}

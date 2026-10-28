import Foundation

extension App {
    // MARK: 运行日志
    // ~/Library/Logs/CrossPet.log：和 Windows 的 windows.log 同一种写法（一行一条带时间，超过 1 MB 删掉重来）。
    // 反馈时按问题类型筛出相关的几十行（规则在 web/feedback-plan.js）。只记开关、时间和出错原因，不记对话
    static let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/CrossPet.log")
    static let logQueue = DispatchQueue(label: "crosspet.log")

    func appLog(_ text: String) {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let line = "\(f.string(from: Date())) \(text)\n"
        Self.logQueue.async {
            let url = Self.logURL, fm = FileManager.default
            if let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? Int, size > 1_000_000 { try? fm.removeItem(at: url) }
            if let h = try? FileHandle(forWritingTo: url) { _ = try? h.seekToEnd(); try? h.write(contentsOf: Data(line.utf8)); try? h.close() }   // 出错不抛 ObjC 异常（见 Ledger）
            else { try? Data(line.utf8).write(to: url) }
        }
    }

    /// 钩子事件记录、桌宠处理记录所在的文件夹（数据目录 events/）。启动时建好：Claude Code 的 mod 只能写文件、不能建文件夹
    var eventsDir: URL { root.appendingPathComponent("events", isDirectory: true) }
    var petEventsURL: URL { eventsDir.appendingPathComponent("pet.jsonl") }
    var switchesURL: URL { root.appendingPathComponent("switches.jsonl") }

    func notePet(_ id: String, _ state: [String: Any]?, _ result: String, _ detail: String = "") {
        Ledger.append(petEventsURL, ["char": id, "ev": state?["event"] as? String ?? "", "pose": state?["pose"] as? String ?? "",
                                     "result": result, "detail": detail])
    }
}

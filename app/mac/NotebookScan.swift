import Foundation

/// 小本子补算：从各 AI 程序在本机的对话记录里抽「精简事件」，只读时间和模型名，不读、不留对话内容。
/// 格式见 app/web/notebook-backfill.js：{ t, k: "p" } 你发了一句、{ t, k: "a", m } 她回了一句、{ t, k: "r", m, end } 一整轮（Codex）。
/// 规则 Windows 的 NotebookScan.cs 照抄，夹具 tests/fixtures/notebook 两边共用。只依赖 Foundation。
enum NotebookScan {
    // MARK: 一行一行读（大文件分块读，不整个读进内存）

    static func eachLine(_ url: URL, _ body: (Data) -> Void) {
        guard let h = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? h.close() }
        var buf = Data()
        while true {
            let chunk = h.readData(ofLength: 1 << 20)
            if chunk.isEmpty { break }
            buf.append(chunk)
            var start = buf.startIndex
            while let nl = buf[start...].firstIndex(of: 0x0A) {
                body(buf[start..<nl])
                start = buf.index(after: nl)
            }
            buf = Data(buf[start...])
        }
        if !buf.isEmpty { body(buf) }
    }

    static func lines(_ text: String) -> [Data] {
        text.split(separator: "\n", omittingEmptySubsequences: true).map { Data($0.utf8) }
    }

    static func object(_ line: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: line)) as? [String: Any]
    }

    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let iso = ISO8601DateFormatter()
    static func millis(_ s: Any?) -> Int64? {
        guard let s = s as? String, let d = isoFrac.date(from: s) ?? iso.date(from: s) else { return nil }
        return Int64((d.timeIntervalSince1970 * 1000).rounded())
    }

    // MARK: Claude Code：~/.claude/projects/<项目>/<会话>.jsonl

    /// 你发的一句：文字（不以 < 开头，那是命令、系统插进来的）；只有工具结果的不算。她回的一句：带模型名、不是 <synthetic>
    static func claudeEvent(_ d: [String: Any]) -> [String: Any]? {
        if d["isSidechain"] as? Bool == true || d["isMeta"] as? Bool == true { return nil }
        guard let t = millis(d["timestamp"]), let msg = d["message"] as? [String: Any] else { return nil }
        switch d["type"] as? String {
        case "user":
            if let s = msg["content"] as? String { return s.hasPrefix("<") ? nil : ["t": t, "k": "p"] }
            guard let parts = msg["content"] as? [[String: Any]] else { return nil }
            if parts.contains(where: { $0["type"] as? String == "tool_result" }) { return nil }
            let texts = parts.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }
            return texts.contains(where: { !$0.hasPrefix("<") }) ? ["t": t, "k": "p"] : nil
        case "assistant":
            guard let m = msg["model"] as? String, !m.isEmpty, m != "<synthetic>" else { return nil }
            return ["t": t, "k": "a", "m": m]
        default:
            return nil
        }
    }

    // 先按字节粗筛再解析 JSON：工具结果那几行又多又大，解析它们占了大半时间（实测 6 万多条记录 26 秒）
    private static let userTag = Data("\"type\":\"user\"".utf8), assistantTag = Data("\"type\":\"assistant\"".utf8)
    private static let toolResultTag = Data("\"tool_result\"".utf8)
    static func claudeWanted(_ line: Data) -> Bool {
        if line.range(of: assistantTag) != nil { return true }
        return line.range(of: userTag) != nil && line.range(of: toolResultTag) == nil
    }

    static func claudeEvents(_ lines: [Data]) -> [[String: Any]] {
        lines.compactMap { claudeWanted($0) ? object($0).flatMap(claudeEvent) : nil }
    }

    // MARK: Codex：~/.codex/sessions/**/*.jsonl

    /// turn_context 记下模型；task_complete / turn_aborted（被打断也算一轮）带 duration_ms 的是一整轮
    static func codexEvents(_ lines: [Data]) -> [[String: Any]] {
        var model = ""
        var out: [[String: Any]] = []
        for line in lines {
            guard let d = object(line), let p = d["payload"] as? [String: Any] else { continue }
            let type = d["type"] as? String
            if type == "turn_context" { if let m = p["model"] as? String { model = m }; continue }
            guard type == "event_msg", let pt = p["type"] as? String, pt == "task_complete" || pt == "turn_aborted",
                  let end = millis(d["timestamp"]), let dur = (p["duration_ms"] as? NSNumber)?.int64Value else { continue }
            out.append(["t": end - dur, "k": "r", "m": model, "end": end])
        }
        return out
    }

    // MARK: 全部

    static func jsonlFiles(_ dir: URL, recursive: Bool) -> [URL] {
        let fm = FileManager.default
        var out: [URL] = []
        if recursive {
            guard let e = fm.enumerator(at: dir, includingPropertiesForKeys: nil) else { return [] }
            for case let u as URL in e where u.pathExtension == "jsonl" { out.append(u) }
        } else {
            // projects/<项目>/<会话>.jsonl：只两层，不进子文件夹（子代理的记录在里面）
            for p in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] {
                for u in (try? fm.contentsOfDirectory(at: p, includingPropertiesForKeys: nil)) ?? [] where u.pathExtension == "jsonl" { out.append(u) }
            }
        }
        return out.sorted { $0.path < $1.path }
    }

    static func read(_ files: [URL], _ parse: ([Data]) -> [[String: Any]]) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for f in files {
            var ls: [Data] = []
            eachLine(f) { ls.append($0) }
            out += parse(ls)
        }
        return out
    }

    /// [{ source, events }]。$CLAUDE_CONFIG_DIR / $CODEX_HOME 设了就用它，没设用 home 下的 .claude / .codex；文件夹不存在就是空的
    static func scanAll(home: URL, env: [String: String] = ProcessInfo.processInfo.environment) -> [[String: Any]] {
        let claude = env["CLAUDE_CONFIG_DIR"].map { URL(fileURLWithPath: $0) } ?? home.appendingPathComponent(".claude")
        let codex = env["CODEX_HOME"].map { URL(fileURLWithPath: $0) } ?? home.appendingPathComponent(".codex")
        return [
            ["source": "claude-code", "events": read(jsonlFiles(claude.appendingPathComponent("projects"), recursive: false), claudeEvents)],
            ["source": "codex", "events": read(jsonlFiles(codex.appendingPathComponent("sessions"), recursive: true), codexEvents)],
        ]
    }
}

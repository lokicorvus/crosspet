import Cocoa
import WebKit

extension App {
    // MARK: 多桌宠（设置「几个 AI 各显示一只」，默认关）
    // 谁站着、谁走全在主桌宠页面判（app/web/companions.js）；外壳只做系统那一块：
    //   - 按页面交来的 companions 列表开 / 关额外桌宠的窗口（Companion.swift，同一个进程、同一套网页）
    //   - 把 <角色>@<客户端>-state.json、按客户端过滤的会话、额度转给对应的那只，前台程序、在跑的 AI 程序告诉主桌宠页面
    // 开关关着、也没在集合时：不读 @ 状态文件、不发前台 / 在跑的程序，行为和以前一样。
    // 页面 ↔ 外壳的接口见 .superpowers/sdd/2026-10-31-multi-pets/shell-contract.md；Windows 版（Pet.Companions.cs）照同一份做

    var multiPetsOn: Bool { defaults.bool(forKey: "multiPets") }
    var petsRest: String { let r = defaults.string(forKey: "petsRest"); return r == "stay" || r == "open" ? r! : "auto" }
    /// 固定主桌宠：""= 跟着规则换；存的角色已经不在了也当没固定
    var mainPet: String {
        let v = defaults.string(forKey: "mainPet") ?? ""
        return characterIds.contains(v) ? v : ""
    }
    /// 要不要转发：开关开着，或者正集合着（集合不受开关限制）
    var companionsForwarding: Bool { multiPetsOn || pageGathering }

    static let claudeDesktopBundle = "com.anthropic.claudefordesktop"
    /// 算「终端」的程序（设计第二节「什么算在 AI 软件里」）：终端里看不出跑的是谁，由页面按最近有没有命令行客户端干过活判断
    static let terminalBundles: Set<String> = ["com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty",
                                               "com.github.wez.wezterm", "net.kovidgoyal.kitty", "org.alacritty", "com.microsoft.VSCode"]

    // MARK: 第一次出现放在哪

    /// 窗口最上面这一截是给气泡留的空白（画布 362 里的 59；字放大时这一截占得只会更多），人物不在里面
    static let bubbleShare: CGFloat = 59.0 / 362.0
    /// 窗口去掉顶上气泡那截：人物和名牌、额度所在的部分（y 向上，去掉的是上边）
    static func body(_ r: NSRect, tuck: CGFloat? = nil) -> NSRect {
        NSRect(x: r.minX, y: r.minY, width: r.width, height: r.height - (tuck ?? r.height * bubbleShare))
    }
    /// 窗口左右两边各有一截透明边（画布比人物、名牌、额度条都宽）：排不下时左右相邻的窗口可以压着这截排。
    /// 量过（11-03）：人物左右各空 15%–19%，最宽的 Grok（斧头）一边只空 4.5%；两只相对的两边加起来都够 13%
    static let sideShare: CGFloat = 0.065
    /// 比重叠用的部分：去掉气泡空白、再去掉左右两截透明边
    static func core(_ r: NSRect) -> NSRect { body(r).insetBy(dx: r.width * sideShare, dy: 0) }

    /// 纯计算（tests/companion_place_probe.sh 测），屏幕点、y 向上：count 只额外桌宠各放哪。
    /// 先排主桌宠左边（由近到远），左边放不下放右边，再放不下往上一排（上面的排里主桌宠正上方先放），还不够往下一排；
    /// 每个格子都整个在 visible 里、两两不重叠、不压着主桌宠。
    /// 整窗口排不下（比如笔记本屏幕只放得下一排）：上下两排改成压着下面那排顶上的气泡空白排，人物照样不重叠；
    /// 还不够，左右相邻的再压着两边的透明边排（11-03：笔记本上主桌宠在中间时左边 618 点放两列差 2 点，第 5、6 只叠到了前面那只上），再不够才叠着放。
    /// 格子不够（屏幕太小）时剩下的叠在已有的格子上，照样夹在 visible 里
    static func companionSlots(main: NSRect, count: Int, size: NSSize, visible vf: NSRect) -> [NSRect] {
        guard count > 0, size.width > 0, size.height > 0 else { return [] }
        let w = size.width, h = size.height
        let fits = { (r: NSRect) in r.minX >= vf.minX - 0.01 && r.maxX <= vf.maxX + 0.01 && r.minY >= vf.minY - 0.01 && r.maxY <= vf.maxY + 0.01 }
        let y0 = min(max(main.minY, vf.minY), max(vf.minY, vf.maxY - h))   // 第一排和主桌宠底边对齐（主桌宠藏出屏幕时夹回来）
        // 每排的格子：同一排里左右相邻不重叠（右边从主桌宠和格子里较宽的那个之后开始）；
        // tuck：上下排可以压着的那截（0 = 整窗口不重叠）。往上一排压着第一排和主桌宠的气泡空白，主桌宠正上方那格才不压着她
        // side：左右相邻压着的那截（0 = 不压）
        var side: CGFloat = 0
        func row(_ y: CGFloat, center: Bool) -> [NSRect] {
            var out: [NSRect] = []
            if center { out.append(NSRect(x: main.minX, y: y, width: w, height: h)) }
            var x = main.minX - w + side
            while x >= vf.minX - 0.01 { out.append(NSRect(x: x, y: y, width: w, height: h)); x -= w - side }
            x = main.minX + max(w, main.width) - side
            while x + w <= vf.maxX + 0.01 { out.append(NSRect(x: x, y: y, width: w, height: h)); x += w - side }
            return out
        }
        func keep(_ cands: [NSRect], tuck: CGFloat) -> [NSRect] {
            let mainBody = body(main, tuck: tuck > 0 ? main.height * bubbleShare : 0).insetBy(dx: side / 2, dy: 0)
            return cands.filter { fits($0) && !body($0, tuck: tuck).insetBy(dx: 0.5 + side / 2, dy: 0.5).intersects(mainBody) }
        }
        // 第一排和主桌宠底边对齐，往上、往下各排几排
        func layout(tuck: CGFloat) -> [NSRect] {
            let mainTuck = tuck > 0 ? main.height * bubbleShare : 0, pitch = h - tuck
            var cands = row(y0, center: false)
            var y = max(y0 + pitch, main.minY + main.height - mainTuck)
            while y + h <= vf.maxY + 0.01 { cands += row(y, center: true); y += pitch }
            y = y0 - pitch
            while y >= vf.minY - 0.01 { cands += row(y, center: true); y -= pitch }
            return keep(cands, tuck: tuck)
        }
        // 主桌宠在屏幕中间时，和她对齐往上、往下都差一点排不下第二排：改成从屏幕底边（或顶边）开始一排一排排，
        // 压着主桌宠的格子去掉（11-02：以前这时后几只错开叠在前几只上）
        func grid(tuck: CGFloat, fromTop: Bool) -> [NSRect] {
            let pitch = h - tuck
            var cands: [NSRect] = [], y = fromTop ? vf.maxY - h : vf.minY
            while y >= vf.minY - 0.01 && y + h <= vf.maxY + 0.01 {
                cands += row(y, center: true)
                y += fromTop ? -pitch : pitch
            }
            return keep(cands, tuck: tuck)
        }
        let tight = h * bubbleShare
        var cands = layout(tuck: 0)
        for s in [0, w * 2 * sideShare] {
            side = s
            for next in [{ layout(tuck: 0) }, { layout(tuck: tight) }, { grid(tuck: 0, fromTop: false) }, { grid(tuck: tight, fromTop: false) },
                         { grid(tuck: 0, fromTop: true) }, { grid(tuck: tight, fromTop: true) }] where cands.count < count {
                let more = next()
                if more.count > cands.count { cands = more }
            }
        }
        var out = Array(cands.prefix(count))
        // 放不下了：在已有的格子上错开一点叠着放（躲不开重叠），夹在可见区里
        let clamp = { (r: NSRect) -> NSRect in
            NSRect(x: min(max(r.minX, vf.minX), max(vf.minX, vf.maxX - w)), y: min(max(r.minY, vf.minY), max(vf.minY, vf.maxY - h)), width: w, height: h)
        }
        var i = 0
        while out.count < count {
            let base = cands.isEmpty ? NSRect(x: main.minX - w, y: y0, width: w, height: h) : cands[i % cands.count]
            let step = CGFloat(i / max(cands.count, 1) + 1) * 24
            out.append(clamp(base.offsetBy(dx: -step, dy: step)))
            i += 1
        }
        return out
    }

    /// 新开的那只放哪：记过位置（origin-<key>，还在某块屏幕上）就回到那里；没记过就挑主桌宠旁边第一个空着的格子
    /// 记过的位置夹进那块屏幕的可见区；压着站着的窗口（主桌宠或别的额外那只），或者占了后面几只要用的格子（剩下的不够放），就不用它，改挑格子。
    /// 格子按这一轮一共要站几只（companionTarget）排：以前按已经站着几只排，前几只排在主桌宠那一排、后几只换成贴屏幕底边的排法，两套格子对不上就叠在一起了（11-02）
    /// 窗口上面空着的比例（没有气泡时）：画布 362 高，人物区域从 59（气泡）+ 241 × 21.1% ≈ 110 开始，可点区域再往外 4 → 约 106 / 362。
    /// 拖到顶时窗口最多伸出屏幕这么多（DragView 按实际量的算），重新出现时按它夹回屏幕
    static let headRoom: CGFloat = 0.29

    func companionOrigin(key: String, size: NSSize) -> NSPoint {
        let others = (Array(companions.values) + leavingCompanions).map { $0.panel.frame }
        var saved: NSRect?
        if let o = defaults.array(forKey: "origin-\(key)") as? [Double], o.count == 2 {
            var r = NSRect(x: o[0], y: o[1], width: size.width, height: size.height)
            if let svf = NSScreen.screens.first(where: { $0.visibleFrame.intersects(r.insetBy(dx: 40, dy: 40)) })?.visibleFrame {
                r.origin.x = min(max(r.minX, svf.minX), max(svf.minX, svf.maxX - size.width))
                r.origin.y = min(max(r.minY, svf.minY), max(svf.minY, svf.maxY - size.height * (1 - Self.headRoom)))   // 上面那截透明的可以伸到菜单栏后面（见 PetPanel）
                saved = r
            }
        }
        let vf = (panel.screen ?? NSScreen.main)?.visibleFrame ?? panel.frame
        return Self.companionPick(main: panel.frame, others: others, saved: saved, total: companionTarget, size: size, visible: vf).origin
    }

    /// 纯计算（tests/companion_place_probe.sh 的 seq 测）：others 是已经站着的，saved 是记过、已经夹进屏幕的位置
    static func companionPick(main: NSRect, others: [NSRect], saved: NSRect?, total target: Int, size: NSSize, visible vf: NSRect) -> NSRect {
        let total = max(target, others.count + 1)
        let planned = companionSlots(main: main, count: total, size: size, visible: vf)
        let slots = planned + companionSlots(main: main, count: 2 * others.count + 1, size: size, visible: vf)
        // 比的是去掉气泡空白的那部分：排不下时格子本来就压着上一排的气泡空白
        // 左右再去掉两边的透明边：格子排不下时左右也压着这截
        let clear = { (s: NSRect, taken: [NSRect]) in !taken.contains { core($0).intersects(core(s).insetBy(dx: 1, dy: 1)) } }
        if let r = saved, clear(r, [main] + others), freeSlots(planned, taken: others + [r]).count >= total - others.count - 1 { return r }
        return slots.first { clear($0, others) } ?? slots.last ?? main
    }

    /// 还空着的格子（互相之间也不重叠，后面一只一只放进去不会叠）
    static func freeSlots(_ slots: [NSRect], taken: [NSRect]) -> [NSRect] {
        var used = taken, out: [NSRect] = []
        for s in slots where !used.contains(where: { core($0).intersects(core(s).insetBy(dx: 1, dy: 1)) }) { out.append(s); used.append(s) }
        return out
    }

    // MARK: 主桌宠页面发来的消息

    /// handlePet 里调：companions / companionLeave / companionCall / eggAllowed / friendship
    func handleCompanionMessage(_ d: [String: Any]) {
        if let id = d["companionLeave"] as? String { companionLeave(id) }
        if let list = d["companions"] as? [[String: Any]] {
            // gathering：页面说正集合着（菜单显示「解散」；开关关着时也要转发）
            let was = companionsForwarding
            pageGathering = d["gathering"] as? Bool ?? false
            companionExpected = d["expected"] as? Int ?? 0   // 集合时最后一共几只（还没登场的也算上）
            syncCompanions(list)
            if companionsForwarding && !was { startForwarding() }
        }
        if let call = d["companionCall"] as? [String: Any] { companionCall(call) }
        if let ok = d["eggAllowed"] as? Bool { eggAllowed = ok }
        if let rows = d["friendship"] as? [Any] { friendshipRows = rows; pushSettings() }
        if let store = d["friendshipStore"] as? [String: Any] { saveFriendshipFile(store) }
    }

    // MARK: 友谊的备份（数据目录里的 friendship.json）
    // 网页的存储在 ~/Library/WebKit 下，不在数据目录里：搬数据文件夹带不走、被清理掉就没了。页面每次记账都交一份来，
    // 载入完（didFinish，init 之前）交回去并进网页的存储（restoreFriendship，合并规则见 friendship.js 的 merge）

    var friendshipFile: URL { root.appendingPathComponent("friendship.json") }

    func saveFriendshipFile(_ store: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: store, options: [.sortedKeys]) else { return }
        try? data.write(to: friendshipFile, options: .atomic)
    }

    /// 交给 restoreFriendship 的参数：文件里的 JSON 对象，没有 / 坏了就是 null
    func savedFriendshipJSON() -> String {
        guard let data = try? Data(contentsOf: friendshipFile),
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any],
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    /// 按完整列表对齐窗口（按 id）：没有窗口的开；已经不在列表里、也没收到过 companionLeave 的（开关关掉时的 []、页面重载后的完整列表）
    /// 直接关掉，不留残窗；收到过 companionLeave 的已经挪到 leavingCompanions，在说 bye
    func syncCompanions(_ list: [[String: Any]]) {
        var seen = Set<String>()
        companionTarget = max(list.count, companionExpected)
        for pet in list {
            guard let id = pet["id"] as? String, !id.isEmpty, !seen.contains(id),
                  let ch = pet["character"] as? String, characterIds.contains(ch) else { continue }
            seen.insert(id)
            if let c = companions[id] { c.update(pet); continue }   // 同一个 id 换了角色（主桌宠换成她的角色，对调）：就地换
            companions[id] = Companion(app: self, pet: pet)
        }
        for (id, c) in companions where !seen.contains(id) { c.close() }
    }

    func companionLeave(_ id: String) {
        guard let c = companions.removeValue(forKey: id) else { return }
        leavingCompanions.append(c)
        c.leave()
    }

    /// 主桌宠页面让某只额外的桌宠做的事：额度庆祝（celebrate）、每对台词里她那句（chat）；别的不认
    func companionCall(_ call: [String: Any]) {
        guard let id = call["id"] as? String, let fn = call["fn"] as? String, ["celebrate", "chat", "answerRoll"].contains(fn), let args = call["args"] as? [Any],
              let c = companions[id], let data = try? JSONSerialization.data(withJSONObject: args),
              let json = String(data: data, encoding: .utf8) else { return }
        c.js("\(fn).apply(null, \(json))")
    }

    func companionClosed(_ c: Companion) {
        if companions[c.id] === c { companions.removeValue(forKey: c.id) }
        leavingCompanions.removeAll { $0 === c }
    }

    /// 主桌宠页面重新载入了：集合的记录跟着丢了。开关开着时页面热身完会发完整列表，按它对齐；
    /// 开关关着时页面不会再发，这里直接把窗口都关掉（回到单只）
    func companionsMainReloaded() {
        pageGathering = false
        guard !multiPetsOn else { return }
        for c in Array(companions.values) + leavingCompanions { c.close() }
        // 关着开关集合过：页面发过 eggAllowed:false，重新载入后的页面在开关关着时不会再发 true，「召唤彩蛋」会一直灰着。
        // 窗口都关了、回到单只，这里自己放开（菜单每次打开时重新生成）
        eggAllowed = true
    }

    /// 主桌宠页面的网页进程崩了：额外那几只没人管了（不会再收到列表、状态），全部关掉，重新载入主桌宠页面，
    /// 载入完（didStartProvisionalNavigation / didFinish）照常对齐。开关关着、也没有额外窗口时和以前一样什么都不做
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === web, multiPetsOn || !companions.isEmpty || !leavingCompanions.isEmpty else { return }
        appLog("桌宠页面的网页进程退出了，关掉额外的桌宠、重新载入")
        for c in Array(companions.values) + leavingCompanions { c.close() }
        pageGathering = false
        eggAllowed = true   // 同 companionsMainReloaded（开关开着时页面重新载入后会再发）
        web.reload()
    }

    @objc func gatherCompanions() {
        guard ready else { return }
        web.evaluateJavaScript("gather()") { [weak self] r, _ in
            guard let self, r as? Bool == true else { return }
            let was = self.companionsForwarding
            self.pageGathering = true
            if !was { self.startForwarding() }
        }
    }
    /// 右键「叫她出来 ▸ 某个角色」：只叫她一个来陪着（页面 callCompanion），和集合一样开始转发
    @objc func callCompanion(_ sender: NSMenuItem) {
        guard ready, let id = sender.representedObject as? String else { return }
        web.evaluateJavaScript("callCompanion(\(quote(id)))") { [weak self] r, _ in
            guard let self, r as? Bool == true else { return }
            let was = self.companionsForwarding
            self.pageGathering = true
            if !was { self.startForwarding() }
        }
    }
    @objc func dismissCompanions() {
        guard ready else { return }
        js("dismiss()")   // 解散完页面发 gathering: false
    }

    // MARK: 设置

    /// 三个设置一起推给主桌宠页面（启动、页面重载、设置改变时）
    func pushMultiPets() {
        let o: [String: Any] = ["on": multiPetsOn, "rest": petsRest, "mainPet": mainPet]
        guard let data = try? JSONSerialization.data(withJSONObject: o), let json = String(data: data, encoding: .utf8) else { return }
        js("setMultiPets(\(json))")
    }

    /// 设置页 { cmd: 'set', key: multiPets / petsRest / mainPet }（handleSettings 里调）；返回 false = 不是这三个键
    func setCompanionSetting(_ key: String, _ value: Any?) -> Bool {
        switch key {
        case "multiPets":
            let was = companionsForwarding
            defaults.set(value as? Bool ?? false, forKey: "multiPets")
            pushMultiPets()
            applyMainPet()
            if companionsForwarding && !was { startForwarding() }
        case "petsRest":
            guard let s = value as? String, ["auto", "stay", "open"].contains(s) else { return true }
            defaults.set(s, forKey: "petsRest")
            pushMultiPets()
        case "mainPet":
            guard let s = value as? String, s.isEmpty || characterIds.contains(s) else { return true }
            defaults.set(s, forKey: "mainPet")
            pushMultiPets()
            applyMainPet()
        default: return false
        }
        return true
    }

    /// 固定主桌宠由外壳自己生效（页面只记着）：开关开着、固定了某个角色，就把主桌宠换成她
    func applyMainPet() {
        let id = mainPet
        guard multiPetsOn, !id.isEmpty, id != currentId else { return }
        switchTo(id, why: "manual", via: "mainPet")
    }

    /// 共用的设置变了，额外那几只跟着（handleSettings 里调）
    func companionsSettingChanged(_ key: String) {
        guard !companions.isEmpty else { return }
        switch key {
        case "size": companions.values.forEach { $0.applySizes(anchor: .bottom) }
        case "textSize", "textLinked": companions.values.forEach { $0.applySizes(anchor: .feet) }
        case "showName", "aura", "powerSave", "noSleep", "quotaStyle", "peakStyle": companionsJS(companionLookJS)
        case "edgeDock": if !edgeDockEnabled { companions.values.forEach { $0.undock() } }
        default: break
        }
    }

    /// 额外那只的外观设置（共用的那几项）。合并额度表只在主桌宠身上，所以她的关着
    var companionLookJS: String {
        "setAuraMode(\(quote(auraMode))); setShowName(\(showName)); setPowerSave(\(powerSave)); setNeverSleep(\(noSleep)); setQuotaAggregate(false); setPeakStyle(\(quote(peakStyle))); setQuotaStyle(\(quote(quotaStyle)))"
    }

    func companionsJS(_ code: String) { (Array(companions.values) + leavingCompanions).forEach { $0.js(code) } }

    /// 全屏隐藏、快捷键隐藏、显示层级对所有窗口一起生效
    func syncCompanionWindows() { (Array(companions.values) + leavingCompanions).forEach { $0.syncWithMain() } }

    // MARK: 转发

    /// 开始转发（打开开关、开关关着时开始集合）：@ 状态重新读一遍，前台 / 在跑的程序马上交一次
    func startForwarding() {
        for k in stamps.keys where k.contains("@") { stamps[k] = nil }
        pushForeground()
        pushRunning(force: true)
    }

    /// 每次轮询（pollStates）：stateDir 里文件名带 @ 的 -state.json，有变化就交给主桌宠页面（applyClientState）和 key 对得上的那只
    func pollClientStates() {
        guard companionsForwarding else { return }
        let names = (try? FileManager.default.contentsOfDirectory(atPath: stateDir.path)) ?? []
        for name in names where name.hasSuffix("-state.json") && name.contains("@") {
            let key = String(name.dropLast("-state.json".count))
            guard let at = key.firstIndex(of: "@") else { continue }
            let character = String(key[..<at]), client = String(key[key.index(after: at)...])
            guard characterIds.contains(character), !client.isEmpty else { continue }
            let url = stateDir.appendingPathComponent(name)
            guard let stamp = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date,
                  stamp != stamps[key + "-state"] else { continue }
            stamps[key + "-state"] = stamp
            if Date().timeIntervalSince(stamp) > 600 { continue }   // 和按角色的一样：只认 10 分钟内的
            guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8),
                  (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { continue }
            clientStateSeen.insert(character)
            clientStates[key] = (text, stamp)
            if pauseRealEvents { continue }
            js("applyClientState(\(quote(character)), \(quote(client)), \(text))")
            for c in companions.values where c.key == key { c.applyState(text, at: stamp) }
        }
    }

    /// 按角色的状态（pollStates 读到 <角色>-state.json 时调）：旧钩子没写按客户端的那份时，交给这个角色收编了客户端的那只
    func noteCharState(_ id: String, _ text: String, _ stamp: Date) {
        charStates[id] = (text, stamp)
        guard companionsForwarding, !pauseRealEvents, !clientStateSeen.contains(id) else { return }
        for c in companions.values where c.character == id && c.client != nil { c.applyState(text, at: stamp) }
    }

    /// 会话表变了（pollStates 读到 <角色>-sessions.json 时调）：每只拿她自己客户端的那份
    func noteSessions(_ id: String, _ text: String) {
        sessionsText[id] = text
        guard companionsForwarding, !pauseRealEvents else { return }
        for c in companions.values where c.character == id { c.js("setSessions(\(quote(id)), \(sessionsFor(c)))") }
    }

    /// 只留她客户端的会话；没写 client 的旧条目按角色名算客户端（和 companions.js 的 clientsOf 一样）。还没收编客户端的集合那只：空的
    func sessionsFor(_ c: Companion) -> String {
        guard let client = c.client, let text = sessionsText[c.character], let data = text.data(using: .utf8),
              let map = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return "{}" }
        let mine = map.filter { (($0.value as? [String: Any])?["client"] as? String ?? c.character) == client }
        return (try? JSONSerialization.data(withJSONObject: mine)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// 额度：主桌宠照旧拿，同时记下；这个角色 quota: true 的那只也拿一份
    func quotaJS(_ character: String, _ code: String) {
        js(code)
        // 按「角色 + 函数」记：GPT 的 setQuota（额度文件）和 setCodexQuota（问 Codex 服务）不互相盖掉
        let fn = code.prefix { $0 != "(" }
        quotaSeq += 1
        quotaCode["\(character)|\(fn)"] = (quotaSeq, code)
        for c in companions.values where c.character == character && c.quota { c.js(code) }
    }
    /// 这个角色记下的所有额度调用（新开的那只、额度刚归她时补一遍）：按主桌宠收到的先后补，不按函数名排
    func quotaCodes(_ character: String) -> [String] {
        quotaCode.filter { $0.key.hasPrefix(character + "|") }.map { $0.value }.sorted { $0.seq < $1.seq }.map { $0.code }
    }

    /// 新开的那只页面加载完（或换了客户端）：会话、状态、额度先补一遍
    func feedCompanion(_ c: Companion) {
        guard !pauseRealEvents else { return }
        c.js("setSessions(\(quote(c.character)), \(sessionsFor(c)))")
        let fresh = { (s: (text: String, at: Date)?) in s.flatMap { Date().timeIntervalSince($0.at) < 600 ? $0 : nil } }
        if c.client != nil {
            if let s = fresh(clientStates[c.key]) { c.applyState(s.text, at: s.at) }
            else if !clientStateSeen.contains(c.character), let s = fresh(charStates[c.character]) { c.applyState(s.text, at: s.at) }
        }
        if c.quota { quotaCodes(c.character).forEach { c.js($0) } } else { c.js("setQuota(\(quote(c.character)), null)") }
    }

    // MARK: 前台程序、在跑的 AI 程序

    /// 前台程序是哪一类：ai（「跟随前台」认得的 AI 程序，Claude 桌面带 client）、terminal、ours（CrossPet 自己的窗口）、other
    func foregroundInfo(_ app: NSRunningApplication?) -> [String: Any] {
        guard let app, let bundle = app.bundleIdentifier else { return ["kind": "other"] }
        if app.processIdentifier == ProcessInfo.processInfo.processIdentifier { return ["kind": "ours"] }
        if let mapped = appToCharacter[bundle] ?? hostApp(bundle) {
            var f: [String: Any] = ["kind": "ai", "character": hostCharacter(mapped)]
            if bundle == Self.claudeDesktopBundle { f["client"] = "claude-desktop" }
            return f
        }
        if Self.terminalBundles.contains(bundle) { return ["kind": "terminal"] }
        return ["kind": "other"]
    }

    func pushForeground() {
        guard ready, companionsForwarding else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: foregroundInfo(NSWorkspace.shared.frontmostApplication)),
              let json = String(data: data, encoding: .utf8) else { return }
        js("setForeground(\(json))")
    }

    /// 有窗口的 AI 程序在跑的「角色@客户端」（「一直留着」时，程序关掉她才走）。
    /// 程序换成客户端名：Claude 桌面 claude-desktop、Codex codex、Antigravity antigravity、多模型宿主用宿主名，其余用它绑的角色名
    /// （和钩子写的接入名一致）。同一个程序里可能跑着好几个模型的角色（Codex 接了 DeepSeek 接口就是 deepseek@codex），
    /// 所以每个客户端都和所有角色配一遍
    func runningKeys() -> [String] {
        var clients = Set<String>()
        for a in NSWorkspace.shared.runningApplications {
            guard let b = a.bundleIdentifier else { continue }
            if b == Self.claudeDesktopBundle { clients.insert("claude-desktop") }
            else if b == "com.openai.codex" { clients.insert("codex") }
            else if b == "com.google.antigravity" { clients.insert("antigravity") }
            else if let host = hostApp(b) { clients.insert(host) }
            else if let ch = appToCharacter[b] { clients.insert(ch) }
        }
        return clients.flatMap { cl in characterIds.map { "\($0)@\(cl)" } }.sorted()
    }

    func pushRunning(force: Bool = false) {
        guard ready, companionsForwarding else { sentRunning = nil; return }
        guard let data = try? JSONSerialization.data(withJSONObject: runningKeys()), let json = String(data: data, encoding: .utf8),
              force || json != sentRunning else { return }
        sentRunning = json
        js("setRunning(\(json))")
    }

    /// 「跟随前台」要换角色：开关开着时先问页面（固定了主桌宠、主桌宠的角色有会话、要换成的已经有一只站着：不换）；still：答复回来时情况还对不对
    func followForeground(_ id: String, why: String, via: String, still: @escaping () -> Bool = { true }) {
        guard multiPetsOn else { switchTo(id, why: why, via: via); return }
        let standing = Array(Set(companions.values.map { $0.character })).sorted()
        let input: [String: Any] = ["foregroundId": id, "current": currentId as Any? ?? NSNull(), "mainPet": mainPet, "standing": standing]
        guard let data = try? JSONSerialization.data(withJSONObject: input), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("FollowPolicy.foregroundTarget(Object.assign(\(json), { mainClaimed: mainClaimed() }))") { [weak self] r, _ in
            guard let self, r as? String == id, id != self.currentId, self.characterIds.contains(id), still() else { return }
            self.switchTo(id, why: why, via: via)
        }
    }
}

import Carbon
import Cocoa
import ServiceManagement
import WebKit

extension App {
    // MARK: 菜单

    func showMenu(_ event: NSEvent, in view: NSView) {
        NSMenu.popUpContextMenu(buildMenu(), with: event, for: view)
    }

    func buildMenu() -> NSMenu {
        let menu = NSMenu()
        if let r = latestRelease {
            if canSelfUpdate {
                add(menu, updating ? "⬆️ 正在更新到 \(r.tag)…" : "⬆️ 更新到 \(r.tag)", #selector(selfUpdate))
            } else {
                add(menu, "⬆️ 有新版本 \(r.tag)，点这里下载", #selector(openRelease))
            }
            menu.addItem(.separator())
        }
        add(menu, "摸摸头", #selector(pat))
        add(menu, "戳一下", #selector(poke))
        let eggItem = add(menu, "召唤彩蛋", #selector(egg))
        if !eggAllowed { eggItem.action = nil }   // 有别的桌宠在场时不演彩蛋（页面发 eggAllowed:false）：没有动作的菜单项自动变灰
        // 集合不受开关限制，一直在；正集合着（包括叫了一只出来）时多一项「解散」，「集合！」把还没来的都叫来
        add(menu, "集合！", #selector(gatherCompanions))
        if pageGathering { add(menu, "解散", #selector(dismissCompanions)) }
        // 叫她出来：只叫一个角色来陪着（不用两个 AI 同时干活）。主桌宠演着的不列，已经站着的打勾、点不了（送走用她的「让她先回去」）
        let others = characterIds.filter { $0 != currentId }
        if !others.isEmpty {
            let standing = Set(companions.values.map { $0.character })
            let callItem = NSMenuItem(title: "叫她出来", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            sub.autoenablesItems = false
            for id in others {
                let item = NSMenuItem(title: displayNames[id] ?? id, action: #selector(callCompanion(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = id
                if standing.contains(id) { item.state = .on; item.isEnabled = false }
                sub.addItem(item)
            }
            callItem.submenu = sub
            menu.addItem(callItem)
        }
        if codexResets && currentId == "gpt" { add(menu, "会重置吗？", #selector(askReset)) }   // 只有 GPT 有这个需求
        if characterIds.count > 1 {
            menu.addItem(.separator())
            // 右键直接换（用户要回来的）：一项一套，有别的衣服（皮肤）的角色展开成几项：「DeepSeek · 女仆装」「DeepSeek · Claude 卫衣」。
            // 最下面「看图选…」打开角色窗口（卡片墙）
            let switchItem = NSMenuItem(title: "换角色", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            let worn = defaults.dictionary(forKey: "skins") as? [String: String] ?? [:]
            for id in characterIds {
                let name = displayNames[id] ?? id
                let outfits: [(skin: String, title: String)] = skinChoices[id].flatMap { $0.isEmpty ? nil : $0 }.map { skins in
                    [("", "\(name) · \(baseOutfit[id] ?? "原版")")] + skins.map { ($0.id, "\(name) · \($0.name)") }
                } ?? [("", name)]
                for o in outfits {
                    let item = NSMenuItem(title: o.title, action: #selector(switchCharacter(_:)), keyEquivalent: "")
                    item.representedObject = "\(id)|\(o.skin)"
                    item.target = self
                    item.state = id == currentId && (worn[id] ?? "") == o.skin ? .on : .off
                    sub.addItem(item)
                }
            }
            sub.addItem(.separator())
            add(sub, "看图选…", #selector(openCharacterPage))
            switchItem.submenu = sub
            menu.addItem(switchItem)
        }
        menu.addItem(.separator())
        let layerItem = NSMenuItem(title: "显示层级", action: nil, keyEquivalent: "")
        let layerMenu = NSMenu()
        for (mode, title) in [("always", "始终在最上层"), ("ai", "跟着 AI（用 AI 时才浮在最上层）"), ("normal", "普通窗口（不置顶）")] {
            let item = NSMenuItem(title: title, action: #selector(setLayer(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode
            item.state = layerMode == mode ? .on : .off
            layerMenu.addItem(item)
        }
        layerItem.submenu = layerMenu
        menu.addItem(layerItem)
        add(menu, "设置…", #selector(openSettings))
        add(menu, "反馈问题…", #selector(openFeedback))
        if NSEvent.modifierFlags.contains(.option) {  // 按住 ⌥ 右键才出现：给自己换立绘、加角色的人检查效果用
            add(menu, "开发者控制台…", #selector(openDevConsole))
        }
        add(menu, "回到右下角", #selector(resetPosition))
        add(menu, hotkeyLabel.map { "暂时隐藏（\($0)）" } ?? "暂时隐藏", #selector(toggleHidden))
        menu.addItem(.separator())
        add(menu, "退出 CrossPet", #selector(quit))
        return menu
    }

}

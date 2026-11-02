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
        // 集合不受开关限制，一直在；正集合着时换成「解散」
        if pageGathering { add(menu, "解散", #selector(dismissCompanions)) } else { add(menu, "集合！", #selector(gatherCompanions)) }
        if codexResets && currentId == "gpt" { add(menu, "会重置吗？", #selector(askReset)) }   // 只有 GPT 有这个需求
        if characterIds.count > 1 {
            menu.addItem(.separator())
            // 右键直接换（用户要回来的）：一个角色一项；有别的衣服的角色再展开一层选衣服，名单不会一长串。
            // 最下面「看图选…」打开角色窗口（卡片墙）
            let switchItem = NSMenuItem(title: "换角色", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            let worn = defaults.dictionary(forKey: "skins") as? [String: String] ?? [:]
            for id in characterIds {
                let name = displayNames[id] ?? id
                let item = NSMenuItem(title: name, action: nil, keyEquivalent: "")
                item.state = id == currentId ? .on : .off
                if let skins = skinChoices[id], !skins.isEmpty {
                    let outfits = NSMenu()
                    for (skin, title) in [("", baseOutfit[id] ?? "原版")] + skins.map({ ($0.id, $0.name) }) {
                        let o = NSMenuItem(title: title, action: #selector(switchCharacter(_:)), keyEquivalent: "")
                        o.representedObject = "\(id)|\(skin)"
                        o.target = self
                        o.state = id == currentId && (worn[id] ?? "") == skin ? .on : .off
                        outfits.addItem(o)
                    }
                    item.submenu = outfits
                } else {
                    item.action = #selector(switchCharacter(_:))
                    item.target = self
                    item.representedObject = "\(id)|"
                }
                sub.addItem(item)
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

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
        add(menu, "召唤彩蛋", #selector(egg))
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

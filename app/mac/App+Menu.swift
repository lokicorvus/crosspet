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
            // 角色和衣服多了，名单一长串要翻半天：改成打开设置的角色页（卡片墙），看着图选
            add(menu, "换角色…", #selector(openCharacterPage))
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

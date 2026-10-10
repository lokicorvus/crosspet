import Cocoa

@main
struct LifecycleHost {
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        try String(ProcessInfo.processInfo.processIdentifier).write(
            toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
        app.run()
    }
}

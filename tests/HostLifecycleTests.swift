import Cocoa

@main
struct HostLifecycleTests {
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let mode = CommandLine.arguments[1]
        let host = CommandLine.arguments[2]
        let marker = URL(fileURLWithPath: CommandLine.arguments[3])
        var exits = 0
        var lookups = 0
        let lifecycle = HostLifecycle(hostBundleIdentifier: host, applicationLookup: { id in
            lookups += 1
            if mode == "blip" && lookups > 1 { return [] }
            return NSRunningApplication.runningApplications(withBundleIdentifier: id)
        }) {
            exits += 1
            if mode != "absent" && FileManager.default.fileExists(atPath: marker.path) {
                precondition(exits == 1, "Exit callback must run only once")
                print("PASS: \(mode) host exit detected")
                exit(0)
            }
        }
        if mode == "absent" {
            precondition(!lifecycle.start(), "Missing host must prevent startup")
            precondition(!lifecycle.check(), "Missing host must remain stopped")
            precondition(!lifecycle.start(), "Stopped lifecycle must not register a new observer")
            precondition(exits == 1, "Exit callback must run only once")
            print("PASS: absent host exits once")
            return
        }
        precondition(lifecycle.start(), "Test host must be running")
        precondition(exits == 0, "Running host must keep pet alive")
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didTerminateApplicationNotification,
            object: nil, userInfo: [NSWorkspace.applicationUserInfoKey: NSRunningApplication.current])
        precondition(exits == 0, "Unrelated app notifications must not stop the pet")
        if mode == "blip", !lifecycle.check() || exits != 0 {
            print("FAIL: registry lookup loss must not stop a live host")
            exit(1)
        }
        try Data("ready".utf8).write(to: marker)
        if mode == "cancel" {
            lifecycle.stop()
            precondition(!lifecycle.check() && !lifecycle.start() && exits == 0)
            Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { _ in
                precondition(exits == 0, "Disabled binding must not react to host exit")
                print("PASS: disabled observer stays inactive after host exit")
                exit(0)
            }
        }
        Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { _ in
            print("FAIL: last host exiting must stop pet")
            exit(1)
        }
        if mode == "poll" || mode == "blip" {
            Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in lifecycle.check() }
        }
        withExtendedLifetime(lifecycle) { app.run() }
    }
}

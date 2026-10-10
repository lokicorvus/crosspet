import Cocoa
import Darwin

/// Keep the pet alive only while at least one instance of its desktop host runs.
/// The existing pet timer calls check() as a fallback for missed exit notifications.
final class HostLifecycle {
    private let hostBundleIdentifier: String
    private let applicationLookup: (String) -> [NSRunningApplication]
    private let onExit: () -> Void
    private var observer: NSObjectProtocol?
    private var stopped = false
    private var hostProcesses: [pid_t: String] = [:]

    init(hostBundleIdentifier: String,
         applicationLookup: @escaping (String) -> [NSRunningApplication] = {
             NSRunningApplication.runningApplications(withBundleIdentifier: $0)
         }, onExit: @escaping () -> Void) {
        self.hostBundleIdentifier = hostBundleIdentifier
        self.applicationLookup = applicationLookup
        self.onExit = onExit
    }

    @discardableResult
    func start() -> Bool {
        guard !stopped else { return false }
        if observer == nil {
            observer = NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didTerminateApplicationNotification,
                object: nil, queue: .main
            ) { [weak self] note in
                guard let self,
                      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                      app.bundleIdentifier == self.hostBundleIdentifier else { return }
                self.check()
            }
        }
        return check()
    }

    @discardableResult
    func check() -> Bool {
        guard !stopped else { return false }
        let applications = applicationLookup(hostBundleIdentifier).filter { !$0.isTerminated }
        for app in applications {
            if let path = Self.executablePath(app.processIdentifier) {
                hostProcesses[app.processIdentifier] = path
            }
        }
        // An application-list lookup can be empty while the host still exists.
        // Keep verified host PIDs until their executable actually disappears or
        // changes. Comparing the full path also protects against PID reuse.
        hostProcesses = hostProcesses.filter { Self.executablePath($0.key) == $0.value }
        if !hostProcesses.isEmpty {
            return true
        }
        stop()
        onExit()
        return false
    }

    private static func executablePath(_ pid: pid_t) -> String? {
        // PROC_PIDPATHINFO_MAXSIZE is defined as 4 * MAXPATHLEN in libproc.h.
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        let count = buffer.withUnsafeMutableBufferPointer {
            proc_pidpath(pid, $0.baseAddress, UInt32($0.count))
        }
        return count > 0 ? String(cString: buffer) : nil
    }

    /// Disabling or replacing a binding must not leave an observer behind.
    func stop() {
        stopped = true
        hostProcesses.removeAll()
        if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observer = nil
    }

    deinit {
        stop()
    }
}

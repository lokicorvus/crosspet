// tests/notebook_scan_mac.sh 用：在夹具目录上跑 NotebookScan.scanAll，打印 JSON
import Foundation
let home = URL(fileURLWithPath: CommandLine.arguments[1])
let out = NotebookScan.scanAll(home: home, env: [:])
let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)

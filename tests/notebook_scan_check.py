"""比较 NotebookScan 输出（stdin 的 JSON）和 tests/fixtures/notebook/expected.json；Mac 和 Windows 共用。"""
import json, pathlib, sys
want = json.loads((pathlib.Path(__file__).parent / "fixtures" / "notebook" / "expected.json").read_text())
got = json.loads(sys.stdin.read())
if got != want:
    print("FAIL")
    print("want:", json.dumps(want, ensure_ascii=False))
    print("got: ", json.dumps(got, ensure_ascii=False))
    sys.exit(1)
print("PASS")

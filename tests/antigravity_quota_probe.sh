#!/bin/sh
# Gemini（Antigravity）额度排版：先 app/build.sh 编译，再 tests/antigravity_quota_probe.sh
# 样本在 tests/fixtures/antigravity/（只留模型名和额度字段）
set -eu
cd "$(dirname "$0")/.."
BIN=build/CrossPet.app/Contents/MacOS/CrossPet
F=tests/fixtures/antigravity
fail=0
check() {   # 名字 样本 期望（Python 表达式，q 是结果）
  out=$(perl -e 'alarm 5; exec @ARGV' "$BIN" --agy-quota-probe "$F/$2.json" 2>/dev/null || echo '"（没有输出）"')
  python3 - "$1" "$3" "$out" <<'PY' || fail=1
import json, sys
name, expect, out = sys.argv[1:4]
try: q = json.loads(out)
except Exception: q = None
ok = False
try: ok = bool(eval(expect, {"q": q}))
except Exception: pass
print(("PASS" if ok else "FAIL"), name, "" if ok else out)
sys.exit(0 if ok else 1)
PY
}
# 2026-10-14 实测：非 Ultra 账号里「Gemini 4 Argon」标着不可用、额度信息是空的，以前被当成「剩 0%」排在第一行
# 固定两行，和 Antigravity 自己「View Usage」的分组一样：Gemini 一行、Claude/GPT 一行，数字相同也不合并
check "不可用的模型不算进额度" ultra-only-model 'q["text"].split(" ｜ ")[0].startswith("Gemini 剩余 100%") and q["text"].split(" ｜ ")[1] == "Claude/GPT 剩余 100%" and q["low"] is False'
check "真用完了还是 0%" gemini-used-up 'q["text"].startswith("Gemini 剩余 0%") and "重置" in q["text"].split(" ｜ ")[0] and q["text"].split(" ｜ ")[1] == "Claude/GPT 剩余 100%" and q["low"] is True'
check "两个池 + 不可用模型" two-pools-with-unavailable 'q["text"].startswith("Gemini 剩余 52%") and q["text"].split(" ｜ ")[1] == "Claude/GPT 剩余 99%" and " 0%" not in q["text"] and q["low"] is False'
# 主要来源：额度汇总（RetrieveUserQuotaSummary，和 Antigravity 的「View Usage」同一份数据，刚对话完就更新）
check "汇总：两组各一行，98% 是新数据" summary-live 'q["text"].split(" ｜ ")[0].startswith("Gemini 剩余 100%") and "重置" in q["text"].split(" ｜ ")[0] and q["text"].split(" ｜ ")[1].startswith("Claude/GPT 剩余 98% · ") and q["text"].split(" ｜ ")[1].endswith(" 重置") and q["low"] is False'
check "汇总：用完时比例被省略，算 0%" summary-gemini-used-up 'q["text"].startswith("Gemini 剩余 0%") and q["low"] is True'
check "汇总：一组有两个窗口，只留剩余最少的那个" summary-two-windows 'q["text"].split(" ｜ ")[0].startswith("Gemini 今日 剩余 40%") and q["text"].split(" ｜ ")[1].startswith("Claude/GPT 剩余 98% · ") and "本周" not in q["text"]'
check "汇总：独立额度池（Gemini 4 Argon）保留名字，每组一行" summary-multi-pool 'q["text"].split(" ｜ ")[0].startswith("Gemini 本周 剩余 99%") and q["text"].split(" ｜ ")[1].startswith("Gemini 4 Argon 剩余 46% · ") and q["text"].split(" ｜ ")[2].startswith("Claude/GPT") and len(q["text"].split(" ｜ ")) == 3 and "Five Hour" not in q["text"]'
check "汇总：5h 最紧时显示成「5小时」" summary-5h-tightest 'q["text"].split(" ｜ ")[0].startswith("Gemini 5小时 剩余 30%") and q["text"].split(" ｜ ")[1].startswith("Claude/GPT 剩余 100% · ") and "本周" not in q["text"]'
check "汇总：两个窗口一样紧（50%），不管接口顺序都显示 5小时 和它的重置时间" summary-tie-5h-first 'q["text"].split(" ｜ ")[0].startswith("Gemini 5小时 剩余 50% · ") and q["text"].split(" ｜ ")[0].endswith(" 重置")'
check "汇总：同上，周额度排在前面结果一样" summary-tie-weekly-first 'q["text"].split(" ｜ ")[0].startswith("Gemini 5小时 剩余 50% · ")'
check "汇总：5h 满了显示周额度和重置时间" summary-multi-pool 'q["text"].split(" ｜ ")[0].startswith("Gemini 本周 剩余 99% · ") and q["text"].split(" ｜ ")[2].startswith("Claude/GPT 本周 剩余 100% · ")'
check "汇总：周额度 ≤10% 时不被 5h 盖住" summary-weekly-low 'q["text"].split(" ｜ ")[0].startswith("Gemini 本周 剩余 5% · ") and q["low"] is True'
check "汇总：每一行都带重置时间" summary-all-50 'all(seg.endswith(" 重置") for seg in q["text"].split(" ｜ ")) and len(q["text"].split(" ｜ ")) == 3'
# 合并显示用的结构化额度条 bars：每个窗口一项 {label, left, reset?, group}，同一个池的窗口挨着排（短窗口在前）；排版（Gemini + Arg 一行、Agy C/G 另起一行）在网页层
check "bars：每个窗口一项，label = 池名 + 窗口名，同一个池挨着排" summary-multi-pool '[b["label"] for b in q["bars"]] == ["Gemini 5小时", "Gemini 本周", "Argon 本周", "Claude/GPT 5小时", "Claude/GPT 本周"] and [b["group"] for b in q["bars"]] == ["Gemini", "Gemini", "Argon", "Claude/GPT", "Claude/GPT"] and [b["left"] for b in q["bars"]] == [1, 0.99, 0.46, 1, 1] and all(isinstance(b["reset"], int) and b["reset"] > 1.7e9 for b in q["bars"])'
check "bars：窗口名按接口的窗口 id（今日 / 本周），没有 Argon 时只有两个池" summary-two-windows '[b["label"] for b in q["bars"]] == ["Gemini 今日", "Gemini 本周", "Claude/GPT 本周"]'
check "bars：全部用完（比例被省略）= left 0，每项都带 reset" summary-all-used-up 'len(q["bars"]) == 5 and all(b["left"] == 0 and "reset" in b for b in q["bars"])'
check "bars：没有重置时间就不写 reset 字段" summary-no-reset 'q["bars"] == [{"label": "Gemini 本周", "left": 0.7, "group": "Gemini"}]'
check "汇总是空的：不显示（程序会退回查用户状态）" summary-empty 'q == {}'
exit $fail

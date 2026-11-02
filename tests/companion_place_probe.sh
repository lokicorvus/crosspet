#!/bin/sh
# 多桌宠：额外那几只第一次出现放在哪（Mac 版 App.companionSlots 的纯计算），先 app/build.sh 编译，再 tests/companion_place_probe.sh
# 参数：主桌宠 x y 宽 高、几只、每只宽 高、可见区 x y 宽 高（屏幕点，y 向上）；每行打印一只的 x y 宽 高
# 规则：放在主桌宠左边，放不下放右边，再放不下往上一排；每只都在可见区里、两两不重叠、不压着主桌宠（Review Focus 5）
set -eu
cd "$(dirname "$0")/.."
BIN=build/CrossPet.app/Contents/MacOS/CrossPet
fail=0
MODE=--companion-place-probe
run() {   # 和 window_place_probe.sh 一样 5 秒超时：参数不认识时 App 会当成正常启动，别真开出一只桌宠来
  perl -e 'alarm 5; exec @ARGV' "$BIN" "$MODE" "$@" 2>/dev/null || true
}
# 名字 主桌宠(4) 几只 宽 高 可见区(4)：几只都要有、都在可见区里、两两不重叠、不压主桌宠
# SHARE=59/362：只比去掉顶上气泡空白的那部分（屏幕放不下整窗口时允许压着气泡空白）
SHARE=0
check_layout() {
  name=$1; shift
  count=$5; mx=$1; my=$2; mw=$3; mh=$4; vx=$8; vy=$9; vw=${10}; vh=${11}
  out=$(run "$@")
  verdict=$(printf '%s\n' "$out" | awk -v s="$SHARE" -v n="$count" -v mx="$mx" -v my="$my" -v mw="$mw" -v mh="$mh" \
      -v vx="$vx" -v vy="$vy" -v vw="$vw" -v vh="$vh" '
    BEGIN { k = 0 }
    NF == 4 { x[k] = $1; y[k] = $2; w[k] = $3; H[k] = $4; h[k] = $4 * (1 - s); k++ }
    function over(ax, ay, aw, ah, bx, by, bw, bh) { return ax < bx + bw - 0.01 && bx < ax + aw - 0.01 && ay < by + bh - 0.01 && by < ay + ah - 0.01 }
    END {
      if (k != n) { print "只有 " k + 0 " 只（要 " n " 只）"; exit }
      for (i = 0; i < k; i++) {
        if (x[i] < vx - 0.01 || y[i] < vy - 0.01 || x[i] + w[i] > vx + vw + 0.01 || y[i] + H[i] > vy + vh + 0.01) { print "第 " i + 1 " 只出了可见区：" x[i] " " y[i]; exit }
        if (over(x[i], y[i], w[i], h[i], mx, my, mw, mh * (1 - s))) { print "第 " i + 1 " 只压着主桌宠：" x[i] " " y[i]; exit }
        for (j = 0; j < i; j++) if (over(x[i], y[i], w[i], h[i], x[j], y[j], w[j], h[j])) { print "第 " j + 1 " 和第 " i + 1 " 只重叠"; exit }
      }
      print "ok"
    }')
  if [ "$verdict" = "ok" ]; then echo "PASS $name"; else echo "FAIL $name：$verdict"; fail=1; fi
}
# 名字 期望第几行 期望输出 参数…：检查某一只的具体位置（左边先、放不下放右边、再往上一排）
check_slot() {
  name=$1; line=$2; want=$3; shift 3
  got=$(run "$@" | sed -n "${line}p")
  [ -n "$got" ] || got="（没有输出）"
  if [ "$got" = "$want" ]; then echo "PASS $name"; else echo "FAIL $name：期望 $want，得到 $got"; fail=1; fi
}
# Review Focus 5：主桌宠在屏幕右下（默认位置：右边留 40、底下 100），叫出 12 只
check_layout bottom-right-12 1620 100 260 362 12 260 362 0 0 1920 1055
# 第一只紧挨在主桌宠左边、底边对齐
check_slot first-left 1 "1360 100 260 362" 1620 100 260 362 1 260 362 0 0 1920 1055
# 左边排满了（6 只）：右边放不下，第 7 只往上一排，先放在主桌宠正上方
check_slot row-up 7 "1620 462 260 362" 1620 100 260 362 7 260 362 0 0 1920 1055
# 主桌宠在屏幕最左边：左边放不下，放右边
check_slot left-edge-right 1 "300 100 260 362" 40 100 260 362 1 260 362 0 0 1920 1055
check_layout left-edge-5 40 100 260 362 5 260 362 0 0 1920 1055
# 副屏（可见区不从 0 开始）、主桌宠贴边缩进屏幕外一半：照样都在可见区里
check_layout second-screen -2050 400 260 362 6 260 362 -1920 80 1920 1000
# 文字放大后画布比人物宽（每只比主桌宠窄 / 宽）：也不重叠
check_layout wider-main 1500 100 348 341 8 260 362 0 0 1920 1055
check_layout wider-companion 1620 100 260 362 8 348 341 0 0 1920 1055
# 笔记本屏幕（可见区高 859，两排整窗口要 862）、主桌宠在右上：整窗口只排得下一排 3 格；
# 6 只要压着气泡空白排成两排，人物不重叠（以前后 3 只叠在前 3 只上）
SHARE=$(awk 'BEGIN { print 59 / 362 }')
check_layout laptop-two-rows 1164 513 310 431 6 310 431 0 85 1512 859
# 主桌宠在屏幕中间偏下（11-02 截图）：和她底边对齐往上、往下都差一点排不下第二排，以前后 3 只错开 24 点叠在前 3 只上；
# 现在改按屏幕底边 / 顶边对齐排两排
check_layout laptop-middle-300 1164 300 310 431 6 310 431 0 85 1512 859
check_layout laptop-middle-200 1164 200 310 431 6 310 431 0 85 1512 859
check_layout laptop-middle-400 1164 400 310 431 6 310 431 0 85 1512 859
# 一只一只放（11-02 第二次截图）：以前每只按已经站着几只排格子，前 3 只在主桌宠那排、后 3 只换成贴屏幕底边的排法，对不上就叠了；
# 记过的位置（拖过的）占了后面要用的格子也不用
MODE=--companion-seq-probe
check_layout seq-middle 1146 381 310 431 6 310 431 0 83 1512 874
check_layout seq-saved 1146 381 310 431 6 310 431 0 83 1512 874 60 245 463 198 964 513
check_layout seq-saved-few 1146 381 310 431 3 310 431 0 83 1512 874 463 198 60 245
MODE=--companion-place-probe
SHARE=0
check_layout laptop-three-fit 1164 513 310 431 3 310 431 0 85 1512 859
# 屏幕太小放不下：只要求都在可见区里（重叠躲不开）
out=$(run 1100 100 260 362 20 260 362 0 0 1440 875)
bad=$(printf '%s\n' "$out" | awk 'NF == 4 { k++; if ($1 < -0.01 || $2 < -0.01 || $1 + $3 > 1440.01 || $2 + $4 > 875.01) b++ } END { if (k != 20) print "只有 " k + 0 " 只"; else if (b) print b " 只出了可见区"; else print "ok" }')
if [ "$bad" = "ok" ]; then echo "PASS too-many-clamped"; else echo "FAIL too-many-clamped：$bad"; fail=1; fi
exit $fail

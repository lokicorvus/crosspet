# 时段登场 + 节日登场：绘制队列

给 GPT（能看参考图的生图）用。**每个文件就是一整批，直接全文复制发过去**，附件附上文件开头写的那张参考图。
每批先让它画第 1 张试稿，没画走样再画剩下的。画好放到 `characters/<角色>/raw/`，文件名用清单里的名字。

## 顺序（先时段，再按日期排节日）

| # | 批次文件 | 张数 |
|---|---|---|
| 1 | [01-claude-时段.md](01-claude-时段.md) | 6 |
| 2 | [02-gpt-时段.md](02-gpt-时段.md) | 6 |
| 3 | [03-deepseek-时段.md](03-deepseek-时段.md) | 6 |
| 4 | [04-gemini-时段.md](04-gemini-时段.md) | 6 |
| 5 | [05-glm-时段.md](05-glm-时段.md) | 6 |
| 6 | [06-claude-节日.md](06-claude-节日.md) | 8 |
| 7 | [07-gpt-节日.md](07-gpt-节日.md) | 8 |
| 8 | [08-deepseek-节日.md](08-deepseek-节日.md) | 8 |
| 9 | [09-gemini-节日.md](09-gemini-节日.md) | 8 |
| 10 | [10-glm-节日.md](10-glm-节日.md) | 8 |

合计 70 张：时段 5×6=30，节日 5×8=40。

时间段：greet_morning 早上（5–11 点）· greet_noon 中午（11–14）· greet_afternoon 下午（14–18）· greet_evening 晚上（18–23）· greet_night 深夜（23–2）· greet_dawn 凌晨（2–5）
节日：fest_halloween 万圣节 · fest_christmas 圣诞 · fest_newyear 元旦 · fest_spring 春节 · fest_lantern 元宵 · fest_dragonboat 端午 · fest_midautumn 中秋 · fest_national 国庆（出游主题，不放旗帜）

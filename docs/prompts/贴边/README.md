# 贴边：扒着屏幕边缘（10 张）

把桌宠拖到屏幕左边缘或右边缘时，她缩到屏幕外，只露半个身子扒着边缘往里看；AI 干活时自己跑出来，干完过约 10 秒缩回去，鼠标移到露出来的那截上她会探出来。
每个文件全文复制发给 GPT，附件附上文件开头写的参考图。**先画 `edge_left`，再让它在 `edge_left` 的基础上改出 `edge_right`**，两张才不会跳。
导入：`SKIP_EDGE=left python3 tools/prepare.py <图> <角色> edge_left`（切口那条边不当白底的起点，不然贴着切口的白衣服会被抠掉；GPT 再加 `BG_MIN=250 BG_SPREAD=6`）。
画面的边框就是屏幕边缘：`edge_left` 是左边框从她身上切过去（停在屏幕左边缘时用），`edge_right` 是右边框切过去。文件名用下划线。

| # | 批次文件 | 张数 |
|---|---|---|
| 1 | [01-claude-贴边.md](01-claude-贴边.md) | 2 |
| 2 | [02-gpt-贴边.md](02-gpt-贴边.md) | 2 |
| 3 | [03-deepseek-贴边.md](03-deepseek-贴边.md) | 2 |
| 4 | [04-gemini-贴边.md](04-gemini-贴边.md) | 2 |
| 5 | [05-glm-贴边.md](05-glm-贴边.md) | 2 |

合计 10 张。以后想加：缩着很久没动静时趴在边上打瞌睡（`edge_left_sleep` / `edge_right_sleep`），鼠标移上去时好奇地看你。

# 彩蛋 · DeepSeek 偷用魔术师 Gemini 的帽子 · escape · 彩蛋·溜走

- 保存到：`art/任务/2026-11-彩蛋-DeepSeek借魔术帽/成品/egg-deepseek-hat__escape__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `art/任务/2026-11-彩蛋-DeepSeek借魔术帽/成品/egg-deepseek-hat__escape__v2.png`（局部修正底图：去掉头顶多余帽子，不继承其双帽错误）
  2. `characters/deepseek/idle.webp`（恢复无遮挡的原女仆头饰、头发和呆毛）
  3. `docs/prompts/ref-deepseek.webp`（原始角色画风核对）
  4. `art/原图/gemini-magician/idle/v3.png`（仅核对腿上唯一礼帽与魔具设计）

## 提示词

```text
Use case: precise-object-edit.
Edit Image 1, the escape v2 sprite. Fix the single known duplicate-prop error with a localized edit, rather than redrawing the character.

REQUIRED EDIT:
Remove the EXTRA miniature navy top hat from the TOP OF HER HEAD completely, including its gold band, brim and star ornament. In the space it occupied, restore the natural continuous white ruffled maid headdress and navy hair, following Image 2 and Image 3. Keep the original blue hair bow and curled navy ahoge. The white maid headdress is her clothing and must remain; it is not the magic hat.
There must be EXACTLY ONE magician top hat in the entire result: the existing rice-filled hat resting IN HER LAP. Keep that lap hat in its bowl orientation, open brim upward and closed crown below, rice visibly filling the opening. Do not put another magician hat anywhere on her head, hair, cape or background.

PRESERVE EVERYTHING ELSE FROM IMAGE 1:
Closed smiling eyes, puffed full cheek and small mouth, spoon eating rice, face shape, hair, fin ears, compact cross-legged seated pose, both hands and spoon grip, rice-filled lap hat, single black wand with white tips touching her knees, maid outfit, whale-emblem apron, existing cape, and original smooth aquatic tail. Keep the same soft linework, colors, flat shading and proportions. No new character or prop. The task is removing the head hat, not changing her expression or visual style.
Images 2-3 are original identity references for restoring the tiny covered head area only; Image 4 is only a gear design reference, not a character/style source.

OUTPUT:
One complete character on real transparency, transparent_background=true. Square PNG at least 1024x1024. No floor, shadow, glow, text, detached decorative symbols or extra hats. Keep complete ahoge and tail inside frame; preserve all old files and save the next unused egg-deepseek-hat__escape__vN.png. Do not manually crop, resize, repaint or postprocess the generated result.
```

## 本轮用户退回原因

2026-11-17 用户明确指出escape v1、v2均头顶和腿上各一顶帽子，要求重画。本轮局部修正以v2为底图，只移除头顶多余礼帽、恢复原女仆头饰，保留腿上唯一装饭礼帽和吃饭动作。保留所有旧版，不改pick。既有单纯留白例外继续有效。

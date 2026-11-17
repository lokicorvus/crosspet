# 彩蛋 · DeepSeek 偷用魔术师 Gemini 的帽子 · caught · 彩蛋·被识破

- 保存到：`art/任务/2026-11-彩蛋-DeepSeek借魔术帽/成品/egg-deepseek-hat__caught__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `art/任务/2026-11-彩蛋-DeepSeek借魔术帽/成品/egg-deepseek-hat__caught__v6.png`（用户已认可的唯一编辑底图，锁定此版脸、表情与画风）
  2. `characters/deepseek/idle.webp`（原始定妆，身份与光滑鲸尾核对）
  3. `docs/prompts/ref-deepseek.webp`（原始画风参考）
  4. `art/原图/gemini-magician/idle/v3.png`（仅核对已有魔具设计，不引入其角色或画风）

## 提示词

```text
Use case: precise-object-edit / identity-preserve.
Edit the FIRST attached image, the USER-APPROVED caught v6 sprite. This is a small localized content change, NOT a redraw of the character.
Image 1 is the only edit target. Images 2 and 3 are original DeepSeek design references only, and Image 4 is Gemini prop design reference only. Preserve Image 1 rather than adopting another reference's proportions.

KEEP EXACTLY FROM IMAGE 1:
Face shape, eyes and gaze, blue irises, eyebrow expression, small open round mouth, cheek sweat drop and blush; entire head and hair, maid headdress, fin ears, curled ahoge, blue ribbon; smooth pointed aquatic tail; compact body and short legs; navy maid outfit, whale apron, blue diamond brooch; existing short star-lined cape; soft flat rendering, outline weight, muted palette, framing and transparency. Do not change the approved face or style. No additional hat, star clasp, anatomy changes, symbols or decorative effects.

CHANGE THE RICE STORY ONLY:
She has just been caught, and in her startled hands the SINGLE small rice-filled top hat has tipped roughly 30 degrees toward the viewer's left. Keep both small hands in contact with the hat, changing their angle only enough to support this slight accidental tilt. The brim is still the open side; do not duplicate the hat, and no hat is on her head.
The cooked white rice MUST visibly spill OUT over the lowered left rim, not remain a neat stable mound in the middle. Show an unmistakable short downward cascade of several small clumps and a few readable rice grains, from inside the opening over the brim toward her front apron and skirt. Some rice has caught on the front/left apron or sleeve, so the accident is readable even without detached grains. Keep a little rice inside the tilted hat. The visual must read 'oops, I spilled it when caught', not a bowl held normally or merely heaped rice.
Keep the ONE black wand with white tips resting partly within the rice/hat, tilting with the prop; no extra wand and no floating wand.
The falling rice is a real story object explicitly requested by the user: a small number of airborne rice grains is permitted for THIS edit, unlike decorative floating symbols. Do not add a floor, ground pile, bowl, motion lines, text, sparkle or another character. Rice falling outside the hat must not cover her eyes, face or original whale emblem completely.

OUTPUT:
One transparent square PNG, at least 1024x1024, transparent_background=true. Preserve original quality and alpha, no manual cropping/scaling/repainting after generation. Full character including ahoge and feet. Save a new unused egg-deepseek-hat__caught__vN.png in the specified folder; never overwrite v6 or any older image.
```

## 用户本轮要求

2026-11-17用户认可v6“这张不错”，要求内容变化为“被识破应该是饭撒出来了”。因此以固定v6为编辑底图，只改帽子/米饭及手部必要角度，原脸表情画风不变；允许少量真实下落米粒，但不加入装饰性浮空符号。原图参考仍附，质量不降。此前单纯留白例外继续有效。

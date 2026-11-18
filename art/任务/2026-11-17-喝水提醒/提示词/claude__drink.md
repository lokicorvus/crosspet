# Claude · drink · 喝水

- 保存到：`art/任务/2026-11-17-喝水提醒/成品/claude__drink__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `characters/claude/idle.webp`（设计参考）
  2. `docs/prompts/ref-claude.webp`（设计参考）
  3. `characters/claude/portrait.webp`（设计参考）

## 上次退回的原因

用户退回：嘴部与玻璃杯错位，接触和遮挡不自然；2026-11-17 用户确认修正方案后说“开工吧”，授权新一轮。以原始定妆重新组织嘴唇、杯口透视、双手及轻微倾角，不沿用旧错误成品；同时保留头顶余量和待机尺度。 Claude 的书完全收起，不夹在臂下或贴身。

## 提示词

```text
You are drawing desktop-pet sprites for an existing chibi character. The attached images are the ONLY design reference.

FORMAT RULES (every image):
- Real transparent background (generate with transparent_background: true). Nothing else: no floor, no cast shadow, no glow, no vignette, no frame. Keep complete, clean edges. If an attached reference image has a plain white background, that is only because it was made before transparent output was available: do NOT copy the white background.
- No text, no letters, no speech bubbles, no symbols (no ?, !, hearts, music notes, Zzz, sparkles, sweat-drop icons floating in the air). The app draws all effects itself.
- Exactly one character, full body, standing, centered, facing mostly toward the viewer like the reference. Match the approved idle character scale, not an enlarged close-up. Keep the ENTIRE silhouette including the highest hair tuft, headwear and feet inside the square canvas, with a clearly visible transparent top margin of about 5% and a bottom margin of about 5%; keep side extremities away from the edges too. Do not enlarge or crop the character to fill the canvas.
- A continuous, closed dark outline around the whole silhouette (hair, horns, ears, wings and tail included), so the edges stay clean against any background.
- Same art style as the reference: clean lineart, flat two-tone cel shading, soft palette, chibi about 2.5 heads tall, big head, round soft shapes.
- Square image, 1024x1024 or larger. One image per file, saved under the exact path given.
- Change ONLY the expression, the arms/hands, and small props. Hair, accessories, outfit, colors and body features stay exactly as in the reference.

CHARACTER LOCK — Claude, the anime-girl personification of Claude (Anthropic).
Personality: gentle, calm, bookish, a little shy, quietly cheerful; she thinks before she speaks.
Keep exactly:
- Long wavy copper-orange hair, loose side-swept bangs, warm amber eyes.
- An orange daisy-like hair flower with a black striped ribbon bow and a white tassel on HER LEFT side (viewer's right); small drop earrings.
- Cream-white dress with a short cape collar, orange flower embroidery, orange and black front panels, small black bows with gold tassels, a black waist sash, an orange flower brooch at the collar; dark brown boots.
- For this drink pose the user explicitly asked her to put the book away completely: NO book visible, held, tucked under an arm, or resting against the body. Both hands hold only the glass.
How she shows emotion in this drink pose: small, soft expressions. Never wild or loud; her book is put away offscreen.

POSE (drink): She is actually taking a small sip of water, with contentedly closed eyes and softly pink cheeks. Preserve the original face proportions and the normal centered mouth position. Treat the face, glass rim, hands and glass tilt as ONE coherent action: both hands support a small clear drinking glass raised to the lips; gently tip the glass toward her mouth, with a natural slight head adjustment if needed. A short section of the rim must meet the middle of her lower lip with clear, plausible contact and partial occlusion. Keep the mouth mostly hidden at this contact, rather than drawing a separate smile, tiny cross, or puckered mouth floating above or to one side of the rim. Position the glass to meet the face; never slide the mouth sideways to meet the glass. Keep the nose and eyes clear. The glass, fingers and water must have consistent perspective; no gap between lips and rim. For Claude specifically, put the book away offscreen: no book anywhere in the image. Both hands hold only the glass.
Save as: claude__drink__vN.png
```

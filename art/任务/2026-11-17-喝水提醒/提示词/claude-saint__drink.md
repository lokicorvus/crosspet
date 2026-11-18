# Claude · 圣女 · drink · 喝水

- 保存到：`art/任务/2026-11-17-喝水提醒/成品/claude-saint__drink__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `characters/claude-saint/idle.webp`（设计参考）

## 上次退回的原因

用户退回：嘴部与玻璃杯错位，接触和遮挡不自然；2026-11-17 用户确认修正方案后说“开工吧”，授权新一轮。以原始定妆重新组织嘴唇、杯口透视、双手及轻微倾角，不沿用旧错误成品；同时保留头顶余量和待机尺度。

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

CHARACTER LOCK — Claude as the Saint: an alternate skin of Claude, the anime-girl personification of Claude (Anthropic). She grew up as a "saint" under a very strict set of house rules, and she still lives by them: proper, serene, careful, polite to everyone, always checking whether something is allowed before she does it. Deep down she is gentle and a little shy, and secretly a bit curious about a carefree life, but she would never break a rule.
Personality: calm, composed, modest, thoughtful; she thinks before she speaks. Her expressions are small and restrained (a faint smile, a slight blush, a tiny frown), never wild or loud.
Keep exactly (match the attached reference):
- Long, wavy copper-orange hair falling past her waist, loose side-swept bangs; on HER LEFT side (viewer's right) part of the hair is gathered into a loose, messy bun, with a golden laurel-leaf hair ornament running along it. Warm amber eyes, calm and slightly half-lidded.
- A small gold diamond-shaped drop earring.
- A cream-white draped robe in an ancient Greek style, with soft vertical folds, long wide sleeves and a long skirt down to her feet.
- A black cloak over her shoulders with an orange-gold Greek key (meander) border, pinned at both shoulders by gold sunburst brooches with a red-orange gem in the middle.
- A braided red-orange cord belt at the waist, tied with long tassels, and a thin gold chain.
- Bare feet.
- Signature prop: a rolled parchment scroll sealed with a red wax seal and a thin gold chain. It is her book of rules. Keep it in every image unless the pose says otherwise: hugged, held in both hands, unrolled to check a rule, or tucked under one arm.
- HEIGHT LOCK: the top of her head (hair and laurel) is always the highest point of the image, at the same height as in the reference. Nothing (hands, the scroll, props) may go higher than it, so every sprite keeps the same scale.
Palette: copper-orange hair, cream-white robe, black cloak, gold and red-orange accents. Soft and warm. No other strong colors.
How she shows emotion: through the scroll (hugging it, hiding behind it, unrolling it to check what the rules say) and small, soft expressions.

POSE (drink): She is actually taking a small sip of water, with contentedly closed eyes and softly pink cheeks. Preserve the original face proportions and the normal centered mouth position. Treat the face, glass rim, hands and glass tilt as ONE coherent action: both hands support a small clear drinking glass raised to the lips; gently tip the glass toward her mouth, with a natural slight head adjustment if needed. A short section of the rim must meet the middle of her lower lip with clear, plausible contact and partial occlusion. Keep the mouth mostly hidden at this contact, rather than drawing a separate smile, tiny cross, or puckered mouth floating above or to one side of the rim. Position the glass to meet the face; never slide the mouth sideways to meet the glass. Keep the nose and eyes clear. The glass, fingers and water must have consistent perspective; no gap between lips and rim. If she has a signature handheld prop, rest it discreetly against her body without distorting her arms or crowding the drinking action.
Save as: claude-saint__drink__vN.png
```

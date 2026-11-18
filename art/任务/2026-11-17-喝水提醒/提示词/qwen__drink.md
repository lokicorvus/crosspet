# 千问 Qwen · drink · 喝水

- 保存到：`art/任务/2026-11-17-喝水提醒/成品/qwen__drink__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `characters/qwen/idle.webp`（设计参考）
  2. `docs/prompts/ref-qwen.webp`（设计参考）
  3. `characters/qwen/portrait.webp`（设计参考）

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

CHARACTER LOCK — Qwen, the anime-girl personification of Qwen (Alibaba's AI), a gentle and generous young lady from a wealthy family.
Personality: warm, gracious, generous and well-mannered; she loves treating everyone (buying milk tea for the whole office is normal to her) and thinks sharing good things is simply natural. Never arrogant, never mean: a soft, kind "rich big-sister" smile. A little sheltered and easygoing about money, which makes her endearing rather than snobbish.
Keep exactly:
- Very long, wavy periwinkle-blue hair down past the waist, side-swept bangs, a braided crown on her left side (viewer's right) and one long braid falling over her left shoulder (viewer's right).
- Big round violet-blue eyes with bright highlights, soft pink blush.
- A small dark-navy hat worn tilted on the viewer's left side of her head, with a white fur trim, a white ribbon bow, a gold-framed round blue emblem (a white stylized knot shape) and small blue tassels.
- Gold drop earrings with small blue gems.
- White mandarin-collar dress with gold frog buttons and faint white floral embroidery; a dark-navy wide-sleeved over-robe with gold Greek-key borders; a blue front skirt panel with a blue ribbon bow and a round emblem brooch at the waist; blue tassels with gold knots hanging from the waist; a white frilly underskirt; white gloves; navy heels with small gold anklet charms.
- Signature prop: a blue folding fan with gold ribs and a white leaf pattern. Keep it in her hand in most poses unless the pose says otherwise.
- Secondary prop: a small white-and-gold handbag with the same round emblem. Draw it ONLY when a pose mentions it.
Palette: periwinkle blue, dark navy, white and soft gold. Keep it elegant; no other strong colors.
How she shows emotion: gracefully, mostly with the fan. Laughing = fan raised to cover her mouth with smiling closed eyes; thinking = closed fan tapping her chin; shy = fan hiding the lower half of her face; pleased = fan opened with a gentle flourish; upset = fan snapped shut. Expressions are bright and open (like the reference's happy open-mouth smile), but always gentle and lady-like, never loud.

POSE (drink): She is actually taking a small sip of water, with contentedly closed eyes and softly pink cheeks. Preserve the original face proportions and the normal centered mouth position. Treat the face, glass rim, hands and glass tilt as ONE coherent action: both hands support a small clear drinking glass raised to the lips; gently tip the glass toward her mouth, with a natural slight head adjustment if needed. A short section of the rim must meet the middle of her lower lip with clear, plausible contact and partial occlusion. Keep the mouth mostly hidden at this contact, rather than drawing a separate smile, tiny cross, or puckered mouth floating above or to one side of the rim. Position the glass to meet the face; never slide the mouth sideways to meet the glass. Keep the nose and eyes clear. The glass, fingers and water must have consistent perspective; no gap between lips and rim. If she has a signature handheld prop, rest it discreetly against her body without distorting her arms or crowding the drinking action.
Save as: qwen__drink__vN.png
```

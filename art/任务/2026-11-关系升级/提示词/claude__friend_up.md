# Claude · friend_up · 关系升级

- 保存到：`art/任务/2026-11-关系升级/成品/claude__friend_up__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `characters/claude/idle.webp`（设计参考）
  2. `docs/prompts/ref-claude.webp`（设计参考）
  3. `characters/claude/portrait.webp`（设计参考）

## 提示词

```text
You are drawing desktop-pet sprites for an existing chibi character. The attached images are the ONLY design reference.

FORMAT RULES (every image):
- Real transparent background (generate with transparent_background: true). Nothing else: no floor, no cast shadow, no glow, no vignette, no frame. Keep complete, clean edges. If an attached reference image has a plain white background, that is only because it was made before transparent output was available: do NOT copy the white background.
- No text, no letters, no speech bubbles, no symbols (no ?, !, hearts, music notes, Zzz, sparkles, sweat-drop icons floating in the air). The app draws all effects itself.
- Exactly one character, full body, standing, centered, facing the viewer like the reference. Head near the top and feet near the bottom; she fills about 90% of the image height, the same scale and position as the reference.
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
- Signature prop: a dark brown hardcover book with an orange flower emblem. Keep it in every image unless the pose says otherwise.
How she shows emotion: through the book (hugging it, hiding behind it, reading it) and small, soft expressions. Never wild or loud.

POSE (friend_up): Touched and happy about a new friendship: cheeks blushing, eyes softly curved in a warm, slightly shy smile; holding a small soft heart-shaped plush cushion (pastel pink, a real object in her hands, not a floating symbol) against her chest with both hands, shoulders lifted a little as if her heart just skipped.
Save as: claude__friend_up__vN.png
```

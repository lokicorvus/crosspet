# 彩蛋 · Gemini 来玩毛衣 DeepSeek 的毛线 · caught · 彩蛋·被识破

- 保存到：`art/任务/2026-11-彩蛋-Gemini玩毛线/成品/egg-gemini-yarn__caught__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `characters/gemini/idle.webp`（设计参考）
  2. `docs/prompts/ref-gemini.webp`（设计参考）
  3. `characters/deepseek-knit/idle.webp`（设计参考）

## 提示词

```text
You are drawing a small set of gentle, funny desktop-pet sprites for an EASTER EGG: once in a while another character pops in for a short visit and plays a tiny 5-frame story (pop in -> act -> get caught -> say bye, or slip away unnoticed). Cute and wholesome, like a fan-comic gag. Follow the attached references for every character and costume detail.

FORMAT RULES (every image):
- Real transparent background (generate with transparent_background: true). No floor, no ground shadow, no glow, no frame. Keep complete, clean edges. If an attached reference image has a plain white background, that is only because it was made before transparent output was available: do NOT copy the white background.
- No text, no letters, no speech bubbles, no floating symbols (no ?, !, hearts, Zzz, sweat-drop icons in the air, motion lines). Sweat drops and blush ON the face are fine.
- Exactly one character, full body, centered; head near the top and feet near the bottom; she fills about 90% of the image height, the same scale as the reference, with a clear band of empty background above the highest point of her head (hats, crowns and ahoge included).
- Props she carries must TOUCH her or her hands; nothing floats detached in the air (the app deletes detached pieces).
- A continuous closed dark outline around the whole silhouette.
- Same art style as the references: clean lineart, flat two-tone cel shading, soft palette, chibi about 2.5 heads tall, big head, round soft shapes.
- Square image, 1024x1024 or larger. One image per file, saved under the exact path given.

CHARACTER LOCK — Gemini, the starry cat girl, anime-girl personification of Gemini (Google).
Personality: bright, playful, mischievous, curious and quick; a little smug (the ":3" cat smile); the "twin" theme shows as two-sided moods, from teasing to sweet.
Keep exactly:
- Long voluminous wavy hair, blue-violet at the top fading to pink-magenta at the tips; one curled ahoge; two small side buns.
- Blue-violet cat ears with pink inner fur and white fluff.
- Heterochromia: HER RIGHT eye (viewer's left) is pink-magenta, HER LEFT eye (viewer's right) is amber-gold. Keep this exactly.
- A large iridescent four-pointed star hairclip with gold rim on her left side (viewer's right) with small dangling star charms; small star earrings.
- Navy crop-top with a high collar and star gems, white off-shoulder sleeves with navy cuffs, a violet sash, a navy skirt over a white frilly petticoat, iridescent four-pointed star charms hanging from the outfit, white leg warmers, navy-violet platform shoes.
- A fluffy blue-violet cat tail on the viewer's right.
How she shows emotion: cat body language. Ears perk up or flatten, tail puffs, curls or swishes; cat-like poses (paw hands, stretching like a cat). The ":3" smile is her default.
- HEIGHT LOCK: the tip of her ahoge is always the highest point of the image (it pokes up through anything on her head). Nothing (paws, yarn, needles) may go higher than it, so every sprite keeps the same scale as the first reference.

SCENE: DeepSeek (the THIRD attached reference) is wearing her cream-white cable-knit sweater. Gemini the cat girl has found a loose thread on it and cannot resist playing with the yarn. DeepSeek herself never appears in these images. Only the yarn may come from her: soft cream-white chunky yarn, exactly the color and texture of DeepSeek's sweater in the third reference. Do not copy anything else from DeepSeek (no navy hair, no whale tail, no beret, no sweater on Gemini). Match Gemini's design to the FIRST two references.

POSE (caught): Completely tangled in the cream yarn: loops wrapped around her arms, body and tail, a few loops around one ear; only her face and paws poke out; ears flat, tail fluffed up like a bottle brush, a flustered open-mouthed face with a sweat drop, as if protesting "it wasn't me!".
Save as: egg-gemini-yarn__caught__vN.png
```

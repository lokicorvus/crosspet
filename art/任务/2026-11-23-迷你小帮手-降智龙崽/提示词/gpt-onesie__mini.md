# GPT · 降智龙崽 · mini · 迷你小帮手（好感度礼物）

- 保存到：`art/任务/2026-11-23-迷你小帮手-降智龙崽/成品/gpt-onesie__mini__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `characters/gpt-onesie/raw/delegating.png`（底图：delegating（现在用的那张））
  2. `characters/gpt-onesie/idle.webp`（设计参考）
  3. `characters/gpt-onesie/portrait.webp`（设计参考）
  4. `docs/prompts/mini-style-claude.webp`（画风参考：只看小人的比例、线条和上色，不要照它画人物）

## 提示词

```text
Create a sprite sheet of a tiny "mini helper" version of the approved character. It is a desktop-pet companion shown at about 50 pixels tall next to her, so it must read clearly when very small.

REFERENCE: The first attachment (delegating) shows her sending out tiny helpers. The mini is always a tiny version of HER, never an animal, mascot or pet, even if the helpers in that image are animals. The LAST attachment is the approved mini sheet of another character in this app: match its proportions, head size, outline weight, flat shading and level of detail exactly so all the minis look like one set, but draw THIS character, not that one. The mini look: super-deformed, about 2 heads tall, very big head, short limbs, simplified outfit, but the same hair color and shape, hair ornament (on the same side), key outfit colors and signature prop, so it reads as her at a glance. The other attachments are the approved character design: follow them for colors and which side each ornament is on. Do not draw the big character.

LAYOUT: One square image, at least 1024x1024, with a real transparent background (transparent_background: true). Exactly four minis of the same character in a 2x2 grid, one per quadrant, each centered in its quadrant and drawn at the same scale (each about 380 px tall). Leave wide transparent gaps: no part of one mini may touch another mini or the image edge.

THE FOUR POSES, in this order (top-left, top-right, bottom-left, bottom-right):
1. idle: standing and facing the viewer, small calm smile, holding her prop.
2. happy: jumping with both arms raised (her prop in one hand), eyes closed in a happy ^^ smile, both feet off the ground.
3. sleep: sitting curled up and dozing, eyes closed, head tilted, prop hugged to her chest.
4. walk: walking toward the viewer's RIGHT in three-quarter view, mid-step, prop under one arm.

FORMAT: A thick, continuous dark outline around each whole silhouette; flat two-tone cel shading; few, chunky details and no thin lines that vanish when shrunk. No floor, cast shadow, glow, frame, text, letters, symbols, hearts, Zzz, sparkles or other effects: the app draws all effects itself.

CHARACTER LOCK — GPT (the white dragon girl, anime-girl personification of GPT) in her "dragon-cub onesie" skin, an alternate outfit. In this outfit she is a sweet, slightly airheaded version of herself: gentle, a half-beat slow to react, absent-minded and curious, quietly over-careful. Soft and cute, NEVER dumb or mocked: no drool, no crossed eyes, no blank or dead eyes, no silly faces.
Keep exactly:
- Very long, wavy WHITE hair (soft lavender tint only in the shadows) flowing out from under the hood over her shoulders. The hood completely covers the crown, with a smooth arc of lavender fabric between its two stuffed horns. White hair is visible only at the hood opening and from underneath its edges. No ahoge or tuft may poke out of the crown.
- Big round pale-lavender eyes with soft round highlights; soft pink blush.
- An oversized lavender dragon-cub onesie with dashed stitch lines. The hood is always up, with two cream stuffed horns (the one on the viewer's left flops over slightly). The long sleeves hide her hands ("sleeve-paws"); when she holds something, she grips it with the sleeve ends or only her fingertips peek out.
- A cream belly with stitched scale lines, and on its center a handmade white felt knot patch (six interlaced rounded loops, lavender running stitches around it, one short loose thread dangling below). Whenever her front is visible, this patch must be visible and recognizable.
- Round cream footies with stitched claws; small lavender plush wings with cream undersides on her back; a fat stuffed lavender tail with cream spikes curling out on the viewer's right.
- Her real horns, elf ears and dress are NOT drawn. NO other knot ornaments, NO tassels, NO hair accessories.
Palette: lavender onesie, cream belly / horns / paws / spikes, white hair, pale-pink blush. Keep it soft; never add strong colors.
How she shows emotion: soft and small. Head tilts, the floppy stuffed horn droops or perks up, long sleeves flop, plush wings flutter or droop, the tail sways. Even big emotions stay gentle: a small hop, a little "o" mouth, a closed-eye smile. No wide grins, no shouting.

POSE (mini): Her own cute versions of the four poses, in the same order and with the same meaning (the app uses them that way): Her signature prop in all her mini sheets is a small round cream cookie with one bite missing, held with her sleeve-paws (her hands always stay hidden in the long sleeves). Keep the felt knot patch on her belly whenever her front is visible. She is extra soft and cute: round squishy cheeks, a sleepy-sweet face, the floppy stuffed horn and long empty sleeve tips doing the acting. 1. idle: standing a little pigeon-toed, nibbling the cookie held up in both sleeve-paws, cheeks puffed, head tilted, the floppy horn drooping. 2. happy: a small bouncy hop with both floppy sleeves flung up (the cookie in one of them), eyes closed in a ^^ smile, plush wings fluttering, tail curled up. 3. sleep: curled up into a round ball like a dragon egg, the hood pulled down over her eyes, her fat tail wrapped around her, the cookie hugged to her chest. 4. walk: toddling toward the viewer's RIGHT with a waddling step, long sleeves swinging, tail swaying, the cookie in one sleeve-paw.
Save as: gpt-onesie__mini__vN.png
```

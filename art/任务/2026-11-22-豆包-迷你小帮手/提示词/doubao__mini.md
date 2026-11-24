# 豆包 · mini · 迷你小帮手（好感度礼物）

- 保存到：`art/任务/2026-11-22-豆包-迷你小帮手/成品/doubao__mini__vN.png`：N 换成下一个没用过的数字（还没有就是 v1，已经有 v1、v2 就存 v3）。**每画一次都存新的一版，不要覆盖、删除、挪走旧的**（PNG，透明背景，生图时开 `transparent_background: true`）
- 附件（按顺序附上）：
  1. `art/任务/2026-11-22-豆包-整套/成品/doubao__delegating__v1.png`（底图：delegating（现在用的那张））
  2. `art/原图/doubao/idle/v1.png`（设计参考）
  3. `docs/prompts/mini-style-claude.webp`（画风参考：只看小人的比例、线条和上色，不要照它画人物）

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

CHARACTER LOCK — Doubao, the anime-girl personification of Doubao (ByteDance's AI assistant, built by the Seed team). A bright, friendly, chatty everyday helper: cheerful, quick to react, a little scatterbrained, always ready to chat. Her default face is a big happy open-mouthed smile.
Keep exactly (match the attached reference):
- Long wavy hair, lavender-purple at the top fading to aqua-cyan toward the tips; side bangs; a high side ponytail on HER LEFT side (viewer's right), tied with two glossy ring-shaped hair ornaments (one purple, one aqua-cyan) and a small looped bun. Do not mirror the ponytail.
- Big round violet eyes, light pink blush; a thin dark upper lash line without a heavy winged tip.
- A white sleeveless cropped top with a dark-blue pointed collar and a large purple-blue ring logo on the chest; a lanyard with a small white ID badge showing the ring logo.
- Detached puffy white sleeves with purple bands at the upper arm and aqua-cyan cuffs.
- A blue belt with a silver buckle; a small grey digital voice recorder hanging from the belt on a short chain, with a blue tag (ring logo only).
- A white pleated mini skirt over an aqua layer; long asymmetric translucent coat-tails behind and beside the skirt, fading from purple to aqua-cyan, with a dotted halftone pattern and a ring logo on the viewer's right tail.
- On HER RIGHT thigh (viewer's left): a thin purple garter with a small aqua diamond.
- Mismatched socks: HER RIGHT leg (viewer's left) a purple sock with a small white checker band; HER LEFT leg (viewer's right) a white sock with an aqua-blue band.
- Chunky white high-top sneakers with blue and purple straps.
- No text, letters or numbers anywhere on her clothes, badges or props; the ring logo has no word under it.
- SIGNATURE PROP, THE DOUBAO MASCOT HEAD: a soft plush mascot head (a costume head she can wear) in the style of the Doubao app icon: a round pale face with a brown bob haircut, small round black eyes, tiny eyebrows and a small round "o" mouth, the same size as in the reference. It is a soft prop, not a second character: its face never changes expression. By default she hugs it under one arm. When the pose does not mention it, it is not in the picture; it never floats or sits apart from her. When she WEARS it over her head, her own ponytail with the ring ornaments still sticks out on HER LEFT side so she stays recognizable, and the worn head never goes higher than the HEIGHT LOCK.
- SIGNATURE PROP, THE SPINNING STAR: a small solid four-pointed spinning-top star with a glossy gradient from gold-orange to sky blue. Only when the pose mentions it; it rests on or touches her hand. No glow, no orbit lines, no sparkles.
- PROPORTIONS: the same chibi proportions as the reference: big round head with the chin at about 45% of her height, short soft chubby legs (skirt hem to soles about 20% of her height), short stubby arms.
- HEIGHT LOCK: the top of her looped bun and ring ornaments is the highest point of the image, at the same height as in the reference. Nothing (hands, props, the mascot head) may go higher than it, so every sprite keeps the same scale.
Palette: white, lavender-purple, aqua-cyan and royal blue, with the brown of the mascot head. No other strong colors.
How she shows emotion: big open expressions, bouncing on her toes, the ponytail swinging, and the mascot head: she hugs it when happy, squeezes it when nervous, hides behind it when shy, and pulls it on over her head when she is embarrassed or sulking.

POSE (mini): Her tiny helper look: a super-deformed mini of HER (never the mascot head on its own), hugging a shrunken plush mascot head under one arm. The PROPORTIONS and HEIGHT LOCK lines above are for the full-size character; for the mini follow the mini style reference instead (about 2 heads tall). Keep what reads at 50 px: the purple-to-aqua wavy hair, the high side ponytail with its two ring ornaments on HER LEFT side, the white cropped top with the ring logo, puffy white sleeves with aqua cuffs, the white skirt with two short purple-to-aqua coat-tails, the mismatched socks (purple on her right leg, white on her left) and white sneakers. Leave out the voice recorder, lanyard, badge and garter; no spinning star.
Save as: doubao__mini__vN.png
```

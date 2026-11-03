# 补画两张展示图：圣女 Claude、毛衣 DeepSeek

这两套皮肤是后来加的，换角色窗口里她们的衣服卡现在还拿待机图顶着。做法和 [01-展示图（衣服卡）.md](01-展示图（衣服卡）.md) 一样，下面把每张要发的内容拼好了，整段复制就行。

| 卡片 | 存到 | 附件 1（设计参考） | 附件 2（只当画风参考） |
|---|---|---|---|
| Claude · 圣女 | `characters/claude-saint/raw/portrait.png` | `characters/claude-saint/raw/idle.png` | `characters/claude/raw/portrait.png` |
| DeepSeek · 毛衣 | `characters/deepseek-knit/raw/portrait.png` | `characters/deepseek-knit/raw/idle.png` | `characters/deepseek/raw/portrait.png` |

- 尺寸竖版 **1024×1536**，**不开透明背景**。
- 附件 2 是同一个角色原版的展示图，让背景的浓淡、画法和已有的卡片一致。
- 画好存到上表的位置，告诉 Claude 导入（保留背景，按卡片裁好、和其他卡片的人物大小对齐）。

## 1. Claude · 圣女

```
You are drawing a CHARACTER CARD illustration for an existing chibi character, like the full card art in a gacha game's character select screen: the character in a showcase pose, in front of a background scene that fits her outfit and personality. The first attached image is the ONLY design reference for the character (its plain white background is not part of the design; ignore it).

FORMAT RULES:
- A full illustrated BACKGROUND that fills the whole image edge to edge (no transparency, no blank areas, no frame, no card border). The scene is described in the POSE line. Keep the background softer than the character: slightly lower contrast and saturation, simple shapes, a gentle depth blur, so she clearly pops out in front of it. Light the scene so it matches her colors.
- No text, no letters, no numbers, no signs with writing, no logos other than those already on her outfit, no speech bubbles. Small scene effects that belong to the background (falling snow, petals, stars in the sky, floating bubbles) are fine, but nothing covers her face.
- Portrait image 1024x1536 (2:3), the largest size available. LEAVE GENEROUS ROOM: this picture will be cropped later, so draw her a bit small and paint plenty of background all around her. Exactly one character, full body, standing on the ground of the scene, centered. She fills only about 60% of the image height: at least 15% of empty background above her head, at least 12% below her feet, and wide background on both sides. Nothing important (her hands, props, tail, ahoge) may touch or cross the image edges. The background continues naturally all the way to every edge.
- If a second image is attached as "style reference only", paint the background with the same softness and level of detail, but ignore its character, scene and framing.
- A clean dark outline around the character so she reads clearly against the background.
- Same art style as the reference: clean lineart, flat two-tone cel shading on the character, chibi about 2.5 heads tall, big head, round soft shapes. This is a showcase picture, so draw it with more care and detail than a normal sprite (cleaner hair strands, crisp ornaments, a pleasing background), but it must still look like the same character in the same style.
- Hair, accessories, outfit, colors and body features stay EXACTLY as in the reference.
- A confident "this is me!" showcase pose: a slight three-quarter turn toward the viewer, eyes looking at the viewer, a pose that shows off her signature items. Keep the pose compact: elbows bent, hands close to her body, no long stretched arms. Every prop she holds TOUCHES her hand.

CHARACTER LOCK — Claude as the Saint: an alternate skin of Claude, the anime-girl personification of Claude (Anthropic). She grew up as a "saint" under a very strict set of house rules, and she still lives by them: proper, serene, careful, polite to everyone, always checking whether something is allowed before she does it. Deep down she is gentle and a little shy, and secretly a bit curious about a carefree life, but she would never break a rule.
Personality: calm, composed, modest, thoughtful; she thinks before she speaks. Her expressions are small and restrained (a faint smile, a slight blush, a tiny frown), never wild or loud.
Keep exactly (match the attached reference):
- Long, wavy copper-orange hair falling past her waist, loose side-swept bangs; on HER LEFT side (viewer's right) part of the hair is gathered into a loose, messy bun, with a golden laurel-leaf hair ornament running along it. Warm amber eyes, calm and slightly half-lidded.
- A small gold diamond-shaped drop earring.
- A cream-white draped robe in an ancient Greek style, with soft vertical folds, long wide sleeves and a long skirt down to her feet.
- A black cloak over her shoulders with an orange-gold Greek key (meander) border, pinned at both shoulders by gold sunburst brooches with a red-orange gem in the middle.
- A braided red-orange cord belt at the waist, tied with long tassels, and a thin gold chain.
- Bare feet.
- Signature prop: a rolled parchment scroll sealed with a red wax seal and a thin gold chain. It is her book of rules.
Palette: copper-orange hair, cream-white robe, black cloak, gold and red-orange accents. Soft and warm. No other strong colors.

POSE (save as portrait.png) — Claude the Saint: standing serenely with her rule scroll held in both hands in front of her chest, partly unrolled so a little of the blank parchment shows (no writing on it), the red wax seal and gold chain hanging down; a slight graceful bow of the head toward the viewer, a calm, faint smile with a light blush; the black cloak and the cord-belt tassels swaying softly, bare toes peeking out under the hem.
BACKGROUND: a sunlit ancient Greek temple terrace in late afternoon: white marble columns and steps, an olive tree with silvery leaves, a warm golden sky with soft clouds, a few small golden laurel leaves drifting in the light.
```

## 2. DeepSeek · 毛衣

```
You are drawing a CHARACTER CARD illustration for an existing chibi character, like the full card art in a gacha game's character select screen: the character in a showcase pose, in front of a background scene that fits her outfit and personality. The first attached image is the ONLY design reference for the character (its plain white background is not part of the design; ignore it).

FORMAT RULES:
- A full illustrated BACKGROUND that fills the whole image edge to edge (no transparency, no blank areas, no frame, no card border). The scene is described in the POSE line. Keep the background softer than the character: slightly lower contrast and saturation, simple shapes, a gentle depth blur, so she clearly pops out in front of it. Light the scene so it matches her colors.
- No text, no letters, no numbers, no signs with writing, no logos other than those already on her outfit, no speech bubbles. Small scene effects that belong to the background (falling snow, petals, stars in the sky, floating bubbles) are fine, but nothing covers her face.
- Portrait image 1024x1536 (2:3), the largest size available. LEAVE GENEROUS ROOM: this picture will be cropped later, so draw her a bit small and paint plenty of background all around her. Exactly one character, full body, standing on the ground of the scene, centered. She fills only about 60% of the image height: at least 15% of empty background above her head, at least 12% below her feet, and wide background on both sides. Nothing important (her hands, props, tail, ahoge) may touch or cross the image edges. The background continues naturally all the way to every edge.
- If a second image is attached as "style reference only", paint the background with the same softness and level of detail, but ignore its character, scene and framing.
- A clean dark outline around the character so she reads clearly against the background.
- Same art style as the reference: clean lineart, flat two-tone cel shading on the character, chibi about 2.5 heads tall, big head, round soft shapes. This is a showcase picture, so draw it with more care and detail than a normal sprite (cleaner hair strands, crisp ornaments, a pleasing background), but it must still look like the same character in the same style.
- Hair, accessories, outfit, colors and body features stay EXACTLY as in the reference.
- A confident "this is me!" showcase pose: a slight three-quarter turn toward the viewer, eyes looking at the viewer, a pose that shows off her signature items. Keep the pose compact: elbows bent, hands close to her body, no long stretched arms. Every prop she holds TOUCHES her hand.

CHARACTER LOCK — DeepSeek in her knit sweater outfit: an alternate skin of DeepSeek, the blue whale girl (anime-girl personification of DeepSeek), dressed up cozy and cute for a cool autumn day out.
Personality: cheerful, energetic, curious; secretly a bit lazy; tsundere and sweet-talking; loves white rice; absolutely refuses to be called fat (and is a little worried the chunky sweater makes her look round). Big, open, readable expressions.
Keep exactly (match the attached reference):
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one big curled ahoge sticking up out of the top of the beret, curling to the viewer's left. Big round bright-blue eyes, pink blush.
- Dark navy whale-fin ears with white fluffy undersides, sticking out sideways from her hair at eye level, one on each side.
- A big slouchy cream-white chunky cable-knit beret worn on the back of her head. On the viewer's RIGHT side of the beret: a small blue whale pin, and just below it a navy ribbon bow with a white pom-pom hanging from it. These are on the viewer's right only.
- An oversized cream-white cable-knit turtleneck sweater with a big navy spouting whale knitted on the front; long sleeves that half cover her hands (sweater paws), a small navy bow on each sleeve.
- A thin navy strap worn across her body from her shoulder on the viewer's right down to a small round navy-and-white whale-shaped bag at her hip on the viewer's LEFT, with a white pom-pom charm on the bag.
- A navy tartan pleated skirt with a small white ribbon bow on the viewer's right.
- Cream-white knit leg warmers with a navy bow on each, and navy round-toe Mary Jane shoes.
- Her big whale tail, navy fading to blue with a white underside, curling out from behind her on the viewer's right.
Palette: navy-to-blue hair and tail, cream-white knits, navy tartan. Soft, warm, cozy.

POSE (save as portrait.png) — DeepSeek in the knit sweater: both sweater-paw hands pinching the hem of the sweater and pulling it out a little to proudly show off the big knitted whale on the front, one Mary Jane shoe lifted behind her in a cute little kick; a big bright grin with one eye winking, cheeks pink; the whale bag swinging at her hip, the beret's pom-pom bouncing, whale tail curled up high and wagging.
BACKGROUND: a cozy autumn park path in the afternoon: trees with warm orange and golden leaves, a few leaves drifting down, a wooden bench, a small café with a warm glowing window in the distance, soft pale blue sky.
```

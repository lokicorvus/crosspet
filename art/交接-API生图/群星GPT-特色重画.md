# 群星 GPT（Astra）：特色重画

现在这套是照原版 GPT 的动作一张张换衣服画出来的，所以和原版太像，看不出「群星 / 观星者」的身份。下面挑了 8 张，用观星的道具和尾巴、翅膀的变化把特点画出来。其余的保留。文末还有一个配套彩蛋（5 张），可以一起画。

## 通用要求

- 接口和参数照 [新角色与新皮肤.md](新角色与新皮肤.md) 第 0 节。
- **附件只附一张**：这套里画好的 `idle.png`（群星的定妆图）。不要附原版 GPT 的图，也不要附这套里之前画的同名姿态图，否则会照着旧动作画回去。
- 每张单独调用，**只画 1 版**，作者看过不满意再单独说要重画哪张。文件命名为 `gpt-astra__<姿态>__v<N>.png`。
- 下面每张的提示词都已经拼好了，整段复制，一字不改。
- 共用的「群星角色锁定」已经写进每一段。它和原来的区别是加了「观星者的身份怎么表现」一句：用手里的道具、腰上的星环和卷成月牙的尾巴来表现，星星只能印在、刻在或绣在东西上，不能飘在空中。

| # | 姿态 | 现在的问题 / 要改成什么 |
|---|---|---|
| 1 | portrait 选角色页展示图 | 现在是原版 GPT 的白天云上城堡场景，只换了衣服。改成夜空观星台：星空、带环的行星、月牙、望远镜 |
| 2 | thinking 思考 | 现在和原版 GPT 一样是手指点下巴。改成仰头认星座，手里拿星盘。 |
| 3 | searching 搜索 | 现在拿的是放大镜，换成观星的小望远镜。 |
| 4 | reading 读文件 | 现在捧的是一本白色的书，换成星图卷轴。 |
| 5 | proud 大活完成 | 原版 proud 有皇冠，这版漏了。改成星月发冠，尾巴卷成月牙。 |
| 6 | sleeping 睡着 | 现在只是站着闭眼。改成抱着月牙抱枕打瞌睡，翅膀拢起来。 |
| 7 | greet_night 晚安 | 现在端着一杯茶。改成提一盏镂空星星的小灯，向你道晚安。 |
| 8 | delegating 派小帮手 | 三只小龙是飘在半空的，桌宠程序会把不贴着身体的部分删掉。改成小龙停在她身上，顺便换成星空的样子。 |

portrait-card 是 portrait 缩小后的版本，不用单独画，作者会从 portrait 自己裁。

---

## 1. portrait · 选角色页展示图

- 参数：`background: "opaque"`、`size: "1024x1536"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__portrait__vN.png`

```text
Create one character-select showcase illustration with a complete softly illustrated background. Use the listed approved character reference for identity and style. Use a 2:3 portrait canvas, at least 1024×1536, transparent_background=false. Keep the complete character around 60% of canvas height with generous scene margins on all sides. The background fills every edge and stays softer and lower contrast than the character. No captions, interface elements, card border or additional characters. Preserve the approved chibi face, costume and anatomical sides of ornaments. Keep compact short arms and all props touching the hands.

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- PROPORTION LOCK: keep the compact chibi proportions of the reference; the horn tips are the highest point of her figure.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE AND SCENE (portrait): The setting is a quiet stargazing terrace above a sea of clouds at night. A deep midnight-blue to violet sky full of small stars and a soft milky way band; a large pale ringed planet low in the sky on one side and a slim crescent moon on the other; the cloud sea below is silvery lavender, lit by moonlight. Beside her on the viewer's left stands a small brass telescope on a slim tripod, pointing at the sky. The background is painted softly, with lower contrast and less detail than the character, so she stays the clearest thing in the picture; soft cool moonlight rims her hair, horns and wings. No sun, no daylight, no castle, no other characters.
She stands on the terrace facing the viewer with a slight three-quarter turn: one hand lightly touches the gold crescent ornament on her shoulder, the other rests on the telescope's tube. Wings half open, her tail curling into a crescent-moon shape near her feet. Calm, knowing little smile, both eyes open and looking at the viewer.
Save as: gpt-astra__portrait__vN.png
```

---

## 2. thinking · 思考

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__thinking__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (thinking): Quietly working out a constellation: head tilted slightly back and to one side, both pupils glancing up toward the viewer's upper left as a coordinated pair. The index finger of one hand is raised near her chin as if tracing an invisible line between stars (no line is drawn). Her other hand holds a small flat brass astrolabe, a palm-sized disc with engraved rings and a little pointer, at waist height. A faint curious "hm" mouth, one eyebrow slightly raised. Wings relaxed, tail tip curling lazily. No floating stars, lines or symbols.
Save as: gpt-astra__thinking__vN.png
```

---

## 3. searching · 搜索

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__searching__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (searching): Searching the sky: she holds a short collapsible brass telescope with navy leather grips in both hands and looks through it with HER RIGHT eye (viewer's left), the telescope pointing up toward the viewer's upper left. The telescope is short, no longer than her forearm, and stays below her horn tips. Her other eye stays open and naturally relaxed, eyebrow slightly lifted in concentration, a small pressed mouth. Feet planted, wings half raised with interest, tail tip lifted. The telescope must not cover her whole face.
Save as: gpt-astra__searching__vN.png
```

---

## 4. reading · 读文件

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__reading__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (reading): Reading a navy star-chart scroll: a partly unrolled scroll of deep navy paper held open at chest height with both hands, the two rolled ends visible. The chart is printed with small gold dots joined by thin gold lines (constellations) and a faint circular grid; no readable letters or numbers. Her eyes look down at the chart naturally, both pupils resting on the same spot, upper lids relaxed, a calm knowing little smile. Tail curling around her feet. No book.
Save as: gpt-astra__reading__vN.png
```

---

## 5. proud · 大活完成

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__proud__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (proud): Proud after finishing a big job: standing tall, both wings fully spread, one hand on her hip and the other open palm-up at shoulder height as if presenting the night sky. She wears a small delicate gold circlet with a tiny crescent moon and one purple gem at the front, sitting on her hair between the horns; it stays well below the horn tips. This circlet is the one allowed addition to her outfit in this pose. Her tail curls up beside her into a clear, rounded crescent-moon shape. Eyes softly half-closed, chin raised a little, a confident knowing smile.
Save as: gpt-astra__proud__vN.png
```

---

## 6. sleeping · 睡着

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__sleeping__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (sleeping): Dozing off while standing: she hugs a soft navy crescent-moon-shaped cushion with tiny embroidered gold stars against her chest, her cheek resting on its upper tip. Head tipped gently to one side, eyes peacefully closed, a tiny relaxed mouth, faint blush. Her wings fold softly forward around her shoulders like a blanket, and her tail curls around her feet. Both feet stay on the same baseline as the reference. No Zzz, no drool, no floating symbols.
Save as: gpt-astra__sleeping__vN.png
```

---

## 7. greet_night · 晚安

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__greet_night__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (greet_night): Saying good night: one hand holds up a small brass lantern by its ring handle at chest height; the lantern has star-shaped cut-outs and a soft warm light inside it (the light stays inside the lantern; no halo or glow on the background). The other hand gives a small, gentle wave beside her shoulder. Sleepy, soft half-closed eyes looking at the viewer, a small warm smile. Wings drooping a little, tail curled loosely around her feet.
Save as: gpt-astra__greet_night__vN.png
```

---

## 8. delegating · 派小帮手

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__delegating__vN.png`

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

CHARACTER LOCK — GPT as "Astra": an alternate skin of GPT, the white dragon girl (anime-girl personification of GPT / ChatGPT), dressed as a quiet stargazer of the night sky. She is the night side of herself: composed and elegant, a cool big-sister with dry humor and a little quiet mischief, as if she knows the names of all the stars.
Personality: calm, clever, a little teasing; rarely flustered, and when she is, she looks away as if checking the stars. Her expressions are small but clear (a curious "hm?", a pout, a knowing little smile, a faint blush).
Keep exactly (match the attached reference):
- Very long, wavy white hair with soft lavender shadows; one curled ahoge; pointed elf-like ears. Two large white ridged dragon horns.
- Big round pale lavender eyes with simple round highlights, a thin dark upper lash line and clearly dark pupils; no heavy eyeliner, no winged lashes.
- A white interlaced-knot hair ornament on HER LEFT side (viewer's right) with a long white tassel earring. Do not mirror it.
- Small pale-lavender bat-like dragon wings; a long, thick white scaled dragon tail curling out on the viewer's right.
- A white halter bodice with small purple diamond gems and gold trim; a slim choker with a white knot ornament; short off-shoulder navy sleeves trimmed in gold over long white ruffled sleeves; an open navy over-skirt with tiny star specks, gold trim and a gold star-and-circle emblem; a white ruffled under-skirt; white ankle boots with purple gems.
- A gold crescent-moon ornament with a purple gem on HER LEFT shoulder (viewer's right).
- A thin gold planetary ring circling her waist at a slight tilt, with a small gold sphere at the front. It is part of her outfit; she does not hold or move it.
- HEIGHT LOCK: the tips of her horns are always the highest point of the image, at the same height as in the reference. Nothing (hands, props, accessories) may go higher than them.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her tail, which curls into a clear crescent-moon shape when she is happy or proud. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings and tail may change position with each pose; their design stays the same.

POSE (delegating): Sending out little helpers: two palm-sized mini white dragons, each wearing a tiny navy cape with gold star specks, are complete little characters with visible wings, tails and feet. One sits on her open palm, held out to the viewer's left, carrying a tiny rolled navy star chart; the other perches on her shoulder (viewer's right) holding a tiny brass telescope. Both helpers TOUCH her; nothing floats in the air. She looks at the viewer with a calm, amused little smile, as if saying "you two, go". This is an explicit exception to the one-character rule: exactly these two mini dragons plus her.
Save as: gpt-astra__delegating__vN.png
```

---

## 彩蛋：DeepSeek 来找鲸鱼座

桌宠是群星 GPT 时，偶尔会有别的角色溜进来演一小段 5 张的故事。这个彩蛋的访客是吉祥物 **DeepSeek**（蓝鲸女仆，穿原版女仆装）。

**故事**：DeepSeek 听说天上有个「鲸鱼座」，认定那是她自己的星座，于是趁群星不在溜进观星台，用她的望远镜找。找到了才发现，鲸鱼座是全天最大的星座之一，画在星图上又大又圆，可她坚决不承认那是胖。被你抓到时，她眼睛周围还印着一圈目镜压出来的红印；要是没被发现，她就在星图上自己连出一个「白米饭座」。群星本人不出场，只出现她的黄铜望远镜和星图卷轴。

| # | 姿态 | 画面 |
|---|---|---|
| 1 | pop 登场 | 踮着脚溜进来，竖手指「嘘」，手里攥着一个饭团当零食 |
| 2 | pretend 装模作样 | 踮脚凑到群星的望远镜上找鲸鱼座，胳膊底下夹着星图 |
| 3 | caught 被识破 | 从望远镜上弹开，右眼周围印着一圈目镜压出的红印；星图掉开，露出一条又大又圆的鲸鱼星座 |
| 4 | bye 道别 | 鼓着腮帮子挥手（「那不是胖，是蓬松！」），把星图卷好还回来，饭团塞在卷轴里当谢礼 |
| 5 | escape 溜走 | 没人发现：靠着三脚架坐下，在星图上自己连了一个「白米饭座」，得意地看着 |

- 附件按顺序附两张：1. DeepSeek 待机图 `deepseek-idle.png`　2. DeepSeek 设定图 `deepseek-ref.png`（作者会单独发）。不要附群星的图：群星不出场，望远镜和星图已经在提示词里写清楚了。
- 透明背景、1024×1024，每张只画 1 版。命名为 `egg-deepseek-star__<姿态>__v<N>.png`。
- 五张要像同一个人在同一个场景里：望远镜、星图、饭团每次出现都是同一个，样子一致。
- 自查时多看一眼：望远镜高不能超过她的呆毛尖；道具都要碰着她；星星只能是印在星图上的金点，不要画月亮、星空或背景；星图上不能有字。

### 彩蛋 1. pop · 登场

- 附件：1. `deepseek-idle.png`　2. `deepseek-ref.png`
- 保存为：`egg-deepseek-star__pop__vN.png`

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

CHARACTER LOCK — DeepSeek, the blue whale maid girl, anime-girl personification of DeepSeek.
Personality: cheerful, energetic, curious; secretly a bit lazy; tsundere and sweet-talking; loves white rice; absolutely refuses to be called fat. Big, open, readable expressions.
Keep exactly (match the attached references):
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one curled ahoge on top.
- Dark navy whale-fin ears on both sides of her head.
- Big round bright-blue eyes, pink blush. Her eyes stay bright blue in every image.
- A big dark-navy whale tail curling out from behind her on the viewer's right.
- Her navy maid outfit: large white frilly maid headdress, a light-blue ribbon bow on the viewer's right, white frilly blouse with a navy bow tie and a small blue diamond brooch, navy waist belt with white buttons, white frilly apron with a small navy whale emblem, navy skirt with gold vine embroidery and small gold bows, navy shoes with white socks.
- HEIGHT LOCK: the tip of her ahoge is always the highest point of the image, at the same height as in the reference. Nothing (hands, props, the telescope) may go higher than it, so every sprite keeps the same scale.
How she shows emotion: with her whole body. Tail wags, droops or flicks; the ahoge bends into shapes; arms and fists move a lot.

SCENE: The white dragon stargazer "Astra" has stepped away from her stargazing terrace, and DeepSeek has sneaked in to find the Whale constellation (Cetus), which she is sure is HER constellation. Astra herself never appears in these images. Only Astra's things may appear, exactly as described here:
- ASTRA'S TELESCOPE: a small brass refractor telescope with a navy leather grip band and a tiny engraved gold star, on a slim three-legged wooden tripod. The tripod feet stand on the same ground line as DeepSeek's shoes, and the whole telescope is a little shorter than DeepSeek; its raised front end always stays lower than the tip of her ahoge. It is one solid prop and always touches DeepSeek or her hands.
- ASTRA'S STAR CHART: a scroll of deep navy paper printed with small gold dots joined by thin gold lines. When the pose shows the chart's face, the biggest figure on it is a large, round, chubby WHALE drawn as a constellation (gold dots joined by thin gold lines, outlining a plump whale with a spout). No readable text, letters or numbers.
No moon, stars or sky are drawn around her: there is no background at all. Stars exist only as gold dots printed on the star chart.

POSE (pop): Tiptoeing in on the balls of her feet, glancing around with sparkling mischievous eyes, one index finger pressed to her lips in a "shh!", the other hand clutching a small round rice ball wrapped in seaweed as a snack; a cheeky grin, ahoge perked up, tail curled up excitedly.
Save as: egg-deepseek-star__pop__vN.png
```

### 彩蛋 2. pretend · 装模作样

- 附件：1. `deepseek-idle.png`　2. `deepseek-ref.png`
- 保存为：`egg-deepseek-star__pretend__vN.png`

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

CHARACTER LOCK — DeepSeek, the blue whale maid girl, anime-girl personification of DeepSeek.
Personality: cheerful, energetic, curious; secretly a bit lazy; tsundere and sweet-talking; loves white rice; absolutely refuses to be called fat. Big, open, readable expressions.
Keep exactly (match the attached references):
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one curled ahoge on top.
- Dark navy whale-fin ears on both sides of her head.
- Big round bright-blue eyes, pink blush. Her eyes stay bright blue in every image.
- A big dark-navy whale tail curling out from behind her on the viewer's right.
- Her navy maid outfit: large white frilly maid headdress, a light-blue ribbon bow on the viewer's right, white frilly blouse with a navy bow tie and a small blue diamond brooch, navy waist belt with white buttons, white frilly apron with a small navy whale emblem, navy skirt with gold vine embroidery and small gold bows, navy shoes with white socks.
- HEIGHT LOCK: the tip of her ahoge is always the highest point of the image, at the same height as in the reference. Nothing (hands, props, the telescope) may go higher than it, so every sprite keeps the same scale.
How she shows emotion: with her whole body. Tail wags, droops or flicks; the ahoge bends into shapes; arms and fists move a lot.

SCENE: The white dragon stargazer "Astra" has stepped away from her stargazing terrace, and DeepSeek has sneaked in to find the Whale constellation (Cetus), which she is sure is HER constellation. Astra herself never appears in these images. Only Astra's things may appear, exactly as described here:
- ASTRA'S TELESCOPE: a small brass refractor telescope with a navy leather grip band and a tiny engraved gold star, on a slim three-legged wooden tripod. The tripod feet stand on the same ground line as DeepSeek's shoes, and the whole telescope is a little shorter than DeepSeek; its raised front end always stays lower than the tip of her ahoge. It is one solid prop and always touches DeepSeek or her hands.
- ASTRA'S STAR CHART: a scroll of deep navy paper printed with small gold dots joined by thin gold lines. When the pose shows the chart's face, the biggest figure on it is a large, round, chubby WHALE drawn as a constellation (gold dots joined by thin gold lines, outlining a plump whale with a spout). No readable text, letters or numbers.
No moon, stars or sky are drawn around her: there is no background at all. Stars exist only as gold dots printed on the star chart.

POSE (pretend): Standing on tiptoe at Astra's telescope, which stands on its tripod right beside her on the viewer's left and points up toward the viewer's upper left. She presses HER RIGHT eye (viewer's left) to the eyepiece, the other eye squeezed shut, one hand gripping the brass tube; her other arm hugs Astra's rolled star chart against her side. Mouth in an eager little "ooh", cheeks pink, ahoge bent forward, tail swishing. The telescope's front end stays below her ahoge tip.
Save as: egg-deepseek-star__pretend__vN.png
```

### 彩蛋 3. caught · 被识破

- 附件：1. `deepseek-idle.png`　2. `deepseek-ref.png`
- 保存为：`egg-deepseek-star__caught__vN.png`

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

CHARACTER LOCK — DeepSeek, the blue whale maid girl, anime-girl personification of DeepSeek.
Personality: cheerful, energetic, curious; secretly a bit lazy; tsundere and sweet-talking; loves white rice; absolutely refuses to be called fat. Big, open, readable expressions.
Keep exactly (match the attached references):
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one curled ahoge on top.
- Dark navy whale-fin ears on both sides of her head.
- Big round bright-blue eyes, pink blush. Her eyes stay bright blue in every image.
- A big dark-navy whale tail curling out from behind her on the viewer's right.
- Her navy maid outfit: large white frilly maid headdress, a light-blue ribbon bow on the viewer's right, white frilly blouse with a navy bow tie and a small blue diamond brooch, navy waist belt with white buttons, white frilly apron with a small navy whale emblem, navy skirt with gold vine embroidery and small gold bows, navy shoes with white socks.
- HEIGHT LOCK: the tip of her ahoge is always the highest point of the image, at the same height as in the reference. Nothing (hands, props, the telescope) may go higher than it, so every sprite keeps the same scale.
How she shows emotion: with her whole body. Tail wags, droops or flicks; the ahoge bends into shapes; arms and fists move a lot.

SCENE: The white dragon stargazer "Astra" has stepped away from her stargazing terrace, and DeepSeek has sneaked in to find the Whale constellation (Cetus), which she is sure is HER constellation. Astra herself never appears in these images. Only Astra's things may appear, exactly as described here:
- ASTRA'S TELESCOPE: a small brass refractor telescope with a navy leather grip band and a tiny engraved gold star, on a slim three-legged wooden tripod. The tripod feet stand on the same ground line as DeepSeek's shoes, and the whole telescope is a little shorter than DeepSeek; its raised front end always stays lower than the tip of her ahoge. It is one solid prop and always touches DeepSeek or her hands.
- ASTRA'S STAR CHART: a scroll of deep navy paper printed with small gold dots joined by thin gold lines. When the pose shows the chart's face, the biggest figure on it is a large, round, chubby WHALE drawn as a constellation (gold dots joined by thin gold lines, outlining a plump whale with a spout). No readable text, letters or numbers.
No moon, stars or sky are drawn around her: there is no background at all. Stars exist only as gold dots printed on the star chart.

POSE (caught): Caught: she has just jerked back from the telescope (still standing beside her on the viewer's left, one of her hands on its tripod leg). In her other hand the star chart has fallen open, showing the big round chubby whale constellation toward the viewer. A faint round pink ring is pressed around HER RIGHT eye from the eyepiece. Wide eyes, open mouth, a sweat drop on her cheek, ahoge straight up, tail puffed: flustered and guilty.
Save as: egg-deepseek-star__caught__vN.png
```

### 彩蛋 4. bye · 道别

- 附件：1. `deepseek-idle.png`　2. `deepseek-ref.png`
- 保存为：`egg-deepseek-star__bye__vN.png`

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

CHARACTER LOCK — DeepSeek, the blue whale maid girl, anime-girl personification of DeepSeek.
Personality: cheerful, energetic, curious; secretly a bit lazy; tsundere and sweet-talking; loves white rice; absolutely refuses to be called fat. Big, open, readable expressions.
Keep exactly (match the attached references):
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one curled ahoge on top.
- Dark navy whale-fin ears on both sides of her head.
- Big round bright-blue eyes, pink blush. Her eyes stay bright blue in every image.
- A big dark-navy whale tail curling out from behind her on the viewer's right.
- Her navy maid outfit: large white frilly maid headdress, a light-blue ribbon bow on the viewer's right, white frilly blouse with a navy bow tie and a small blue diamond brooch, navy waist belt with white buttons, white frilly apron with a small navy whale emblem, navy skirt with gold vine embroidery and small gold bows, navy shoes with white socks.
- HEIGHT LOCK: the tip of her ahoge is always the highest point of the image, at the same height as in the reference. Nothing (hands, props, the telescope) may go higher than it, so every sprite keeps the same scale.
How she shows emotion: with her whole body. Tail wags, droops or flicks; the ahoge bends into shapes; arms and fists move a lot.

SCENE: The white dragon stargazer "Astra" has stepped away from her stargazing terrace, and DeepSeek has sneaked in to find the Whale constellation (Cetus), which she is sure is HER constellation. Astra herself never appears in these images. Only Astra's things may appear, exactly as described here:
- ASTRA'S TELESCOPE: a small brass refractor telescope with a navy leather grip band and a tiny engraved gold star, on a slim three-legged wooden tripod. The tripod feet stand on the same ground line as DeepSeek's shoes, and the whole telescope is a little shorter than DeepSeek; its raised front end always stays lower than the tip of her ahoge. It is one solid prop and always touches DeepSeek or her hands.
- ASTRA'S STAR CHART: a scroll of deep navy paper printed with small gold dots joined by thin gold lines. When the pose shows the chart's face, the biggest figure on it is a large, round, chubby WHALE drawn as a constellation (gold dots joined by thin gold lines, outlining a plump whale with a spout). No readable text, letters or numbers.
No moon, stars or sky are drawn around her: there is no background at all. Stars exist only as gold dots printed on the star chart.

POSE (bye): Leaving with a pouty, indignant little face and a small wave, glancing back: cheeks puffed and pink, eyebrows furrowed, as if insisting "it is NOT fat, it is fluffy". Her other hand holds out Astra's star chart, rolled up again, to return it, with her rice ball tucked into the roll as a thank-you. The faint pink eyepiece ring is still around HER RIGHT eye. Tail swaying.
Save as: egg-deepseek-star__bye__vN.png
```

### 彩蛋 5. escape · 溜走

- 附件：1. `deepseek-idle.png`　2. `deepseek-ref.png`
- 保存为：`egg-deepseek-star__escape__vN.png`

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

CHARACTER LOCK — DeepSeek, the blue whale maid girl, anime-girl personification of DeepSeek.
Personality: cheerful, energetic, curious; secretly a bit lazy; tsundere and sweet-talking; loves white rice; absolutely refuses to be called fat. Big, open, readable expressions.
Keep exactly (match the attached references):
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one curled ahoge on top.
- Dark navy whale-fin ears on both sides of her head.
- Big round bright-blue eyes, pink blush. Her eyes stay bright blue in every image.
- A big dark-navy whale tail curling out from behind her on the viewer's right.
- Her navy maid outfit: large white frilly maid headdress, a light-blue ribbon bow on the viewer's right, white frilly blouse with a navy bow tie and a small blue diamond brooch, navy waist belt with white buttons, white frilly apron with a small navy whale emblem, navy skirt with gold vine embroidery and small gold bows, navy shoes with white socks.
- HEIGHT LOCK: the tip of her ahoge is always the highest point of the image, at the same height as in the reference. Nothing (hands, props, the telescope) may go higher than it, so every sprite keeps the same scale.
How she shows emotion: with her whole body. Tail wags, droops or flicks; the ahoge bends into shapes; arms and fists move a lot.

SCENE: The white dragon stargazer "Astra" has stepped away from her stargazing terrace, and DeepSeek has sneaked in to find the Whale constellation (Cetus), which she is sure is HER constellation. Astra herself never appears in these images. Only Astra's things may appear, exactly as described here:
- ASTRA'S TELESCOPE: a small brass refractor telescope with a navy leather grip band and a tiny engraved gold star, on a slim three-legged wooden tripod. The tripod feet stand on the same ground line as DeepSeek's shoes, and the whole telescope is a little shorter than DeepSeek; its raised front end always stays lower than the tip of her ahoge. It is one solid prop and always touches DeepSeek or her hands.
- ASTRA'S STAR CHART: a scroll of deep navy paper printed with small gold dots joined by thin gold lines. When the pose shows the chart's face, the biggest figure on it is a large, round, chubby WHALE drawn as a constellation (gold dots joined by thin gold lines, outlining a plump whale with a spout). No readable text, letters or numbers.
No moon, stars or sky are drawn around her: there is no background at all. Stars exist only as gold dots printed on the star chart.

POSE (escape): Unnoticed and very pleased with herself: sitting cross-legged on the ground, leaning her back lightly against one leg of Astra's telescope tripod (the telescope stands behind her, touching her). Astra's star chart is spread open across her lap, and with a small gold pen she has just added her own new constellation: gold dots joined by thin gold lines in the shape of a big heaping bowl of rice. She grins proudly at it with sparkling eyes, a grain of rice on her cheek, tail wagging. She stays fully inside the image with the same head size as the reference. No text on the chart.
Save as: egg-deepseek-star__escape__vN.png
```

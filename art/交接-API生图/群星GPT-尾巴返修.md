# 群星 GPT（Astra）：尾巴返修 5 张

2026-11-22 验收时发现，特色重画里有 5 张的尾巴画错了：尾巴落在地上、绕到脚前或脚底，或者从裙摆底下钻出来，看不出是从她身上长出来的。
正确的样子看定妆图 `idle.png`：尾巴从她背后、腰的高度，在画面右侧伸出来，往下卷一圈再翘起，末端是一个软软的尖。

## 和原提示词相比改了什么

原提示词在 [群星GPT-特色重画.md](群星GPT-特色重画.md)。这里每一段都已经改好，整段复制即可：

1. 删掉「尾巴在开心、得意时卷成月牙」这半句（这 5 张都不是开心或得意，模型却照着往地上盘月牙）。
2. 「How she shows emotion」里原来写的是翅膀和尾巴每个姿态都可以换位置，改成只有翅膀可以换。
3. 动作描述里原来写的「尾巴绕在脚边」（reading、sleeping、greet_night）和「尾巴尖卷着」，都改成垂在画面右侧裙摆旁边、卷一圈、尖不着地。
4. 在 HEIGHT LOCK 后面加一段 TAIL LOCK，把尾巴的位置、粗细、末端写死，并且点名不许做的几种画法。

其他照旧：参数和[新角色与新皮肤.md](新角色与新皮肤.md)第 0 节一样，只附一张 `idle.png`，每张单独调用，只画 1 版，命名 `gpt-astra__<姿态>__v<N>.png`（这 5 张已有 v1，新画的存 v2）。

| 姿态 | 这次的问题 |
|---|---|
| thinking | 尾巴从裙摆底下垂到地上，拐了个钩，中间像折了一道 |
| searching | 尾巴折成两段，上面一段卷成月牙，尖是硬的鳍状，像两截拼起来的 |
| reading | 尾巴整条趴在地上，从左边绕到她脚前、脚底下，看不出是从身上长出来的 |
| sleeping | 尾巴盘在地上、绕着脚，看不出是从身上长出来的 |
| greet_night | 尾巴从两只靴子中间的裙摆底下钻出来，再往右边地上卷 |

---

## 1. thinking · 思考

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__thinking__vN.png（这张已有 v1，存成 v2）`

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
- TAIL LOCK: exactly one tail. It grows from her lower back, hidden behind the skirt, and comes out on the viewer's right at hip height, exactly as in the reference: it hangs down beside the skirt, curls once and ends in a single soft rounded tip, with the same thickness and taper as the reference (thick at the base, gradually thinner toward the tip). It never lies flat on the ground, never passes in front of, between or under her feet, never comes out from under the skirt hem, and is never folded, kinked or drawn as two separate pieces. In this pose it does NOT curl into a crescent-moon shape.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her waist ring. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings may change position with each pose; their design stays the same. Her tail always follows the TAIL LOCK.

POSE (thinking): Quietly working out a constellation: head tilted slightly back and to one side, both pupils glancing up toward the viewer's upper left as a coordinated pair. The index finger of one hand is raised near her chin as if tracing an invisible line between stars (no line is drawn). Her other hand holds a small flat brass astrolabe, a palm-sized disc with engraved rings and a little pointer, at waist height. A faint curious "hm" mouth, one eyebrow slightly raised. Wings relaxed; the tail hangs relaxed beside her skirt on the viewer's right, only its soft tip curling up a little. No floating stars, lines or symbols.
Save as: gpt-astra__thinking__vN.png
```

---

---

## 2. searching · 搜索

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__searching__vN.png（这张已有 v1，存成 v2）`

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
- TAIL LOCK: exactly one tail. It grows from her lower back, hidden behind the skirt, and comes out on the viewer's right at hip height, exactly as in the reference: it hangs down beside the skirt, curls once and ends in a single soft rounded tip, with the same thickness and taper as the reference (thick at the base, gradually thinner toward the tip). It never lies flat on the ground, never passes in front of, between or under her feet, never comes out from under the skirt hem, and is never folded, kinked or drawn as two separate pieces. In this pose it does NOT curl into a crescent-moon shape.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her waist ring. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings may change position with each pose; their design stays the same. Her tail always follows the TAIL LOCK.

POSE (searching): Searching the sky: she holds a short collapsible brass telescope with navy leather grips in both hands and looks through it with HER RIGHT eye (viewer's left), the telescope pointing up toward the viewer's upper left. The telescope is short, no longer than her forearm, and stays below her horn tips. Her other eye stays open and naturally relaxed, eyebrow slightly lifted in concentration, a small pressed mouth. Feet planted, wings half raised with interest; the tail stays beside her skirt on the viewer's right with its soft tip lifted a little. The telescope must not cover her whole face.
Save as: gpt-astra__searching__vN.png
```

---

---

## 3. reading · 读文件

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__reading__vN.png（这张已有 v1，存成 v2）`

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
- TAIL LOCK: exactly one tail. It grows from her lower back, hidden behind the skirt, and comes out on the viewer's right at hip height, exactly as in the reference: it hangs down beside the skirt, curls once and ends in a single soft rounded tip, with the same thickness and taper as the reference (thick at the base, gradually thinner toward the tip). It never lies flat on the ground, never passes in front of, between or under her feet, never comes out from under the skirt hem, and is never folded, kinked or drawn as two separate pieces. In this pose it does NOT curl into a crescent-moon shape.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her waist ring. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings may change position with each pose; their design stays the same. Her tail always follows the TAIL LOCK.

POSE (reading): Reading a navy star-chart scroll: a partly unrolled scroll of deep navy paper held open at chest height with both hands, the two rolled ends visible. The chart is printed with small gold dots joined by thin gold lines (constellations) and a faint circular grid; no readable letters or numbers. Her eyes look down at the chart naturally, both pupils resting on the same spot, upper lids relaxed, a calm knowing little smile. The tail hangs beside her skirt on the viewer's right and curls once, its tip off the ground. No book.
Save as: gpt-astra__reading__vN.png
```

---

---

## 4. sleeping · 睡着

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__sleeping__vN.png（这张已有 v1，存成 v2）`

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
- TAIL LOCK: exactly one tail. It grows from her lower back, hidden behind the skirt, and comes out on the viewer's right at hip height, exactly as in the reference: it hangs down beside the skirt, curls once and ends in a single soft rounded tip, with the same thickness and taper as the reference (thick at the base, gradually thinner toward the tip). It never lies flat on the ground, never passes in front of, between or under her feet, never comes out from under the skirt hem, and is never folded, kinked or drawn as two separate pieces. In this pose it does NOT curl into a crescent-moon shape.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her waist ring. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings may change position with each pose; their design stays the same. Her tail always follows the TAIL LOCK.

POSE (sleeping): Dozing off while standing: she hugs a soft navy crescent-moon-shaped cushion with tiny embroidered gold stars against her chest, her cheek resting on its upper tip. Head tipped gently to one side, eyes peacefully closed, a tiny relaxed mouth, faint blush. Her wings fold softly forward around her shoulders like a blanket; the tail droops sleepily beside her skirt on the viewer's right, its soft tip resting just above the ground, never in front of her feet. Both feet stay on the same baseline as the reference. No Zzz, no drool, no floating symbols.
Save as: gpt-astra__sleeping__vN.png
```

---

---

## 5. greet_night · 晚安

- 参数：`background: "transparent"`、`size: "1024x1024"`
- 附件：1. `idle.png`
- 保存为：`gpt-astra__greet_night__vN.png（这张已有 v1，存成 v2）`

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
- TAIL LOCK: exactly one tail. It grows from her lower back, hidden behind the skirt, and comes out on the viewer's right at hip height, exactly as in the reference: it hangs down beside the skirt, curls once and ends in a single soft rounded tip, with the same thickness and taper as the reference (thick at the base, gradually thinner toward the tip). It never lies flat on the ground, never passes in front of, between or under her feet, never comes out from under the skirt hem, and is never folded, kinked or drawn as two separate pieces. In this pose it does NOT curl into a crescent-moon shape.
Palette: white and pale lavender, with deep navy on the sleeves and over-skirt, warm gold accents and small purple gems. Soft and cool. No other strong colors.
Her stargazer identity: she is shown through small, physical stargazing props (a short brass telescope, a navy star-chart scroll, a small brass astrolabe, a crescent-moon cushion, a star-pierced lantern), through her waist ring, and through her waist ring. Star patterns may be printed, engraved or embroidered ON these props and her clothes; nothing floats in the air.
How she shows emotion: through her face first, helped by her wings (spread when proud, drooping when tired or sleepy) and her tail. Her wings may change position with each pose; their design stays the same. Her tail always follows the TAIL LOCK.

POSE (greet_night): Saying good night: one hand holds up a small brass lantern by its ring handle at chest height; the lantern has star-shaped cut-outs and a soft warm light inside it (the light stays inside the lantern; no halo or glow on the background). The other hand gives a small, gentle wave beside her shoulder. Sleepy, soft half-closed eyes looking at the viewer, a small warm smile. Wings drooping a little; the tail hangs loosely beside her skirt on the viewer's right, its soft tip curling once, never in front of her feet.
Save as: gpt-astra__greet_night__vN.png
```

---


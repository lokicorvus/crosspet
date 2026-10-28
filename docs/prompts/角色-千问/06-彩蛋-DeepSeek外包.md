# 彩蛋：DeepSeek 把你的活偷偷外包给千问，自己睡大觉（5 张）

**当前角色是千问时**按彩蛋的老规矩随机出现（文件夹 `egg-qwen`，host 是 `qwen`；loki 10-19 定剧情）：
1. **pop**：你交代给 DeepSeek 的活（一台合上的笔记本），被她抱着、夹着枕头，偷偷摸摸溜到千问这儿来。
2. **pretend**（等你点）：活已经甩给千问了，DeepSeek 抱着枕头站着睡大觉。
3. **caught**（你点了，抓到她摸鱼）：DeepSeek 吓醒，枕头差点掉了；旁边千问正替她敲着电脑，笑眯眯地拿扇子跟你打招呼——外包被你当场发现。
4. **bye**：千问把做完的活交回给 DeepSeek，还顺手请她一杯奶茶；DeepSeek 不好意思地双手合十道谢。
5. **escape**（没人点）：DeepSeek 睡醒伸个懒腰，抱着千问做完的活和一杯奶茶，心满意足地走了——你根本不知道活是谁干的。

梗：DeepSeek 设定里「其实有点懒」+ 千问有钱、大方、爱请客（连被外包都要请奶茶）。
名牌显示「DeepSeek」（她不是在冒充千问）。

**附件两张，说明哪张是谁**：`docs/prompts/ref-deepseek.webp`（DeepSeek，女仆装原版）和 `docs/prompts/ref-qwen.webp`（千问）。
**生图工具里开启 `transparent_background: true`**（真实透明背景、无地面阴影、保留完整边缘），不用白底。
画好放进 `characters/egg-qwen/raw/`，文件名 `pop` / `pretend` / `caught` / `bye` / `escape`。
（之前那版「千问戴 DeepSeek 头饰冒充」的 5 张不用了。）

```
Two images are attached. The FIRST is DeepSeek (the blue whale maid girl). The SECOND is Qwen (the gentle rich young lady with periwinkle-blue hair, a small navy hat and a fan). Draw desktop-pet sprites for a short comedy "visitor" scene.

FORMAT RULES (every image):
- Transparent background: real transparency (alpha), no floor, no ground shadow, no glow, no vignette, no frame. Keep the complete edges of the character (every hair strand, ribbon and tassel), nothing cropped. If an attached reference image has a plain white background, that is only because it was made before transparent output was available: do NOT copy the white background.
- No text, no letters, no numbers, no speech bubbles, no symbols floating in the air (no Zzz, no hearts, no sweat-drop icons in the air). The app draws all effects itself.
- Exactly one character (except caught.png and bye.png, see below), full body, standing, centered. Head near the top and feet near the bottom; she fills about 90% of the image height.
- A continuous, closed dark outline around the whole silhouette, so the edges stay clean against any background.
- Same art style as the references: clean lineart, flat two-tone cel shading, soft palette, chibi about 2.5 heads tall, big head, long flowing hair.
- Square image, 1024x1024 or larger. One image per file, saved under the exact filename given.
- Every prop touches a hand or body; nothing floats.
- In two-character images, both are fully inside the image and their outlines touch so they form one connected group (anything not connected gets deleted by the import tool).

CHARACTER LOCK — DeepSeek, the blue whale maid girl, anime-girl personification of DeepSeek.
Personality: cheerful, energetic, sweet-talking; secretly a bit lazy. Big, open, readable expressions.
Keep exactly:
- Long wavy hair, deep indigo/navy blue fading to bright blue at the tips; one curled ahoge on top.
- A large white frilly maid headdress; dark navy whale-fin ears on both sides of her head; a light-blue ribbon bow on her right side (viewer's right).
- Big round bright-blue eyes, pink blush.
- Navy maid dress: white frilly blouse with a navy bow tie and a small blue diamond brooch, navy waist belt, white frilly apron with a small navy whale emblem, navy skirt with gold vine embroidery; navy shoes with white socks.
- A big dark-navy whale tail curling out from behind her on the viewer's right.
How she shows emotion: with her whole body. Tail wags, droops or flicks; the ahoge bends into shapes.

SECOND CHARACTER (only in caught.png and bye.png) — Qwen, the anime-girl personification of Qwen (Alibaba's AI), a gentle and generous young lady from a wealthy family.
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

PROPS: "the task" is a slim white laptop. The pillow is a big fluffy white pillow with a small navy whale stitched on it. The milk tea is a clear plastic cup with a dome lid and a wide straw, light brown milk tea with dark tapioca pearls, NO logo, NO text.

EGG POSES (DeepSeek is the visitor; caught and bye also show Qwen):
pop.png     — DeepSeek tiptoes in sneakily: the closed white laptop hugged under one arm, the big whale pillow squeezed under the other arm, body leaning forward on tiptoe, eyes glancing sideways with a mischievous "nobody's looking~" grin, ahoge curled, tail swishing low.
pretend.png — Work dumped, nap time: DeepSeek fast asleep standing up, hugging the whale pillow against her cheek with both arms, eyes closed, mouth slightly open in a blissful sleepy smile, ahoge drooping, tail curled lazily around her feet. No laptop (she already handed it off). Only DeepSeek is drawn.
caught.png  — Caught slacking! Two characters. DeepSeek on the viewer's right jolts awake: eyes wide, ahoge and tail sticking straight up in shock, a guilty "eep!" mouth, the pillow slipping from her arms (still touching her). Qwen on the viewer's left, standing right next to her, calmly typing on the open white laptop held on one forearm, turning to the viewer with a gentle amused smile and a small wave of her open fan ("hi~ I'm just helping out"). Their outlines touch.
bye.png     — Handing it back. Two characters. Qwen on the viewer's left hands the closed white laptop and a cup of milk tea to DeepSeek with a warm "all done, and this one's on me~" smile. DeepSeek on the viewer's right, sheepish and grateful: taking the milk tea with both hands, a bashful grin, slight bow, blush, tail wagging. Their outlines touch.
escape.png  — Nobody noticed: DeepSeek, just woken up and very pleased, walking off toward the viewer's LEFT (face still toward the viewer): the finished closed laptop under one arm, sipping the milk tea from the straw with the other hand, the pillow tucked under the same arm as the laptop, a smug satisfied "work done~" look, tail wagging. Only DeepSeek is drawn.
```

看稿：DeepSeek 是原版女仆装（白头饰、鲸鱼耳朵和尾巴）；caught / bye 两人轮廓连在一起，千问和她其他立绘一样大；笔记本、枕头、奶茶都拿在手里不飘；奶茶杯上没有字和标志。

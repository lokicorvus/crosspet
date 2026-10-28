# 彩蛋：圣女 Claude 偷穿睡衣（5 张）

只在 DeepSeek 穿着睡衣时出现。梗：Claude 是被家族各种规矩束缚的「圣女」，DeepSeek 是无忧无虑的小女孩，Claude 一直羡慕她的生活。
剧情：深夜，Claude 偷偷穿上 DeepSeek 的鲸鱼睡衣、抱着她的枕头，假装自己是 DeepSeek，想体验一晚没有规矩的日子——可连摸鱼都摸得规规矩矩，睡衣口袋里还露着那本规则手册。你点一下，她就慌了；然后依依不舍地回去守规矩。没人点的话，她心满意足地踮着脚溜走。

放进 `characters/egg-claude-pajamas/raw/`，文件名 `pop` / `pretend` / `caught` / `bye` / `escape`。配置和台词已经放好，图一导入就会出现。
附件（按顺序）：`docs/prompts/ref-claude.webp`（Claude 的长相）+ `characters/deepseek-pajamas/raw/idle.png`（睡衣的样子，只参考衣服）。先只画 `pop.png` 看看，满意了再画剩下 4 张。

```
You are drawing a small set of gentle, funny desktop-pet sprites. Two images are attached: the FIRST is Claude (her face, hair and body — keep them exactly); the SECOND is DeepSeek in her whale pajamas (use it ONLY for the pajamas). Story: Claude is a prim, rule-bound "saint" who has always envied DeepSeek's carefree life. Late at night she secretly borrows DeepSeek's pajamas to try being carefree for one night — but she can't stop being proper. Cute and wholesome, like a fan comic gag.

FORMAT RULES (every image):
- Real transparent background (generate with transparent_background: true). No floor, no ground shadow, no glow, no frame. Keep complete, clean edges. If an attached reference image has a plain white background, that is only because it was made before transparent output was available: do NOT copy the white background.
- No text, no letters, no speech bubbles, no floating symbols (no ?, !, hearts, Zzz, sweat-drop icons in the air, motion lines). Sweat drops and blush ON the face are fine.
- Full body, standing, centered; head near the top and feet near the bottom; the figure fills about 90% of the image height.
- A continuous closed dark outline around the whole silhouette.
- Same art style as the references: clean lineart, flat two-tone cel shading, soft palette, chibi about 2.5 heads tall, big head, round soft shapes.
- Square image, 1024x1024 or larger. One image per file, exact filenames below.

CHARACTER LOCK — Claude, the anime-girl personification of Claude (Anthropic).
Personality: gentle, calm, bookish, a little shy, quietly cheerful; she thinks before she speaks.
Keep exactly:
- Long wavy copper-orange hair, loose side-swept bangs, warm amber eyes.
- An orange daisy-like hair flower with a black striped ribbon bow and a white tassel on HER LEFT side (viewer's right); small drop earrings.
- Signature prop: a dark brown hardcover book with an orange flower emblem.
How she shows emotion: through the book (hugging it, hiding behind it) and small, soft expressions. Never wild or loud.

COSTUME — she wears DeepSeek's pajamas (from the SECOND image), a little too big for her:
- The light-blue floppy nightcap with white cloud print, thick white fluffy brim, a small navy whale on the side and a white pom-pom at the tip; her orange daisy hair flower is still clipped on underneath, peeking out (she couldn't bear to take it off).
- The light-blue cloud-print pajama top with white fluffy collar and cuffs, round light-blue buttons and a small whale print; matching cloud-print shorts; fluffy white whale slippers.
- Her copper-orange hair, amber eyes and face stay exactly Claude's. NO whale ears, NO whale tail (she is not DeepSeek, that is the giveaway).
- Her dark brown book (her "rulebook") is always somewhere: tucked in the pajama pocket, hidden behind a pillow, or under her arm.

POSES (one image each, exact filename):
pop.png     — tiptoeing in, one finger to her lips ("shh"), hugging a small whale-shaped pillow, a shy excited little smile, the nightcap slightly too big and sliding.
pretend.png — trying hard to "slack off like DeepSeek": holding a small bowl of white rice and chopsticks, attempting a lazy relaxed face, but her posture is still perfectly upright and proper, feet neatly together; the corner of her brown book peeking out of the pajama pocket.
caught.png  — caught! flustered, bright pink blush, the nightcap sliding over one eye, the brown book falling out of her pocket, both hands raised in a small "it's not what it looks like" gesture, a little sweat drop on her face.
bye.png     — leaving toward the viewer's left: hugging her brown book again, glancing back over her shoulder with a wistful, gentle smile and a small wave, still wearing the nightcap.
escape.png  — tiptoeing away contentedly, eyes closed in a small happy smile, hugging the whale-shaped pillow, as if she quietly got her one carefree moment.
```

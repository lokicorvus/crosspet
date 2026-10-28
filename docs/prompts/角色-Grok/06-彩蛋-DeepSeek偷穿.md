# 彩蛋：DeepSeek 偷穿 Grok 的行头，冒充 Grok（5 张）

**当前角色是 Grok 时**按彩蛋的老规矩随机出现（文件夹 `egg-grok`，host 是 `grok`；loki 定的方向「DeepSeek 偷穿 Grok 的衣服」，剧情是 Claude 的提案）：
1. **pop**：DeepSeek 偷偷戴上 Grok 的**小王冠**、把**蝙蝠翅膀蝴蝶结**别在自己的女仆头饰两边、套上那件红里子的**立领小披风**，拖着那把**比她重得多的 X 大斧**，学 Grok 咧嘴露虎牙，溜进来。
2. **pretend**（等你点）：冒充 Grok 给人「辟谣」：一只手死撑着杵在地上的大斧，一只手把手机怼到你面前，一脸「我查过了，是真的」——**手机拿倒了**，腿还在被斧头压得发抖。
3. **caught**（你点了）：真 Grok 来了（王冠、蝴蝶结、披风都在 DeepSeek 身上，她自己头上空空、手里没斧头），抱着胳膊、挑着眉，拿手机对着 DeepSeek「这是真的吗？」；DeepSeek 吓一跳，王冠滑到眼睛上，斧头往一边倒（还靠着她）。
4. **bye**：DeepSeek 不好意思地把王冠和斧头还回去；Grok 单手轻松把斧头扛上肩，另一只手坏笑着把王冠扣回 DeepSeek 头上歪着戴——「借你戴一下」。
5. **escape**（没人点）：DeepSeek 戴着歪王冠、拖着大斧得意洋洋地走了，斧头在地上拖出一路——没人拆穿她。

梗：「@grok is this true?」——人人都找 Grok 辟谣，DeepSeek 想抢这份活，结果连斧头都扛不动、手机还拿反了。和 Claude 来找卫衣那个彩蛋是一对：DeepSeek 穿谁的衣服就觉得自己变成了谁。
**名牌显示「Grok」**（她在冒充，和卫衣皮肤「好的，我现在是 Claude！」一个路子）。

**附件两张，说明哪张是谁**：`docs/prompts/ref-deepseek.webp`（DeepSeek，女仆装原版）和 `docs/prompts/ref-grok.webp`（Grok）。
**生图工具里开启 `transparent_background: true`**。画好放进 `characters/egg-grok/raw/`，文件名 `pop` / `pretend` / `caught` / `bye` / `escape`。

```
Two images are attached. The FIRST is DeepSeek (the blue whale maid girl). The SECOND is Grok (the blonde gothic little demon queen with twin-tails, a small crown and a huge X-shaped battle axe). Draw desktop-pet sprites for a short comedy "visitor" scene: DeepSeek has secretly borrowed Grok's crown, bows, cape collar and axe, and is pretending to be Grok.

FORMAT RULES (every image):
- Transparent background: real transparency (alpha), no floor, no ground shadow, no glow, no vignette, no frame. Keep the complete edges of the character, nothing cropped. If an attached reference image has a plain white background, that is only because it was made before transparent output was available: do NOT copy the white background.
- No text, no letters, no numbers, no speech bubbles, no symbols floating in the air. Phone screens only glow; nothing readable on them. Keep the axe's X shape and the circle-with-slash emblems, but add no other letters or logos.
- Exactly one character (except caught.png and bye.png, see below), full body, standing, centered. Head near the top and feet near the bottom; she fills about 90% of the image height.
- A continuous, closed dark outline around the whole silhouette (the axe included).
- Same art style as the references: clean lineart, flat two-tone cel shading, soft palette, chibi about 2.5 heads tall, big head, round soft shapes.
- Square image, 1024x1024 or larger. One image per file, saved under the exact filename given.
- In caught.png and bye.png the two characters stand side by side, their outlines touching, each at the same scale as in her own reference.
- The axe is always upright (haft vertical, spear tip up): held, hugged or leaning against someone, never dragged; it never floats, and it is the same size as in Grok's reference (taller than either girl).

MAIN CHARACTER — DeepSeek, exactly as in the FIRST image (long wavy navy-to-bright-blue hair, white frilly maid headdress, navy whale-fin ears, light-blue bow, big bright-blue eyes, navy maid dress with white apron, big navy whale tail), EXCEPT she has put on Grok's things:
- Grok's small dark crown with the gold circle-and-slash emblem, perched on top of her maid headdress, a little too big and tilted.
- Grok's two black bat-wing ribbon bows clipped onto both sides of her headdress.
- Grok's small black cape collar with the deep-red lining, standing up behind her neck over the maid dress.
- Grok's huge black-and-gold X battle axe, which is far too heavy for her.

SECOND CHARACTER (only in caught.png and bye.png) — Grok, exactly as in the SECOND image (golden-blonde twin-tails, ahoge, pointed ears, bright-blue eyes, little fangs, black gothic off-shoulder dress with gold chains and black-and-red frills), but WITHOUT her crown, bat-wing bows and cape collar (DeepSeek has them) and WITHOUT the axe, except as described in bye.png. Her twin-tails are tied with plain black hair ties. Personality: sassy, quick-witted, a confident fang grin, never mean.

EGG POSES:
pop.png     — DeepSeek sneaks in dressed as Grok, no axe: tiptoeing, both hands raised to hold the too-big tilted crown steady on her headdress, trying to copy Grok's wide fang grin but looking very pleased with herself, tail swishing.
pretend.png — DeepSeek posing as Grok, "I checked, it's true!": one hand clinging to the top of the planted axe (her knees wobbling under its weight), the other arm holding a small black phone out at the viewer — but the phone is UPSIDE DOWN (its camera at the bottom), a confident fake grin with half-lidded eyes. Only DeepSeek is drawn.
caught.png  — Caught! Two characters. DeepSeek on the viewer's right jolts: eyes wide, ahoge and tail sticking straight up, the crown slipping down over one eye, the axe tipping sideways but still leaning against her shoulder. Grok on the viewer's left, bare-headed, arms crossed with her own small phone held up toward DeepSeek, one eyebrow raised, an amused "is this true?" fang smirk.
bye.png     — Giving it back. Two characters. Grok on the viewer's left has the axe slung easily over her shoulder with one hand, and with the other hand plops the crown back onto DeepSeek's head at a silly tilt, a fond cocky grin. DeepSeek on the viewer's right, sheepish and blushing, holding the two bat-wing bows out with both hands, tail drooping, a bashful smile.
escape.png  — Nobody caught her: DeepSeek walking off toward the viewer's LEFT (face still toward the viewer), no axe, one hand holding the askew crown on her head and the other making a small peace sign, chin up with a proud smug smile, tail swinging. Only DeepSeek is drawn.
```

看稿：DeepSeek 是原版女仆装（白头饰、鲸鱼耳朵和尾巴都在），头饰上加了 Grok 的王冠和蝙蝠蝴蝶结、身后竖着红里子小披风；pretend 那张手机确实是倒着拿的；caught 里 Grok 头上空空、手里没斧头，bye 里斧头回到 Grok 肩上；两人轮廓连在一起、和各自其他立绘一样大；斧头始终有人拿着或靠着，不飘。

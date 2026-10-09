# 彩蛋：Claude 来找她的卫衣（4 张）

只有 DeepSeek 穿着 Claude 卫衣时才会出现：Claude 来找自己不见了的卫衣，到处翻找；你点一下，她就撞见穿着自己卫衣的 DeepSeek，DeepSeek 当场心虚；最后 Claude 笑着把卫衣借给她。没人点的话，Claude 找不到就自己走了。

放进 `characters/egg-claude-hoodie/raw/`，文件名 `pop` / `pretend` / `caught` / `bye`。

**怎么拼**：先贴「通用格式规则」（任意一个批次文件开头那段），再贴 Claude 的「角色锁定」（[../角色生图提示词.md](../角色生图提示词.md) 里「Claude · Claude」那段），再贴下面这段。
附件：`docs/prompts/ref-claude.webp`（Claude）和卫衣定妆图 `characters/deepseek-hoodie/raw/idle.png`（DeepSeek），说明哪张是谁。

```
EGG POSES — the character in pop / pretend / bye is Claude (use the Claude reference) in her usual outfit, visiting where DeepSeek usually stands. caught.png shows both Claude and DeepSeek (DeepSeek is wearing a cream "Claude" hoodie, use the hoodie reference exactly).
pop.png     — Claude peeks in politely, one hand raised in a small wave, her brown book hugged to her chest, a puzzled little head tilt ("hm? where is it?").
pretend.png — Claude searching for something she lost: bending forward and looking around with a slightly worried face, one hand shading her eyes, the other holding up an empty wooden clothes hanger, her book tucked under her arm.
caught.png  — Found it! Claude (on the viewer's right, a little smaller) points gently at the "Claude" name badge on DeepSeek's chest, with a calm knowing smile and one eyebrow raised. DeepSeek (in front, same size as in her other images, wearing the cream hoodie) freezes with a big sweat drop, hugging herself in the hoodie, eyes darting away, a guilty "ehehe…" face, whale tail curled tight.
bye.png     — Claude walks away to the viewer's left, glancing back over her shoulder with a warm, amused smile and a small wave, empty hanger in her other hand (she decided to let DeepSeek keep the hoodie).
```

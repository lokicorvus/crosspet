# Claude · 贴边补头顶（3 张重画）

现在的 `edge_left`、`edge_right`、`edge_left_peek` 三张，头顶被画框平着切掉了（生图时头顶出了画）。贴边时头顶是一条直线，很明显。
其他角色和 Claude 的 `edge_right_peek` 都没问题，只重画这三张。

每张单独发一次，附件附上**要重画的那张原图**（`characters/claude/raw/<文件名>.png`）和 `ref-claude.webp`：

```
The first attached image is a desktop-pet sprite that is almost right, but the top of her head is cut off by the top border of the picture. Redraw THE SAME IMAGE with her whole head inside the picture.

Change only this:
- Move her down / zoom out very slightly so the ENTIRE top of her hair (including any stray strands and the hair flower) is inside the picture, with a clear band of pure white background (about 4–6% of the image height) above the highest point of her hair.
- Her feet / skirt hem may go a little closer to the bottom edge to make room. Keep her size as close as possible to the first image.

Keep everything else exactly the same as the first image: the pose, the expression, which side the picture border cuts through her body, how much of her is visible, the hands holding the edge, the book, the outfit, colors and line style. The side border still cuts straight through her body with a clean straight cut and no outline along it. Pure flat white background (#FFFFFF), no shadow, no text, no floating symbols, square image 1024x1024 or larger. The second attached image is the character design reference.

Save as: <edge_left.png / edge_right.png / edge_left_peek.png，和附件那张同名>
```

导入（注意切口那条边）：
```bash
SKIP_EDGE=left  python3 tools/prepare.py <图> claude edge_left
SKIP_EDGE=right python3 tools/prepare.py <图> claude edge_right
SKIP_EDGE=left  python3 tools/prepare.py <图> claude edge_left_peek
```
导入后用开发者控制台把贴边、探出来来回切几次，看大小有没有跳。

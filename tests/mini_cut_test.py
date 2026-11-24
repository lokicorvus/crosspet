"""mini_cut 的 mini_move 切图：用合成的 3×1 横图试头宽缩放和脚对齐"""
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import mini_cut  # noqa: E402


def blob(w, h, head_w, size=(120, 200)):
    """一个小人：上面一块头（head_w 宽），下面一条身体"""
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0 = (size[0] - head_w) // 2
    d.rectangle((x0, 20, x0 + head_w, 20 + h // 3), fill=(255, 0, 0, 255))
    d.rectangle((size[0] // 2 - w // 2, 20 + h // 3, size[0] // 2 + w // 2, 20 + h), fill=(0, 0, 255, 255))
    return im


class MoveFrames(unittest.TestCase):
    def test_head_width_scaling(self):
        wave = blob(20, 90, 40)                       # 头宽 40
        sheet = Image.new("RGBA", (360, 200), (0, 0, 0, 0))
        for i in range(3):
            sheet.alpha_composite(blob(30, 90, 20), (i * 120, 0))   # 头宽 20，要放大 2 倍
        cs = mini_cut.cells(sheet, 3, 1)
        out = mini_cut.move_frames(cs, 1.0, wave)
        self.assertEqual(list(out), ["move-a", "move-b", "move-c"])
        self.assertAlmostEqual(mini_cut.head_width(out["move-a"]), 40, delta=3)
        self.assertEqual(len({f.size for f in out.values()}), 1)   # 同一个框


if __name__ == "__main__":
    unittest.main()

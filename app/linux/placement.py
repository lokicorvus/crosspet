"""Pure top-down geometry, edge-docking, companion placement, yield, and semver utilities."""

from __future__ import annotations

from dataclasses import dataclass

BUBBLE_SHARE = 59.0 / 362.0
SIDE_SHARE = 0.065
HEAD_ROOM = 0.29


@dataclass(frozen=True)
class Rect:
    """Top-down rectangle (origin at top-left, y increases downward)."""

    x: float
    y: float
    w: float
    h: float

    @property
    def min_x(self) -> float:
        return self.x

    @property
    def max_x(self) -> float:
        return self.x + self.w

    @property
    def min_y(self) -> float:
        return self.y

    @property
    def max_y(self) -> float:
        return self.y + self.h

    @property
    def mid_x(self) -> float:
        return self.x + self.w / 2.0

    @property
    def mid_y(self) -> float:
        return self.y + self.h / 2.0

    def inset(self, dx: float, dy: float) -> Rect:
        return Rect(self.x + dx, self.y + dy, max(0.0, self.w - 2.0 * dx), max(0.0, self.h - 2.0 * dy))

    def offset(self, dx: float, dy: float) -> Rect:
        return Rect(self.x + dx, self.y + dy, self.w, self.h)

    def contains_point(self, px: float, py: float) -> bool:
        return self.x <= px <= self.max_x and self.y <= py <= self.max_y

    def intersects(self, other: Rect, inset: float = 0.0) -> bool:
        return (
            self.x + inset < other.max_x
            and other.x < self.max_x - inset
            and self.y + inset < other.max_y
            and other.y < self.max_y - inset
        )


def place_window(
    old: Rect,
    width: float,
    height: float,
    old_foot: float,
    new_foot: float,
    anchor: str,
    visible_max_y: float | None,
) -> Rect:
    """Compute resized window Rect in top-down coordinates using 'corner', 'bottom', or 'feet' anchor."""
    if anchor == "corner":
        return Rect(old.x, old.y, width, height)
    if anchor == "bottom":
        return Rect(old.mid_x - width / 2.0, old.max_y - height, width, height)
    if anchor == "feet":
        old_bottom = old.max_y
        new_bottom = (old_bottom - old_foot) + new_foot
        if visible_max_y is not None and new_bottom > visible_max_y and new_bottom > old_bottom:
            new_bottom = max(old_bottom, visible_max_y)
        return Rect(old.mid_x - width / 2.0, new_bottom - height, width, height)
    raise ValueError(f"Unknown anchor: {anchor}")


def dock_side(
    frame: Rect,
    visible: Rect,
    reach: float,
    left_neighbor: bool,
    right_neighbor: bool,
) -> str | None:
    """Determine whether the pet should dock to 'left', 'right', or None."""
    if frame.mid_x - visible.min_x < reach and not left_neighbor:
        return "left"
    if visible.max_x - frame.mid_x < reach and not right_neighbor:
        return "right"
    return None


def dock_busy(poses: list[tuple[str, float]], since: float, now: float) -> bool:
    """Return True if any recent pose after `since` should keep a docked pet popped out."""
    for pose, at in poses:
        if at <= since:
            continue
        age = now - at
        if pose == "asking":
            if age < 600.0:
                return True
        elif pose in ("happy", "proud", "oops", "surprised"):
            if age < 10.0:
                return True
        elif pose in ("idle", "sleeping", "tired"):
            continue
        else:
            if age < 180.0:
                return True
    return False


def dock_clamp_y(frame: Rect, visible: Rect) -> Rect:
    """Clamp docked window Y in top-down coordinates: top >= visible.min_y, bottom <= visible.max_y + 0.15*h."""
    y = max(visible.min_y, min(frame.y, visible.max_y - frame.h * 0.85))
    return Rect(frame.x, y, frame.w, frame.h)


def dock_edge_x(side: str, width: float, visible: Rect) -> float:
    return visible.min_x if side == "left" else visible.max_x - width


def tuck_x(side: str, cut: float, zoom: float, visible: Rect) -> float:
    return (visible.min_x if side == "left" else visible.max_x) - cut * zoom


def body_rect(r: Rect, tuck: float | None = None) -> Rect:
    """Top-down body area excluding the top bubble margin."""
    t = r.h * BUBBLE_SHARE if tuck is None else tuck
    return Rect(r.x, r.y + t, r.w, max(0.0, r.h - t))


def core_rect(r: Rect) -> Rect:
    """Overlap check area: excludes top bubble margin and left/right transparent margins."""
    return body_rect(r).inset(r.w * SIDE_SHARE, 0.0)


def free_slots(slots: list[Rect], taken: list[Rect]) -> list[Rect]:
    """Return slots from `slots` that do not overlap `taken` (or previously selected slots)."""
    used = list(taken)
    out: list[Rect] = []
    for s in slots:
        cs = core_rect(s)
        if not any(cs.intersects(core_rect(t), inset=1.0) for t in used):
            out.append(s)
            used.append(s)
    return out


def clamp_rect(r: Rect, visible: Rect) -> Rect:
    x = min(max(r.x, visible.min_x), max(visible.min_x, visible.max_x - r.w))
    y = min(max(r.y, visible.min_y), max(visible.min_y, visible.max_y - r.h))
    return Rect(x, y, r.w, r.h)


def companion_slots(main: Rect, count: int, w: float, h: float, visible: Rect) -> list[Rect]:
    """Compute top-down placement slots for `count` companion windows around `main`."""
    if count <= 0 or w <= 0 or h <= 0:
        return []
    vx, vy, vr, vb = visible.min_x, visible.min_y, visible.max_x, visible.max_y

    def fits(r: Rect) -> bool:
        return r.min_x >= vx - 0.01 and r.max_x <= vr + 0.01 and r.min_y >= vy - 0.01 and r.max_y <= vb + 0.01

    top0 = min(max(main.max_y - h, vy), max(vy, vb - h))
    side = 0.0

    def row(y: float, center: bool) -> list[Rect]:
        out: list[Rect] = []
        if center:
            out.append(Rect(main.x, y, w, h))
        x = main.x - w + side
        while x >= vx - 0.01:
            out.append(Rect(x, y, w, h))
            x -= w - side
        x = main.x + max(w, main.w) - side
        while x + w <= vr + 0.01:
            out.append(Rect(x, y, w, h))
            x += w - side
        return out

    def narrow(r: Rect) -> Rect:
        return Rect(r.x + side / 2.0, r.y, max(0.0, r.w - side), r.h)

    def keep(cands: list[Rect], tuck: float) -> list[Rect]:
        main_body = narrow(body_rect(main, main.h * BUBBLE_SHARE if tuck > 0 else 0.0))
        return [r for r in cands if fits(r) and not narrow(body_rect(r, tuck)).intersects(main_body, inset=0.5)]

    def layout(tuck: float) -> list[Rect]:
        main_tuck = main.h * BUBBLE_SHARE if tuck > 0 else 0.0
        pitch = h - tuck
        cands = row(top0, center=False)
        y = min(top0 + tuck, main.y + main_tuck) - h
        while y >= vy - 0.01:
            cands.extend(row(y, center=True))
            y -= pitch
        y = top0 + pitch
        while y + h <= vb + 0.01:
            cands.extend(row(y, center=True))
            y += pitch
        return keep(cands, tuck)

    def grid(tuck: float, from_top: bool) -> list[Rect]:
        pitch = h - tuck
        cands: list[Rect] = []
        y = vy if from_top else vb - h
        while y >= vy - 0.01 and y + h <= vb + 0.01:
            cands.extend(row(y, center=True))
            y += pitch if from_top else -pitch
        return keep(cands, tuck)

    tight = h * BUBBLE_SHARE
    cands = layout(0.0)
    for s in (0.0, w * 2.0 * SIDE_SHARE):
        side = s
        for fn in (
            lambda: layout(0.0),
            lambda: layout(tight),
            lambda: grid(0.0, False),
            lambda: grid(tight, False),
            lambda: grid(0.0, True),
            lambda: grid(tight, True),
        ):
            if len(cands) >= count:
                break
            more = fn()
            if len(more) > len(cands):
                cands = more

    out = list(cands[:count])
    i = 0
    while len(out) < count:
        base = Rect(main.x - w, top0, w, h) if not cands else cands[i % len(cands)]
        step = (i // max(len(cands), 1) + 1) * 24.0
        out.append(clamp_rect(Rect(base.x - step, base.y - step, w, h), visible))
        i += 1
    return out


def companion_pick(
    main: Rect,
    others: list[Rect],
    saved: Rect | None,
    total: int,
    w: float,
    h: float,
    visible: Rect,
) -> Rect:
    """Pick placement for a new companion, preferring `saved` if it doesn't collide or starve remaining pets."""
    target = max(total, len(others) + 1)
    planned = companion_slots(main, target, w, h, visible)
    slots = planned + companion_slots(main, 2 * len(others) + 1, w, h, visible)

    def clear(s: Rect, taken: list[Rect]) -> bool:
        cs = core_rect(s)
        return not any(cs.intersects(core_rect(t), inset=1.0) for t in taken)

    if saved is not None and clear(saved, [main] + others):
        if len(free_slots(planned, others + [saved])) >= target - len(others) - 1:
            return saved
    for s in slots:
        if clear(s, others):
            return s
    return slots[-1] if slots else main


def notebook_frame(pet: Rect, w: float, h: float, screen: Rect, overlap: float = 12.0) -> Rect:
    """Position notebook panel next to pet, top-aligned and clamped to visible screen."""
    x = pet.max_x - overlap
    if x + w > screen.max_x:
        x = pet.min_x - w + overlap
    x = min(max(x, screen.min_x), max(screen.min_x, screen.max_x - w))
    y = min(max(pet.min_y, screen.min_y), max(screen.min_y, screen.max_y - h))
    return Rect(x, y, w, h)


def yield_next(yielding: bool, over: bool, key: bool) -> bool:
    """State transition for 'yield' (click-through when modifier pressed over pet)."""
    return over if yielding else (over and key)


def is_newer(tag: str, current: str) -> bool:
    """Compare semver strings; stable releases beat pre-releases of the same core version."""

    def parse(v: str) -> tuple[list[int], list[str]]:
        s = v.strip().lstrip("vV ")
        parts = s.split("-", 1)
        core = [int(p) if p.isdigit() else 0 for p in parts[0].split(".") if p != ""]
        pre = parts[1].split(".") if len(parts) > 1 and parts[1] else []
        return core, pre

    a_core, a_pre = parse(tag)
    b_core, b_pre = parse(current)
    for i in range(max(len(a_core), len(b_core), 3)):
        x = a_core[i] if i < len(a_core) else 0
        y = b_core[i] if i < len(b_core) else 0
        if x != y:
            return x > y
    if not a_pre or not b_pre:
        return (not a_pre) and bool(b_pre)
    for i in range(max(len(a_pre), len(b_pre))):
        if i >= len(a_pre):
            return False
        if i >= len(b_pre):
            return True
        x, y = a_pre[i], b_pre[i]
        if x == y:
            continue
        x_num, y_num = x.isdigit(), y.isdigit()
        if x_num and y_num:
            return int(x) > int(y)
        if x_num:
            return False
        if y_num:
            return True
        return x > y
    return False

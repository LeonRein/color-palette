import random
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import colour
import matplotlib.pyplot as plt
import numpy as np
from tqdm import tqdm

MIN_LIGHTNESS = 0.0
POOL_SIZE = 1000
REFINEMENTS = 20
N = 8  # Number of colors to generate, excluding fixed colors.

# Deutan confusion source point in CIE xy.
DEUTAN_SOURCE_XY = np.array([1.4, -0.4], dtype=float)
# Strength of confusion-line weighting.
CONFUSION_WEIGHT = 0.5
EPS = 1e-12


START_H = 0
START_S = 0.8
START_L = 0.5
END_H = 240
END_S = 0.8
END_L = 0.5

random.seed(42)


@dataclass
class Color:
    channels: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=float))

    @property
    def r(self) -> float:
        return float(self.channels[0])

    @property
    def g(self) -> float:
        return float(self.channels[1])

    @property
    def b(self) -> float:
        return float(self.channels[2])

    @property
    def rgb(self) -> np.ndarray:
        return self.channels

    def get_random(self) -> "Color":
        # Generates a random color in Oklch and converts it to sRGB.
        lightness = random.uniform(MIN_LIGHTNESS, 1)
        chroma = random.uniform(0, 1)
        hue = random.uniform(0, 360)

        oklab = colour.Oklch_to_Oklab([lightness, chroma, hue])
        xyz = colour.Oklab_to_XYZ(oklab)
        rgb = colour.XYZ_to_sRGB(xyz)

        if any(channel < 0.0 or channel > 1.0 for channel in rgb):
            return self.get_random()  # Regenerate if out of gamut.

        return Color(channels=np.asarray(rgb, dtype=float))

    def __str__(self) -> str:
        return f"#{int(self.r * 255):02x}{int(self.g * 255):02x}{int(self.b * 255):02x}"

    def from_hsl(h: float, s: float, l: float) -> "Color":
        h_norm = (h / 360.0) if h > 1.0 else h
        h_norm = h_norm % 1.0
        rgb = colour.HSL_to_RGB([h_norm, s, l])
        return Color(channels=np.asarray(rgb, dtype=float))


START_COLOR = Color.from_hsl(START_H, START_S, START_L)  # Start with a bright red.
END_COLOR = Color.from_hsl(END_H, END_S, END_L)  # End with a bright blue.


@dataclass
class ColorSpaceBatch:
    rgb: np.ndarray
    xyz: np.ndarray
    oklab: np.ndarray
    xy: np.ndarray


def as_rgb_array(colors: Sequence[Color]) -> np.ndarray:
    if len(colors) == 0:
        return np.empty((0, 3), dtype=float)
    return np.asarray([c.rgb for c in colors], dtype=float)


def transform_rgb_batch(rgb: np.ndarray) -> ColorSpaceBatch:
    rgb = np.asarray(rgb, dtype=float)
    if len(rgb) == 0:
        empty3 = np.empty((0, 3), dtype=float)
        empty2 = np.empty((0, 2), dtype=float)
        return ColorSpaceBatch(rgb=empty3, xyz=empty3, oklab=empty3, xy=empty2)

    xyz = colour.sRGB_to_XYZ(rgb)
    oklab = colour.XYZ_to_Oklab(xyz)
    xy = colour.XYZ_to_xyY(xyz)[:, :2]
    return ColorSpaceBatch(rgb=rgb, xyz=xyz, oklab=oklab, xy=xy)


def pairwise_weighted_distance(
    pool: ColorSpaceBatch,
    fixed: ColorSpaceBatch,
) -> np.ndarray:
    """
    Compute pairwise weighted distance between two color sets.

    Axis conventions used throughout this function:
    - Axis 0: pool index (size P)
    - Axis 1: fixed index (size F)
    - Axis 2: component/channel (size 3 for Oklab, size 2 for xy)

    Input batch shapes:
    - pool.oklab: (P, 3)
    - fixed.oklab: (F, 3)
    - pool.xy: (P, 2)
    - fixed.xy: (F, 2)

    Output shape:
    - distances: (P, F), where distances[i, j] compares pool[i] vs fixed[j].
    """
    if len(fixed.rgb) == 0:
        return np.empty((len(pool.rgb), 0), dtype=float)

    # Broadcast to all pairwise Oklab differences:
    # pool.oklab[:, None, :] -> (P, 1, 3)
    # fixed.oklab[None, :, :] -> (1, F, 3)
    # result oklab_deltas -> (P, F, 3)
    oklab_deltas = pool.oklab[:, None, :] - fixed.oklab[None, :, :]

    # Norm across Oklab components (axis=2) gives one base distance per (pool, fixed) pair.
    # base_distances -> (P, F)
    base_distances = np.linalg.norm(oklab_deltas, axis=2)

    # Pairwise xy vectors from fixed -> pool.
    # v_ab -> (P, F, 2)
    v_ab = pool.xy[:, None, :] - fixed.xy[None, :, :]

    # Midpoint in xy per pair.
    # mid_xy -> (P, F, 2)
    mid_xy = 0.5 * (pool.xy[:, None, :] + fixed.xy[None, :, :])

    # Vector from deutan source to each midpoint.
    # v_src_mid -> (P, F, 2)
    v_src_mid = mid_xy - DEUTAN_SOURCE_XY

    # Norms along xy components, keepdims=True keeps shape (P, F, 1)
    # so division broadcasts cleanly back over the 2 xy components.
    v_ab_norm = np.linalg.norm(v_ab, axis=2, keepdims=True)
    v_src_mid_norm = np.linalg.norm(v_src_mid, axis=2, keepdims=True)

    # Unit vectors in xy plane for both directions.
    # v_ab_n, v_src_mid_n -> (P, F, 2)
    v_ab_n = v_ab / np.maximum(v_ab_norm, EPS)
    v_src_mid_n = v_src_mid / np.maximum(v_src_mid_norm, EPS)

    # Dot product over xy components (axis=2), absolute value for alignment magnitude.
    # alignment -> (P, F)
    alignment = np.abs(np.sum(v_ab_n * v_src_mid_n, axis=2))

    # Per-pair scalar weight and final weighted distance.
    # weight -> (P, F), output -> (P, F)
    weight = 1.0 - CONFUSION_WEIGHT * alignment
    return base_distances * weight


def build_candidate_pool(pool_size: int) -> np.ndarray:
    pool = np.empty((pool_size, 3), dtype=float)
    for i in tqdm(range(pool_size), desc="Generating color pool"):
        pool[i] = Color().get_random().rgb
    return pool


def build_others_rgb(
    fixed_rgb: np.ndarray,
    selected_colors: Sequence[Optional[Color]],
    excluded_index: int,
) -> np.ndarray:
    selected_rgbs = [
        color.rgb
        for i, color in enumerate(selected_colors)
        if color is not None and i != excluded_index
    ]

    if len(selected_rgbs) == 0:
        return fixed_rgb

    if len(fixed_rgb) == 0:
        return np.asarray(selected_rgbs, dtype=float)

    return np.vstack([fixed_rgb, np.asarray(selected_rgbs, dtype=float)])


def choose_best_candidate_index(
    pool_batch: ColorSpaceBatch,
    others_rgb: np.ndarray,
) -> int:
    if len(others_rgb) == 0:
        return int(np.random.randint(len(pool_batch.rgb)))

    others_batch = transform_rgb_batch(others_rgb)
    distances = pairwise_weighted_distance(pool_batch, others_batch)
    min_distances = np.min(distances, axis=1)
    return int(np.argmax(min_distances))


def refine_palette_once(
    pool_batch: ColorSpaceBatch,
    fixed_rgb: np.ndarray,
    selected_colors: List[Optional[Color]],
) -> bool:
    changed = False
    for color_index in range(len(selected_colors)):
        others_rgb = build_others_rgb(fixed_rgb, selected_colors, color_index)
        selected_index = choose_best_candidate_index(pool_batch, others_rgb)

        new_rgb = pool_batch.rgb[selected_index]
        current = selected_colors[color_index]

        if current is None or not np.allclose(current.rgb, new_rgb):
            selected_colors[color_index] = Color(channels=new_rgb.copy())
            changed = True

    return changed


def generate_color_palette(
    n: int = 6,
    refinements: int = 6,
    pool_size: int = 2000,
    fixed: Optional[List[Color]] = None,
) -> List[Color]:
    if fixed is None:
        fixed = []

    pool_rgb = build_candidate_pool(pool_size)
    pool_batch = transform_rgb_batch(pool_rgb)

    fixed_rgb = as_rgb_array(fixed)
    selected_colors: List[Optional[Color]] = [None] * n

    for _ in tqdm(range(refinements), desc="Refining palette"):
        changed = refine_palette_once(pool_batch, fixed_rgb, selected_colors)
        if not changed:
            break

    # Preserve previous behavior: return exactly n selected colors.
    return [c if c is not None else Color() for c in selected_colors]


def show_palette(colors: List[Color]) -> None:
    fig, ax = plt.subplots(figsize=(max(6, len(colors) * 1.2), 2))
    ax.set_xlim(0, len(colors))
    ax.set_ylim(0, 1)

    for i, color in enumerate(colors):
        ax.add_patch(plt.Rectangle((i, 0), 1, 1, color=color.rgb))
        ax.text(
            i + 0.5,
            0.5,
            str(color),
            ha="center",
            va="center",
            fontsize=10,
            color="white" if np.mean(color.rgb) < 0.5 else "black",
        )

    ax.set_xticks(np.arange(len(colors)) + 0.5)
    ax.set_xticklabels([str(c) for c in colors], rotation=45, ha="right")
    ax.set_yticks([])

    for spine in ax.spines.values():
        spine.set_visible(False)

    plt.tight_layout()
    plt.show()


def main() -> None:
    fixed = [
        Color(channels=np.array([0.0, 0.0, 0.0])),  # Black
        # Color(channels=np.array([1.0, 1.0, 1.0])),  # White
        # Color(channels=np.array([1.0, 1.0, 0.0])),  # Yellow
        # START_COLOR,
        # END_COLOR,
    ]

    colors = generate_color_palette(
        fixed=fixed,
        n=N,
        refinements=REFINEMENTS,
        pool_size=POOL_SIZE,
    )

    # colors = [START_COLOR, *colors, END_COLOR]

    for color in colors:
        print(color)

    show_palette(colors)


if __name__ == "__main__":
    main()

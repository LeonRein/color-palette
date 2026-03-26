import random
from dataclasses import dataclass, field
from typing import List, Optional

import colour
import matplotlib.pyplot as plt
import numpy as np
from numpy.random.mtrand import f
from tqdm import tqdm

MIN_LIGHTNESS = 0.2
POOL_SIZE = 1000
REFINEMENTS = 20
N = 6


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
    def xyy(self) -> np.ndarray:
        xyz = colour.sRGB_to_XYZ(self.channels)
        xyy = colour.XYZ_to_xyY(xyz)
        return xyy

    @property
    def oklab(self) -> np.ndarray:
        xyz = colour.sRGB_to_XYZ(self.channels)
        oklab = colour.XYZ_to_Oklab(xyz)
        return oklab

    @property
    def rgb(self) -> np.ndarray:
        return self.channels

    def distance_to(self, other: "Color") -> float:
        return float(np.linalg.norm(self.oklab - other.oklab))

    def get_random(self) -> "Color":
        # generates a random color in oklch and converts it to rgb using colour-science
        lightness = random.uniform(MIN_LIGHTNESS, 1)
        chroma = random.uniform(0, 1)
        hue = random.uniform(0, 360)

        oklab = colour.Oklch_to_Oklab([lightness, chroma, hue])
        xyz = colour.Oklab_to_XYZ(oklab)
        rgb = colour.XYZ_to_sRGB(xyz)

        if any(channel < 0.0 or channel > 1.0 for channel in rgb):
            return self.get_random()  # Regenerate if the color is out of gamut

        return Color(channels=np.asarray(rgb, dtype=float))

    def __str__(self) -> str:
        return f"#{int(self.r * 255):02x}{int(self.g * 255):02x}{int(self.b * 255):02x}"


def calc_distances(pool: np.ndarray, fixed: np.ndarray) -> np.ndarray:
    if len(fixed) == 0:
        return np.empty((len(pool), 0), dtype=float)

    pool_xyz = colour.sRGB_to_XYZ(pool)
    pool_oklab = colour.XYZ_to_Oklab(pool_xyz)

    fixed_xyz = colour.sRGB_to_XYZ(fixed)
    fixed_oklab = colour.XYZ_to_Oklab(fixed_xyz)

    delta = pool_oklab[:, np.newaxis, :] - fixed_oklab[np.newaxis, :, :]
    distances = np.linalg.norm(delta, axis=2)
    return distances


def generate_color_palette(
    n: int = 6, refinements: int = 6, pool_size: int = 2000, fixed: List[Color] = []
) -> List[Color]:
    pool = np.empty((pool_size, 3), dtype=float)
    for i in tqdm(range(pool_size), desc="Generating color pool"):
        pool[i] = Color().get_random().rgb
    fixed_rgb = np.array([color.rgb for color in fixed], dtype=float)
    selected_colors: List[Optional[Color]] = [None] * n
    for _ in tqdm(range(refinements), desc="Refining palette"):
        for color_index in range(n):
            others = np.vstack(
                [fixed_rgb]
                + [color.rgb for color in selected_colors if color is not None]
            )
            distances = calc_distances(pool, others)
            min_distances = np.min(distances, axis=1)
            selected_index = np.argmax(min_distances)
            selected_colors[color_index] = Color(channels=pool[selected_index])

        show_palette([color for color in selected_colors if color is not None])

    return selected_colors


def show_palette(colors: List[Color]) -> None:
    swatches = colors
    fig, ax = plt.subplots(figsize=(max(6, len(swatches) * 1.2), 2))
    ax.set_xlim(0, len(swatches))
    ax.set_ylim(0, 1)

    for i, color in enumerate(swatches):
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

    ax.set_xticks(np.arange(len(swatches)) + 0.5)
    ax.set_xticklabels([str(c) for c in swatches], rotation=45, ha="right")
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    plt.tight_layout()
    plt.show()


def main():
    fixed = [
        Color(channels=np.array([0.0, 0.0, 0.0])),  # Black
        Color(channels=np.array([1.0, 1.0, 1.0])),  # White
        Color(channels=np.array([0.0, 0.0, 1.0])),  # Blue
    ]
    colors = generate_color_palette(
        fixed=fixed, n=N, refinements=REFINEMENTS, pool_size=POOL_SIZE
    )

    for color in colors:
        print(color)

    show_palette(colors)


if __name__ == "__main__":
    main()

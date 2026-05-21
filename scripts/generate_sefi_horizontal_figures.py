from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


OUTPUT_DIR = Path("docs/SEFI_Figures")

MODELS = ["GPT-5-mini", "Grok-4.1-fast", "DeepSeek-V3.2"]
HIT_RATE = [92.5, 98.8, 95.0]
FIDELITY = [0.92, 0.93, 0.92]
TOKEN_COST = [19605, 15949, 8754]

COLORS = ["#4C78A8", "#F58518", "#54A24B"]
EDGE_COLOR = "#333333"


def style_axis(ax: plt.Axes) -> None:
    ax.set_axisbelow(True)
    ax.grid(axis="y", linestyle="--", linewidth=0.8, alpha=0.35)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)


def add_bar_labels(ax: plt.Axes, bars, fmt: str, offset: float) -> None:
    for bar in bars:
        height = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            height + offset,
            format(height, fmt),
            ha="center",
            va="bottom",
            fontsize=10,
        )


def save_figure(fig: plt.Figure, stem: str) -> None:
    svg_path = OUTPUT_DIR / f"{stem}.svg"
    png_path = OUTPUT_DIR / f"{stem}.png"
    fig.savefig(svg_path, format="svg", bbox_inches="tight", dpi=300)
    fig.savefig(png_path, format="png", bbox_inches="tight", dpi=300)
    plt.close(fig)


def build_hit_fidelity() -> None:
    x = np.arange(len(MODELS))
    fig, axes = plt.subplots(1, 2, figsize=(8.6, 3.8), constrained_layout=True)

    hit_bars = axes[0].bar(x, HIT_RATE, color=COLORS, edgecolor=EDGE_COLOR, linewidth=1.0)
    axes[0].set_title("Task B: Hit Rate", fontsize=12, pad=10)
    axes[0].set_ylabel("Hit Rate (%)")
    axes[0].set_xticks(x, MODELS)
    axes[0].set_ylim(0, 110)
    style_axis(axes[0])
    add_bar_labels(axes[0], hit_bars, ".1f", 1.5)

    fidelity_bars = axes[1].bar(x, FIDELITY, color=COLORS, edgecolor=EDGE_COLOR, linewidth=1.0)
    axes[1].set_title("Task B: Fidelity", fontsize=12, pad=10)
    axes[1].set_ylabel("Average Fidelity")
    axes[1].set_xticks(x, MODELS)
    axes[1].set_ylim(0, 1.05)
    style_axis(axes[1])
    add_bar_labels(axes[1], fidelity_bars, ".2f", 0.02)

    fig.suptitle("Closed-loop adjustment improves hit rate while maintaining high fidelity", fontsize=13)
    save_figure(fig, "figure_3_task_b_hit_fidelity_horizontal")


def build_token_cost() -> None:
    x = np.arange(len(MODELS))
    fig, ax = plt.subplots(figsize=(6.2, 3.8), constrained_layout=True)

    bars = ax.bar(x, TOKEN_COST, color=COLORS, edgecolor=EDGE_COLOR, linewidth=1.0)
    ax.set_title("Task B: Token Consumption Comparison", fontsize=12, pad=10)
    ax.set_ylabel("Average Total Tokens")
    ax.set_xticks(x, MODELS)
    ax.set_ylim(0, 22000)
    style_axis(ax)

    for bar in bars:
        height = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            height + 350,
            f"{height:,.0f}",
            ha="center",
            va="bottom",
            fontsize=10,
        )

    save_figure(fig, "figure_5_task_b_token_cost_horizontal")


def main() -> None:
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "axes.titlesize": 12,
            "axes.labelsize": 11,
            "xtick.labelsize": 10,
            "ytick.labelsize": 10,
        }
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_hit_fidelity()
    build_token_cost()


if __name__ == "__main__":
    main()

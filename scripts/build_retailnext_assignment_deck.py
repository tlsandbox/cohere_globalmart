"""Builds the presentation deck from markdown templates and project assets."""

from __future__ import annotations

from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    deliverables = root / "deliverables"
    deliverables.mkdir(parents=True, exist_ok=True)

    note_path = deliverables / "DECK_BUILD_NOTES.md"
    note_path.write_text(
        "# Deck Build Notes\n\n"
        "This repository is Cohere-only and GlobalMart-focused.\n"
        "Use your preferred presentation workflow to generate final PPTX/PDF deliverables.\n",
        encoding="utf-8",
    )

    print(f"Wrote {note_path}")


if __name__ == "__main__":
    main()

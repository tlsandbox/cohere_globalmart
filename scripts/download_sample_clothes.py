"""Downloads and prepares the sample clothing dataset used by the local demo."""

from __future__ import annotations

import argparse
import os
import shutil
import zipfile
from pathlib import Path


REQUIRED_FILES = (
    "sample_styles.csv",
    "sample_styles_with_embeddings.csv",
)
REQUIRED_DIRS = (
    "sample_images",
)


def _has_required_dataset(dest_dir: Path) -> bool:
    for file_name in REQUIRED_FILES:
        if not (dest_dir / file_name).exists():
            return False
    for dir_name in REQUIRED_DIRS:
        path = dest_dir / dir_name
        if not path.exists() or not path.is_dir():
            return False
    return True


def _extract_zip(zip_path: Path, dest_dir: Path) -> None:
    tmp_dir = dest_dir.parent / ".tmp_sample_data"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(tmp_dir)

    candidates = [tmp_dir]
    candidates.extend([path for path in tmp_dir.iterdir() if path.is_dir()])

    source_dir = None
    for candidate in candidates:
        if _has_required_dataset(candidate):
            source_dir = candidate
            break

    if source_dir is None:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise FileNotFoundError(
            "Could not find required sample dataset files in the provided zip. "
            "Expected files: sample_styles.csv, sample_styles_with_embeddings.csv, sample_images/."
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    for file_name in REQUIRED_FILES:
        shutil.copy2(source_dir / file_name, dest_dir / file_name)

    images_dir = dest_dir / "sample_images"
    if images_dir.exists():
        shutil.rmtree(images_dir)
    shutil.copytree(source_dir / "sample_images", images_dir)

    shutil.rmtree(tmp_dir, ignore_errors=True)


def prepare_sample_clothes(dest_dir: Path, from_zip: Path | None = None) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)

    if _has_required_dataset(dest_dir):
        print(f"Dataset already present at {dest_dir}")
        return

    if from_zip is None:
        raise FileNotFoundError(
            "Sample dataset is missing. Provide a zip archive with --from-zip "
            "or place dataset files directly into data/sample_clothes/."
        )

    if not from_zip.exists():
        raise FileNotFoundError(f"Zip file not found: {from_zip}")

    print(f"Extracting sample dataset from {from_zip} ...")
    _extract_zip(from_zip, dest_dir)

    if not _has_required_dataset(dest_dir):
        raise RuntimeError("Dataset extraction completed but required files are still missing.")

    print(f"Dataset prepared at {dest_dir}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dest",
        default=str(Path(__file__).resolve().parents[1] / "data" / "sample_clothes"),
        help="Destination directory for sample_clothes",
    )
    parser.add_argument(
        "--from-zip",
        default="",
        help="Path to a local zip archive containing sample_clothes files.",
    )
    args = parser.parse_args()

    dest_dir = Path(os.path.expanduser(args.dest)).resolve()
    from_zip = Path(os.path.expanduser(args.from_zip)).resolve() if args.from_zip else None
    prepare_sample_clothes(dest_dir=dest_dir, from_zip=from_zip)


if __name__ == "__main__":
    main()

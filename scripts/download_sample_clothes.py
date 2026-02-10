from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


REPO_URL = "https://github.com/openai/openai-cookbook.git"
SPARSE_PATH = "examples/data/sample_clothes"


def _run(cmd: list[str], cwd: Path) -> None:
    subprocess.run(cmd, cwd=str(cwd), check=True)


def download_sample_clothes(dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    if (dest_dir / "sample_styles_with_embeddings.csv").exists():
        print(f"Already present: {dest_dir}")
        return

    tmp = dest_dir.parent / ".tmp_openai_cookbook"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True, exist_ok=True)

    print("Cloning OpenAI Cookbook (sparse)…")
    _run(["git", "clone", "--filter=blob:none", "--no-checkout", REPO_URL, str(tmp)], cwd=dest_dir.parent)
    _run(["git", "sparse-checkout", "init", "--cone"], cwd=tmp)
    _run(["git", "sparse-checkout", "set", SPARSE_PATH], cwd=tmp)
    _run(["git", "checkout"], cwd=tmp)

    src = tmp / SPARSE_PATH
    print(f"Copying {src} -> {dest_dir}")
    for child in src.iterdir():
        target = dest_dir / child.name
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)

    shutil.rmtree(tmp, ignore_errors=True)
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dest",
        default=str(Path(__file__).resolve().parents[1] / "data" / "sample_clothes"),
        help="Destination directory for sample_clothes",
    )
    args = parser.parse_args()

    dest_dir = Path(os.path.expanduser(args.dest)).resolve()
    download_sample_clothes(dest_dir)


if __name__ == "__main__":
    main()


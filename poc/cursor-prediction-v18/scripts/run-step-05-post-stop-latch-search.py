#!/usr/bin/env python
"""Run v18 Step 05 C# post-stop latch search."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
STEP = ROOT / "poc" / "cursor-prediction-v18" / "step-05-post-stop-latch-search"
PROJECT = STEP / "harness" / "BrakeGateHarness.csproj"
CONFIG = STEP / "replay-config.json"


def main() -> int:
    dotnet = r"C:\Program Files\dotnet\dotnet.exe"
    env = {
        **os.environ,
        "APPDATA": str(STEP / ".appdata"),
        "DOTNET_CLI_HOME": str(STEP / ".dotnet-home"),
        "DOTNET_SKIP_FIRST_TIME_EXPERIENCE": "1",
        "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
        "NUGET_PACKAGES": str(STEP / ".nuget-packages"),
    }
    (STEP / ".appdata" / "NuGet").mkdir(parents=True, exist_ok=True)
    (STEP / ".appdata" / "NuGet" / "NuGet.Config").write_text(
        '<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear /></packageSources></configuration>',
        encoding="utf-8",
    )
    for args in (
        [dotnet, "build", str(PROJECT)],
        [dotnet, "run", "--project", str(PROJECT), "--", str(CONFIG)],
    ):
        proc = subprocess.run(args, cwd=str(ROOT), env=env, text=True)
        if proc.returncode != 0:
            return proc.returncode

    for name in ("bin", "obj"):
        target = PROJECT.parent / name
        if target.exists():
            shutil.rmtree(target)
    for name in (".appdata", ".dotnet-home"):
        target = STEP / name
        if target.exists():
            shutil.rmtree(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

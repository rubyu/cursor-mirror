#!/usr/bin/env python
"""Run v17 Step 10 lag overlay C# grid.

This script copies product generated DistilledMLP source into the Step 10
harness overlay, patches LagCompensationPixels, builds, and runs one lag at a
time. Product source is not modified.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
STEP = ROOT / "poc" / "cursor-prediction-v17" / "step-10-csharp-lag-overlay-grid"
PROJECT = STEP / "harness" / "LagOverlayHarness.csproj"
OVERLAY = STEP / "harness" / "Overlay" / "DistilledMlpPredictionModel.g.cs"
SOURCE = ROOT / "src" / "CursorMirror.Core" / "DistilledMlpPredictionModel.g.cs"


def lag_id(value: float) -> str:
    return str(value).replace(".", "p")


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
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><configuration><packageSources><clear /></packageSources></configuration>",
        encoding="utf-8",
    )
    template = (STEP / "replay-config-template.json").read_text(encoding="utf-8")
    source = SOURCE.read_text(encoding="utf-8")
    for lag in [0.0, 0.125, 0.25, 0.5]:
        patched = re.sub(r"public const float LagCompensationPixels = [-0-9.]+f;", f"public const float LagCompensationPixels = {lag}f;", source)
        OVERLAY.write_text(patched, encoding="utf-8")
        config_text = template.replace("{{lag}}", str(lag)).replace("{{lag_id}}", lag_id(lag))
        config_path = STEP / f"replay-config-lag{lag_id(lag)}.json"
        config_path.write_text(config_text, encoding="utf-8")
        for args in ([dotnet, "build", str(PROJECT)], [dotnet, "run", "--project", str(PROJECT), "--", str(config_path)]):
            proc = subprocess.run(args, cwd=str(ROOT), env=env, text=True)
            if proc.returncode != 0:
                return proc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

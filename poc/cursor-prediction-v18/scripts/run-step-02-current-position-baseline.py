#!/usr/bin/env python
"""Run v18 Step 02 current-position C# baseline.

The script patches the POC-local generated model overlay for lag0 and lag0.5,
then runs the C# chronological replay. Product source is not modified.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
STEP = ROOT / "poc" / "cursor-prediction-v18" / "step-02-current-position-baseline"
PROJECT = STEP / "harness" / "CurrentPositionHarness.csproj"
SOURCE = ROOT / "src" / "CursorMirror.Core" / "DistilledMlpPredictionModel.g.cs"
OVERLAY = STEP / "harness" / "Overlay" / "DistilledMlpPredictionModel.g.cs"


def lag_id(value: str) -> str:
    return value.replace(".", "p")


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
    src = SOURCE.read_text(encoding="utf-8")
    template = (STEP / "replay-config-template.json").read_text(encoding="utf-8")
    for lag in ["0.0", "0.5"]:
        patched = re.sub(r"public const float LagCompensationPixels = [-0-9.]+f;", f"public const float LagCompensationPixels = {lag}f;", src)
        OVERLAY.write_text(patched, encoding="utf-8")
        config = template.replace("{{lag}}", lag).replace("{{lag_id}}", lag_id(lag))
        config_path = STEP / f"replay-config-lag{lag_id(lag)}.json"
        config_path.write_text(config, encoding="utf-8")
        for args in ([dotnet, "build", str(PROJECT)], [dotnet, "run", "--project", str(PROJECT), "--", str(config_path)]):
            proc = subprocess.run(args, cwd=str(ROOT), env=env, text=True)
            if proc.returncode != 0:
                return proc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

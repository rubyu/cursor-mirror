#!/usr/bin/env python
"""Run v17 Step 9 C# tail guard search.

Uses the full dotnet path when dotnet is not on PATH and redirects dotnet/NuGet
user folders into the Step 9 directory so the run stays inside the POC scope.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
STEP = ROOT / "poc" / "cursor-prediction-v17" / "step-09-csharp-tail-guard-search"
PROJECT = STEP / "harness" / "TailGuardHarness.csproj"
CONFIG = STEP / "replay-config.json"


def main() -> int:
    full = Path(r"C:\Program Files\dotnet\dotnet.exe")
    dotnet = str(full) if full.exists() else shutil.which("dotnet")
    if not dotnet:
        raise SystemExit("dotnet not found")

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

    for args in (
        [dotnet, "--info"],
        [dotnet, "build", str(PROJECT)],
        [dotnet, "run", "--project", str(PROJECT), "--", str(CONFIG)],
    ):
        proc = subprocess.run(args, cwd=str(ROOT), env=env, text=True)
        if proc.returncode != 0:
            return proc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

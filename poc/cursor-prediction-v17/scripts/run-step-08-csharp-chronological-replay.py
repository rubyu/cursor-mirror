#!/usr/bin/env python
"""Run v17 Step 8 C# chronological replay harness.

The harness links product C# predictor source into a small local project under
step-08-csharp-chronological-replay/harness. It reads source ZIP trace.csv files
in place and writes only compact JSON/report artifacts.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
V17 = ROOT / "poc" / "cursor-prediction-v17"
STEP = V17 / "step-08-csharp-chronological-replay"
HARNESS = STEP / "harness" / "CursorReplayHarness.csproj"
DIRECT_OUT = STEP / "csharp-harness-output.json"
SCORES = STEP / "scores.json"


def main() -> int:
    STEP.mkdir(parents=True, exist_ok=True)
    config_path = STEP / "replay-config.json"
    config = {
        "outputPath": str(DIRECT_OUT),
        "horizonCapMs": 0,
        "offsetsMs": [0, -2, -4],
        "packages": [
            {
                "packageId": "m070248",
                "zipPath": str(ROOT / "cursor-mirror-motion-recording-20260504-070248.zip"),
                "warmupMs": 1500.0,
                "excludeMs": [{"startMs": 0.0, "endMs": 795.648}],
            },
            {
                "packageId": "m070307",
                "zipPath": str(ROOT / "cursor-mirror-motion-recording-20260504-070307.zip"),
                "warmupMs": 1500.0,
                "excludeMs": [],
            },
        ],
    }
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    full_path_dotnet = Path(r"C:\Program Files\dotnet\dotnet.exe")
    dotnet = str(full_path_dotnet) if full_path_dotnet.exists() else shutil.which("dotnet")
    build = {
        "attempted": bool(dotnet),
        "dotnetPath": dotnet,
        "exitCode": None,
        "stdoutTail": "",
        "stderrTail": "",
    }
    direct = None
    if dotnet:
        proc = subprocess.run(
            [dotnet, "run", "--project", str(HARNESS), "--", str(config_path)],
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            check=False,
            env={
                **__import__("os").environ,
                "APPDATA": str(STEP / ".appdata"),
                "DOTNET_CLI_HOME": str(STEP / ".dotnet-home"),
                "DOTNET_SKIP_FIRST_TIME_EXPERIENCE": "1",
                "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
                "NUGET_PACKAGES": str(STEP / ".nuget-packages"),
            },
        )
        build.update(
            {
                "exitCode": proc.returncode,
                "stdoutTail": proc.stdout[-4000:],
                "stderrTail": proc.stderr[-4000:],
            }
        )
        if proc.returncode == 0 and DIRECT_OUT.exists():
            direct = json.loads(DIRECT_OUT.read_text(encoding="utf-8"))

    step7_path = V17 / "step-07-offset-validity-and-calibrator-check" / "scores.json"
    step7 = json.loads(step7_path.read_text(encoding="utf-8"))
    refs = {
        name: step7["candidates"][name]["summary"]
        for name in [
            "lag0p5_offset0p0ms",
            "lag0p5_offsetm2p0ms",
            "lag0p5_offsetm4p0ms",
            "lag0p0_offset0p0ms",
            "lag0p0_offsetm4p0ms",
        ]
    }
    scores = {
        "schemaVersion": "cursor-prediction-v17-step-08-csharp-chronological-replay/1",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "productSourceEdited": False,
            "gpuTrainingRun": False,
            "rawExpandedCsvCopied": False,
            "heavyParallelism": False,
        },
        "inputs": config,
        "buildAndRun": build,
        "csharpHarness": direct
        or {
            "success": False,
            "reason": "dotnet CLI unavailable or harness run failed in this environment",
            "directProductPredictor": False,
        },
        "productApiFindings": {
            "predictorClass": "src/CursorMirror.Core/DwmAwareCursorPositionPredictor.cs",
            "sampleClass": "src/CursorMirror.Core/CursorPollSample.cs",
            "settingsClass": "src/CursorMirror.Core/CursorMirrorSettings.cs",
            "distilledModel": "src/CursorMirror.Core/DistilledMlpPredictionModel.g.cs",
            "publicOffsetSetter": "ApplyPredictionTargetOffsetMilliseconds(int), range -8..8 ms",
            "modelSelector": "ApplyPredictionModel(CursorMirrorSettings.DwmPredictionModelDistilledMlp)",
            "lag0Blocked": True,
            "lag0Blocker": "LagCompensationPixels is public const float 0.5f in generated model and ApplyLagCompensation is private; no public predictor setting changes it.",
        },
        "pythonStep7FixedSliceReference": refs,
        "conclusion": {
            "abc": "C",
            "text": "A local C# harness source was created, but direct C# replay cannot be completed unless dotnet is available. Product lag0 cannot be directly evaluated without regenerating or altering the generated DistilledMLP source. The strongest currently quantified evidence remains Step 7 fixed-slice reference, where offset -4 ms dominates offset 0 ms for stop overshoot/jitter.",
        },
    }
    SCORES.write_text(json.dumps(scores, indent=2), encoding="utf-8")
    return 0 if dotnet and build["exitCode"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

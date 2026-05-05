#!/usr/bin/env python
"""Step 01 inventory for cursor-prediction-v17.

Scans existing artifacts and data locations without copying raw data.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


SCHEMA_VERSION = "cursor-prediction-v17-step-01-data-inventory/1"


def file_entry(path: Path, root: Path) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(root)),
        "bytes": path.stat().st_size,
        "lastWriteTimeUtc": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
    }


def summarize_poc(path: Path, root: Path) -> dict[str, Any]:
    files = [p for p in path.rglob("*") if p.is_file()]
    key_files = [p for p in files if p.name in ("README.md", "report.md", "scores.json", "notes.md") or p.suffix in (".py", ".cs", ".json")]
    return {
        "path": str(path.relative_to(root)),
        "exists": path.exists(),
        "fileCount": len(files),
        "totalBytes": sum(p.stat().st_size for p in files),
        "keyFiles": [file_entry(p, root) for p in sorted(key_files)[:40]],
    }


def summarize_zips(root: Path) -> dict[str, Any]:
    zips = sorted(root.glob("*.zip"))
    by_kind = Counter()
    entries = []
    for path in zips:
        name = path.name
        if "motion-recording" in name:
            kind = "motion-recording"
        elif "trace" in name:
            kind = "trace"
        elif "calibration" in name:
            kind = "calibration"
        else:
            kind = "other"
        by_kind[kind] += 1
        entries.append({**file_entry(path, root), "kind": kind})
    return {
        "count": len(entries),
        "totalBytes": sum(item["bytes"] for item in entries),
        "byKind": dict(by_kind),
        "entries": entries,
    }


def safe_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def latest_analysis_dirs(root: Path) -> list[dict[str, Any]]:
    base = root / "artifacts" / "analysis"
    if not base.exists():
        return []
    out = []
    for path in sorted([p for p in base.iterdir() if p.is_dir()])[-24:]:
        reports = [p for p in path.rglob("report.md")]
        scores = [p for p in path.rglob("scores.json")]
        out.append({
            "path": str(path.relative_to(root)),
            "reportCount": len(reports),
            "scoreCount": len(scores),
            "totalBytes": sum(p.stat().st_size for p in path.rglob("*") if p.is_file()),
        })
    return out


def write_report(out_dir: Path, scores: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, summary in scores["priorPocs"].items():
        rows.append(f"| {name} | `{summary['path']}` | {summary['fileCount']} | {summary['totalBytes']} |")
    zip_rows = []
    for item in scores["rawData"]["rootZipFiles"]["entries"]:
        zip_rows.append(f"| `{item['path']}` | {item['kind']} | {item['bytes']} |")
    source_rows = []
    for item in scores["codeLocations"]:
        source_rows.append(f"| `{item['path']}` | {item['exists']} |")
    report = f"""# Step 01 - Data Inventory

## Scope

This inventory records where v17 can read prior POCs, MotionLab/mouse trace/calibration data, and related product code. It does not copy raw data.

## Prior POCs

| POC | path | files | bytes |
| --- | --- | ---: | ---: |
{chr(10).join(rows)}

## Raw Data At Repository Root

- ZIP count: {scores['rawData']['rootZipFiles']['count']}
- Total ZIP bytes: {scores['rawData']['rootZipFiles']['totalBytes']}
- By kind: `{scores['rawData']['rootZipFiles']['byKind']}`

| zip | kind | bytes |
| --- | --- | ---: |
{chr(10).join(zip_rows)}

## Reusable Split And Runtime Inputs

- Split manifest: `{scores['splitManifest']['path']}`
- v16 selected runtime descriptor: `{scores['v16SelectedRuntime']['path']}`
- v16 selected model: `{scores['v16SelectedRuntime']['modelId']}`

## Product And Analysis Locations

| location | exists |
| --- | --- |
{chr(10).join(source_rows)}

## Notes

- Step 2 should read MotionLab ZIPs in place through the POC13 loader.
- The first analysis target is Step5 vs v16 selected DistilledMLP, not retraining.
- Raw ZIPs, expanded CSVs, checkpoints, and tensor dumps remain out of scope for v17 artifacts.
"""
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    (out_dir / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    notes = """# Step 01 Notes

- Inventory-only step.
- No raw data was copied.
- Large source inputs remain in their original repository-root ZIP files and existing `artifacts/` folders.
- Step 2 will compute stop/overshoot metrics from 60Hz rows using CPU inference only.
"""
    (out_dir / "notes.md").write_text(notes, encoding="utf-8")


def main() -> int:
    root = Path(__file__).resolve().parents[3]
    out_dir = root / "poc" / "cursor-prediction-v17" / "step-01-data-inventory"
    selected = safe_json(root / "poc" / "cursor-prediction-v16" / "runtime" / "selected-candidate.json") or {}
    code_locations = [
        root / "src" / "CursorMirror.Core" / "MouseTrace",
        root / "src" / "CursorMirror.Core" / "MotionLab",
        root / "src" / "CursorMirror.Core" / "MotionLabInputBlocker.cs",
        root / "src" / "CursorMirror.MotionLab",
        root / "src" / "CursorMirror.Calibrator",
        root / "artifacts" / "analysis",
        root / "artifacts" / "calibration",
        root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json",
    ]
    scores = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "rawDataCopied": False,
            "expandedCsvWritten": False,
            "checkpointWritten": False,
            "tensorDumpWritten": False,
            "gpuTrainingRun": False,
        },
        "priorPocs": {
            "v14": summarize_poc(root / "poc" / "cursor-prediction-v14", root),
            "v15": summarize_poc(root / "poc" / "cursor-prediction-v15", root),
            "v16": summarize_poc(root / "poc" / "cursor-prediction-v16", root),
        },
        "rawData": {
            "rootZipFiles": summarize_zips(root),
            "analysisDirectories": latest_analysis_dirs(root),
            "calibrationArtifacts": [file_entry(p, root) for p in sorted((root / "artifacts" / "calibration").glob("*.zip"))] if (root / "artifacts" / "calibration").exists() else [],
        },
        "splitManifest": {
            "path": "poc/cursor-prediction-v12/step-2-clean-split/split-manifest.json",
            "exists": (root / "poc" / "cursor-prediction-v12" / "step-2-clean-split" / "split-manifest.json").exists(),
        },
        "v16SelectedRuntime": {
            "path": "poc/cursor-prediction-v16/runtime/selected-candidate.json",
            "exists": bool(selected),
            "modelId": selected.get("modelId"),
            "family": selected.get("family"),
            "target": selected.get("target"),
            "runtime": {
                "type": selected.get("runtime", {}).get("type"),
                "activation": selected.get("runtime", {}).get("activation"),
                "hidden": selected.get("runtime", {}).get("hidden"),
                "quantizationStep": selected.get("runtime", {}).get("quantizationStep"),
                "lagCompensationPx": selected.get("runtime", {}).get("lagCompensationPx"),
            },
        },
        "codeLocations": [{"path": str(p.relative_to(root)), "exists": p.exists()} for p in code_locations],
    }
    write_report(out_dir, scores)
    print(json.dumps({"step": "01", "outDir": str(out_dir), "zipCount": scores["rawData"]["rootZipFiles"]["count"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

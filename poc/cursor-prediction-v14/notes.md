# Notes

Run command:

```powershell
$env:UV_CACHE_DIR=(Resolve-Path '.uv-cache').Path
$env:UV_PYTHON_INSTALL_DIR=(Join-Path (Get-Location) '.uv-python')
uv run --python 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' --with numpy==2.4.3 --with torch==2.11.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128 python poc\cursor-prediction-v14\scripts\run-60hz-distillation-gpu.py
```

The experiment is intentionally 60Hz-only. It is not a 30Hz product decision.

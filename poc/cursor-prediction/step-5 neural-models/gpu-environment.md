# GPU Environment

This environment is local to Step 5 and is not intended to be committed.

## Current Result

`uv` is installed at:

```powershell
C:\Users\seigl\.local\bin\uv.exe
```

The Step 5 virtual environment is:

```powershell
poc\cursor-prediction\step-5 neural-models\.venv
```

Verified packages:

| item | value |
|---|---|
| Python | `3.12.13` |
| NumPy | `2.4.3` |
| PyTorch | `2.11.0+cu128` |
| PyTorch CUDA runtime | `12.8` |
| CUDA available from PyTorch | `True` |
| GPU | `NVIDIA GeForce RTX 5090` |

## Recreate

From the repository root:

```powershell
$env:UV_CACHE_DIR = (Join-Path (Resolve-Path .).Path 'artifacts\uv-cache')
& 'C:\Users\seigl\.local\bin\uv.exe' venv 'poc\cursor-prediction\step-5 neural-models\.venv' --python 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& 'C:\Users\seigl\.local\bin\uv.exe' pip install --python 'poc\cursor-prediction\step-5 neural-models\.venv\Scripts\python.exe' -r 'poc\cursor-prediction\step-5 neural-models\requirements-gpu.txt'
```

Verify:

```powershell
& 'poc\cursor-prediction\step-5 neural-models\.venv\Scripts\python.exe' -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

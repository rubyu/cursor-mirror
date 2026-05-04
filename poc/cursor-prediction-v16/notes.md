# Notes

Run command:

```powershell
uv run --python 'C:\Users\seigl\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' --with numpy==2.4.3 --with torch==2.11.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128 python poc\cursor-prediction-v16\scripts\run-runtime-ready-distillation-gpu.py
```

This is a 60Hz-only runtime-readiness POC. It does not promote a 30Hz predictor and does not modify product source.

C# parity command:

```powershell
$env:DOTNET_CLI_HOME=(Join-Path (Get-Location) '.dotnet-cli-home'); $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'; $env:DOTNET_NOLOGO='1'; & 'C:\Program Files\dotnet\dotnet.exe' restore poc\cursor-prediction-v16\runtime\csharp-parity\CSharpParity.csproj --configfile poc\cursor-prediction-v16\runtime\csharp-parity\NuGet.Config
$env:DOTNET_CLI_HOME=(Join-Path (Get-Location) '.dotnet-cli-home'); $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'; $env:DOTNET_NOLOGO='1'; & 'C:\Program Files\dotnet\dotnet.exe' build poc\cursor-prediction-v16\runtime\csharp-parity\CSharpParity.csproj --configuration Release --no-restore --nologo
$env:DOTNET_CLI_HOME=(Join-Path (Get-Location) '.dotnet-cli-home'); $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'; $env:DOTNET_NOLOGO='1'; & 'C:\Program Files\dotnet\dotnet.exe' run --project poc\cursor-prediction-v16\runtime\csharp-parity\CSharpParity.csproj --configuration Release --no-build -- poc\cursor-prediction-v16\runtime\selected-candidate.json poc\cursor-prediction-v16\runtime\csharp-parity\results.json
```

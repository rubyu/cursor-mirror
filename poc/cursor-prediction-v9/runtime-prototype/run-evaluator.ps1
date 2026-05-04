$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sources = @(
  (Join-Path $root 'RuntimeCandidateEvaluator.cs'),
  (Join-Path $root 'RuntimeCandidateWeights.g.cs'),
  (Join-Path $root 'RuntimeCandidateSamples.g.cs')
)
Add-Type -Path $sources -ReferencedAssemblies 'System.Numerics.dll'
[CursorPredictionV9RuntimePrototype.PrototypeRunner]::Run((Join-Path $root 'csharp-verification-result.json'))
Get-Content (Join-Path $root 'csharp-verification-result.json')

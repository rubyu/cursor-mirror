const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const scorePath = path.join(root, "poc/cursor-prediction-v17/step-08-csharp-chronological-replay/scores.json");
const outPath = path.join(root, "poc/cursor-prediction-v17/step-08-csharp-chronological-replay/csharp-harness-output.json");
const s = JSON.parse(fs.readFileSync(scorePath, "utf8"));
const out = JSON.parse(fs.readFileSync(outPath, "utf8"));

s.generatedAtUtc = new Date().toISOString();
s.buildAndRun = {
  dotnetInfoAttempted: true,
  dotnetAvailable: true,
  dotnetPath: "C:\\Program Files\\dotnet\\dotnet.exe",
  dotnetInfo: {
    sdkVersion: "10.0.203",
    msbuildVersion: "18.3.3+c23858a6d",
    hostVersion: "10.0.7",
    rid: "win-x64",
    runtimes: [
      "Microsoft.NETCore.App 10.0.7",
      "Microsoft.WindowsDesktop.App 10.0.7",
      "Microsoft.AspNetCore.App 10.0.7"
    ]
  },
  buildAttempted: true,
  buildSucceeded: true,
  buildCommand: "\"C:\\Program Files\\dotnet\\dotnet.exe\" build poc/cursor-prediction-v17/step-08-csharp-chronological-replay/harness/CursorReplayHarness.csproj",
  buildExitCode: 0,
  buildWarnings: ["CS8632 nullable annotation context warning at Program.cs lines 67 and 211"],
  runAttempted: true,
  runSucceeded: true,
  runCommand: "\"C:\\Program Files\\dotnet\\dotnet.exe\" run --project poc/cursor-prediction-v17/step-08-csharp-chronological-replay/harness/CursorReplayHarness.csproj -- poc/cursor-prediction-v17/step-08-csharp-chronological-replay/replay-config.json",
  runExitCode: 0,
  runOutput: "poc/cursor-prediction-v17/step-08-csharp-chronological-replay/csharp-harness-output.json",
  environmentOverrides: [
    "APPDATA=.appdata under Step8",
    "DOTNET_CLI_HOME=.dotnet-home under Step8",
    "NUGET_PACKAGES=.nuget-packages under Step8",
    "DOTNET_CLI_TELEMETRY_OPTOUT=1"
  ]
};

s.csharpHarness = out;
s.csharpDirectCandidates = {};
for (const [id, v] of Object.entries(out.candidates)) {
  s.csharpDirectCandidates[id] = {
    status: "scored",
    lagPx: v.lagPx,
    targetOffsetMs: v.targetOffsetMs,
    horizonCapMs: v.horizonCapMs,
    rows: v.rows,
    metrics: v.metrics,
    byPackage: v.byPackage
  };
}
s.csharpDirectCandidates.csharp_lag0_offset0ms = {
  status: "blocked",
  reason: s.productApiFindings.lag0Blocker
};
s.csharpDirectCandidates.csharp_lag0_offsetm4ms = {
  status: "blocked",
  reason: s.productApiFindings.lag0Blocker
};
s.csharpDirectRanking = Object.entries(out.candidates)
  .map(([id, v]) => ({
    id,
    allP95: v.metrics.all.p95,
    stopP95: v.metrics.stopApproach.p95,
    stopOvershootP95: v.metrics.stopApproach.overshootP95,
    postStopJitterP95: v.metrics.postStop.p95,
    highSpeedP95: v.metrics.highSpeed.p95,
    objective: v.metrics.stopApproach.p95 + v.metrics.postStop.p95 + 0.25 * v.metrics.all.p95
  }))
  .sort((a, b) => a.objective - b.objective);

s.interpretation.minus4Evidence = "Direct C# chronological replay through DwmAwareCursorPositionPredictor also favors lag0.5 offset -4ms over offset 0ms and -2ms on all p95, stop p95, post-stop jitter, and high-speed p95. Replay fidelity is medium because controller reset/session boundaries beyond predictor idle gaps are not fully captured.";
s.interpretation.safeImmediateProductChange = "Offset -4ms can move forward as a product candidate behind a guarded setting/flag or controlled validation build. lag0 still requires generated model/runtime shape work before product evaluation.";
s.conclusion = {
  abc: "A-with-gate",
  advanceMinus4ToProductCandidate: true,
  needsAdditionalDataOrEnvironment: false,
  text: "C# chronological replay completed with medium fidelity and supports target offset -4ms as the next product candidate. Do not treat lag0 as directly validated because current generated DistilledMLP source bakes lag0.5 as const."
};
s.nextSteps = [
  "Run the same harness after adding explicit controller reset/session markers to raise fidelity to high.",
  "If lag0 must be tested in C#, generate a POC-only DistilledMlpPredictionModel variant with LagCompensationPixels = 0.0f or add a runtime/generated lag selector.",
  "Consider a small product validation build that sets DwmPredictionTargetOffsetMilliseconds = -4 for DistilledMLP only, with rollback to current offset."
];

fs.writeFileSync(scorePath, JSON.stringify(s, null, 2));

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const step = path.join(root, "poc/cursor-prediction-v17/step-09-csharp-tail-guard-search");
const raw = JSON.parse(fs.readFileSync(path.join(step, "csharp-tail-guard-output.json"), "utf8"));

const candidate = (id) => raw.candidates[id];
const selectedId = "offset_m3p5";
const visualId = "offset_m4";
const selected = candidate(selectedId);
const visual = candidate(visualId);

const scores = {
  schemaVersion: "cursor-prediction-v17-step-09-csharp-tail-guard-search/1",
  generatedAtUtc: new Date().toISOString(),
  constraints: {
    productSourceEdited: false,
    gpuTrainingRun: false,
    cpuOnly: true,
    heavyParallelism: false,
    rawExpandedCsvCopied: false
  },
  inputs: {
    sourceZipsReadInPlace: [
      "cursor-mirror-motion-recording-20260504-070248.zip",
      "cursor-mirror-motion-recording-20260504-070307.zip"
    ],
    config: "poc/cursor-prediction-v17/step-09-csharp-tail-guard-search/replay-config.json",
    harnessProject: "poc/cursor-prediction-v17/step-09-csharp-tail-guard-search/harness/TailGuardHarness.csproj",
    step8Reference: "poc/cursor-prediction-v17/step-08-csharp-chronological-replay/scores.json"
  },
  buildAndRun: {
    dotnetPath: "C:\\Program Files\\dotnet\\dotnet.exe",
    sdkVersion: "10.0.203",
    buildSucceeded: true,
    runSucceeded: true,
    buildWarnings: [
      "CS8632 nullable annotation context warning at Program.cs lines 289 and 429"
    ],
    output: "poc/cursor-prediction-v17/step-09-csharp-tail-guard-search/csharp-tail-guard-output.json"
  },
  harness: raw.harness,
  candidateCount: raw.candidateCount,
  candidates: raw.candidates,
  ranking: raw.ranking,
  selectedByTailObjective: raw.selected,
  selectedRecommendation: {
    id: selectedId,
    type: "fineOffset",
    offsetMs: -3.5,
    productImplementationNote: "Current product setting is integer milliseconds; -3.5ms requires fractional target-offset support or scheduler tick adjustment. If only integer offsets are allowed, offset -4ms remains the visual candidate and offset -3ms is the integer tail fallback.",
    rationale: "Best tail objective among evaluated candidates. It halves stop overshoot p99 versus -4ms and reduces >2px tail rate, at the cost of worse p95/post-stop/high-speed metrics."
  },
  visualCandidate: {
    id: visualId,
    offsetMs: -4,
    rationale: "Best visual/p95 profile and already supported by integer product target offset; leaves a stop-overshoot tail."
  },
  tailRowsSummary: raw.baselineTail,
  tailRowExamples: raw.baselineTailExamples,
  keyComparisons: {
    offset_m4: {
      metrics: visual.metrics,
      objective: visual.objective
    },
    offset_m3p5: {
      metrics: selected.metrics,
      objective: selected.objective
    },
    offset_m3_integerFallback: {
      metrics: candidate("offset_m3").metrics,
      objective: candidate("offset_m3").objective
    },
    offset_m4_dynamic_m5: {
      metrics: candidate("offset_m4_decel_dynamic_m5").metrics,
      objective: candidate("offset_m4_decel_dynamic_m5").objective
    }
  },
  interpretation: {
    tailCause: "The -4ms tail is dominated by high recent-speed rows where the effective -4ms target has crossed behind the current cursor while offset-0 direction still points forward. Many top tail rows have product prediction displacement near zero, so the issue is timing/target alignment around rapid direction crossing rather than large MLP output amplitude.",
    guardResult: "The tested runtime-safe deceleration/stationary/lead-cap guards do not remove the worst tail because most top tail rows are not classified as runtime deceleration or stationary by scalar history features.",
    fineOffsetResult: "-3.5ms is the best tail candidate. It lowers stop p99 and overshoot p99, but worsens all p95, stop p95, post-stop jitter, and high-speed p95 versus -4ms.",
    adoptionDecision: "Use -3.5ms only if tail p99 is the primary adoption criterion and fractional offset support is acceptable. Otherwise ship/validate -4ms without the tested guards and address the residual tail with better timing labels or retraining."
  },
  conclusion: {
    selectedCandidate: selectedId,
    offsetMinus4AloneEnough: false,
    guardAttached: false,
    needsRuntimeGuardOrRetraining: "No evaluated lightweight runtime guard targets the dominant tail. Next meaningful fixes are fractional timing validation (-3.5ms) and/or retraining with the crossing/timing-tail rows emphasized."
  }
};

fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2));

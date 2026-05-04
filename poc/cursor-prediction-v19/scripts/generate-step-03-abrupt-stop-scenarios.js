const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-03-motionlab-abrupt-stop-scenarios");
fs.mkdirSync(step, { recursive: true });

const bounds = { X: 200, Y: 160, Width: 1400, Height: 800 };
const families = [
  "straight-hard-stop",
  "straight-one-frame-stop",
  "curved-hard-stop",
  "curved-creep-stop",
  "short-stop-duration",
  "long-stop-duration",
  "phase-shifted-stop",
  "dropout-proxy-stop",
];
const speeds = [0.9, 1.4, 2.1];
const stopDurations = [67, 133, 200, 333];
const scenarios = [];
const metadata = [];

function point(x, y) { return { X: Math.round(x * 1000) / 1000, Y: Math.round(y * 1000) / 1000 }; }
function speedPoint(progress, multiplier, easingWidth, easing) {
  return {
    Progress: Math.round(progress * 10000) / 10000,
    Multiplier: Math.round(multiplier * 1000) / 1000,
    EasingWidth: Math.round(easingWidth * 10000) / 10000,
    Easing: easing,
  };
}
function hold(progress, duration, resume = 0) {
  return {
    Progress: Math.round(progress * 10000) / 10000,
    DurationMilliseconds: duration,
    ResumeEasingMilliseconds: resume,
  };
}
function scenario(seed, family, index, speed, stopMs, phaseShift) {
  const row = Math.floor(index / 6);
  const col = index % 6;
  const sx = bounds.X + 80 + col * 190;
  const sy = bounds.Y + 80 + row * 120;
  const length = family.includes("one-frame") ? 520 : family.includes("short") ? 360 : 460;
  const curve = family.includes("curved") ? 90 + (index % 3) * 30 : 0;
  const creep = family.includes("creep") ? 0.18 : 0.0;
  const stopProgress = 0.58 + phaseShift;
  const control = family.includes("curved")
    ? [point(sx, sy), point(sx + length * 0.35, sy - curve), point(sx + length * 0.72, sy + curve), point(sx + length, sy)]
    : [point(sx, sy), point(sx + length * 0.45, sy), point(sx + length, sy)];
  const speedPoints = [
    speedPoint(0.05, speed, 0.05, "ease-in-out"),
    speedPoint(Math.max(0.1, stopProgress - 0.12), speed * 1.15, 0.045, "linear"),
    speedPoint(stopProgress, creep, family.includes("one-frame") ? 0.005 : 0.018, "ease-out"),
    speedPoint(Math.min(0.96, stopProgress + 0.08), 0.08, 0.025, "ease-in-out"),
  ];
  if (family.includes("dropout")) {
    speedPoints.push(speedPoint(Math.min(0.98, stopProgress + 0.015), 1.6, 0.006, "step"));
  }
  return {
    script: {
      SchemaVersion: "cursor-mirror-motion-script/1",
      Seed: seed,
      Bounds: bounds,
      DurationMilliseconds: 3600,
      SampleRateHz: 240,
      ControlPoints: control,
      SpeedPoints: speedPoints.sort((a, b) => a.Progress - b.Progress),
      HoldSegments: [hold(stopProgress, stopMs, family.includes("creep") ? 80 : 0)],
      GenerationProfile: `v19-${family}`,
    },
    meta: {
      scenarioIndex: index,
      family,
      speedMultiplier: speed,
      stopDurationMs: stopMs,
      phaseShift,
      curvePx: curve,
      nearZeroCreepMultiplier: creep,
      intendedFailure: "abrupt deceleration/stop overshoot then return",
    },
  };
}

let index = 0;
for (const family of families) {
  for (const speed of speeds) {
    const stopMs = stopDurations[index % stopDurations.length];
    const phaseShift = [-0.035, -0.015, 0.0, 0.018, 0.037][index % 5];
    const item = scenario(19000 + index * 17, family, index, speed, stopMs, phaseShift);
    scenarios.push(item.script);
    metadata.push(item.meta);
    index++;
  }
}

const scenarioSet = {
  SchemaVersion: "cursor-mirror-motion-scenarios/1",
  Seed: 19001,
  GenerationProfile: "v19-abrupt-stop-parameterized",
  DurationMilliseconds: 3600 * scenarios.length,
  ScenarioDurationMilliseconds: 3600,
  SampleRateHz: 240,
  Scenarios: scenarios,
};

fs.writeFileSync(path.join(step, "abrupt-stop-scenarios.json"), JSON.stringify(scenarioSet, null, 2) + "\n");
fs.writeFileSync(path.join(step, "scenario-metadata.json"), JSON.stringify({ schemaVersion: "cursor-prediction-v19-abrupt-stop-scenario-metadata/1", metadata }, null, 2) + "\n");

const scores = {
  schemaVersion: "cursor-prediction-v19-step-03-motionlab-abrupt-stop-scenarios/1",
  generatedAtUtc: new Date().toISOString(),
  scenarioSet: "abrupt-stop-scenarios.json",
  scenarioMetadata: "scenario-metadata.json",
  scenarioCount: scenarios.length,
  familyCounts: Object.fromEntries(families.map(f => [f, metadata.filter(m => m.family === f).length])),
  dimensions: {
    speedMultipliers: speeds,
    stopDurationsMs: stopDurations,
    phaseShiftProgress: [-0.035, -0.015, 0.0, 0.018, 0.037],
    curveFamilies: ["straight", "curved"],
    nearZeroCreep: true,
    dropoutProxy: true,
  },
  verificationStatus: "not-run-yet",
  next: "Use MotionLab package writer/playback or a POC sampler replay to verify whether product brake and no-brake predictors reproduce overshoot-then-return on these synthetic families.",
};
fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2) + "\n");

const notes = `# Step 03 Notes: MotionLab Abrupt-Stop Scenario Additions

This step creates a POC-local MotionLab scenario set. Product source files were not modified.

The scenarios are parameterized rather than one hardcoded path:

- straight hard stop
- one-frame stop proxy
- curved approach
- curved approach with near-zero creep
- short and long stop durations
- phase-shifted stop positions
- dropout/polling proxy via abrupt speed point discontinuity

The generated JSON follows the existing \`MotionLabScenarioSet\` shape and can be fed into MotionLab tooling or a POC sampler verifier in the next step.
`;
fs.writeFileSync(path.join(step, "notes.md"), notes);

const report = `# Step 03 Report: MotionLab Abrupt-Stop Scenario Additions

Generated \`${scenarios.length}\` parameterized abrupt-stop scenarios under \`poc/cursor-prediction-v19/step-03-motionlab-abrupt-stop-scenarios/\`.

## Coverage

- Speed multipliers: ${speeds.join(", ")}
- Stop durations: ${stopDurations.join(", ")} ms
- Phase shifts: -0.035, -0.015, 0, 0.018, 0.037 progress
- Straight and curved paths
- Near-zero creep family
- Dropout/polling proxy family

## Status

This is a scenario addition artifact, not a reproduction result. Step 04 must run product-equivalent predictors against these scenarios and revise the generator if overshoot-then-return is not reproduced.
`;
fs.writeFileSync(path.join(step, "report.md"), report);

console.log(`generated ${scenarios.length} abrupt-stop scenarios`);

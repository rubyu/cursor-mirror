const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const step = path.join(root, "step-04b-generator-revision");
fs.mkdirSync(step, { recursive: true });

const bounds = { X: 160, Y: 140, Width: 1560, Height: 900 };
const families = [
  "very-high-one-frame-hold",
  "very-high-two-frame-hold",
  "near-zero-creep-after-high",
  "curved-near-zero-creep",
  "phase-crossing-hard-stop",
  "short-hold-release",
  "stale-sample-proxy",
  "missed-poll-proxy",
];
const speeds = [2.5, 3.5, 4.6];
const decelWidths = [0.0025, 0.005, 0.009];
const stopDurations = [34, 50, 84, 134, 200];
const stopProgresses = [0.61, 0.635, 0.662, 0.694];
const scenarios = [];
const metadata = [];

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function point(x, y) {
  return { X: round(x), Y: round(y) };
}

function speedPoint(progress, multiplier, easingWidth, easing = "linear") {
  return {
    Progress: round(progress, 4),
    Multiplier: round(multiplier, 4),
    EasingWidth: round(easingWidth, 5),
    Easing: easing,
  };
}

function hold(progress, duration, resume = 0) {
  return {
    Progress: round(progress, 4),
    DurationMilliseconds: duration,
    ResumeEasingMilliseconds: resume,
  };
}

function scenario(seed, family, index, speed, decelWidth, stopProgress, stopMs) {
  const row = Math.floor(index / 6);
  const col = index % 6;
  const sx = bounds.X + 90 + col * 230;
  const sy = bounds.Y + 95 + row * 125;
  const length = family.includes("very-high") ? 1180 : family.includes("curved") ? 980 : 1080;
  const duration = family.includes("very-high") ? 1180 : family.includes("missed") ? 980 : 1320;
  const curve = family.includes("curved") ? 150 + (index % 3) * 35 : family.includes("phase") ? 60 : 0;
  const exactHold = !family.includes("creep");
  const creep = family.includes("creep") ? 0.05 : family.includes("stale") ? 0.075 : 0;
  const releaseResume = family.includes("short-hold") ? 40 : 0;
  const control = curve
    ? [
        point(sx, sy),
        point(sx + length * 0.24, sy - curve),
        point(sx + length * 0.56, sy + curve * 0.9),
        point(sx + length, sy),
      ]
    : [point(sx, sy), point(sx + length * 0.42, sy), point(sx + length, sy)];

  const speedPoints = [
    speedPoint(0.04, Math.min(5, speed * 0.9), 0.04, "smoothstep"),
    speedPoint(Math.max(0.12, stopProgress - 0.18), Math.min(5, speed * 1.25), 0.055, "linear"),
    speedPoint(Math.max(0.14, stopProgress - 0.055), Math.min(5, speed * 1.45), 0.015, "linear"),
    speedPoint(stopProgress, exactHold ? 0.05 : creep, decelWidth, "linear"),
    speedPoint(Math.min(0.985, stopProgress + 0.035), family.includes("missed") ? 1.4 : 0.05, 0.006, "linear"),
  ];
  if (family.includes("phase")) {
    speedPoints.push(speedPoint(Math.min(0.985, stopProgress + 0.012), 0.05, 0.0015, "linear"));
  }
  if (family.includes("stale")) {
    speedPoints.push(speedPoint(Math.min(0.985, stopProgress + 0.020), 0.22, 0.004, "linear"));
  }

  const holds = exactHold ? [hold(stopProgress, stopMs, releaseResume)] : [];
  return {
    script: {
      SchemaVersion: "cursor-mirror-motion-script/1",
      Seed: seed,
      Bounds: bounds,
      DurationMilliseconds: duration,
      SampleRateHz: 240,
      ControlPoints: control,
      SpeedPoints: speedPoints.sort((a, b) => a.Progress - b.Progress),
      HoldSegments: holds,
      GenerationProfile: `v19-step04b-${family}`,
    },
    meta: {
      scenarioIndex: index,
      family,
      speedMultiplier: speed,
      stopDurationMs: exactHold ? stopMs : 0,
      decelWidthProgress: decelWidth,
      stopProgress,
      durationMs: duration,
      pathLengthPx: length,
      curvePx: curve,
      nearZeroCreepMultiplier: creep,
      dimensions: {
        veryHighSpeed: speed >= 3.5,
        decelFrames60HzProxy: decelWidth <= 0.005 ? "1-2" : "2-3",
        phaseCrossing: family.includes("phase"),
        staleLatestSampleProxy: family.includes("stale"),
        missedPollProxy: family.includes("missed"),
        curvedApproach: curve > 0,
        nearZeroLastVelocity: creep > 0,
      },
      intendedFailure: "abrupt high-speed deceleration/stop overshoot then return, including product-brake start-condition leaks",
    },
  };
}

let index = 0;
for (const family of families) {
  for (const speed of speeds) {
    const item = scenario(
      19400 + index * 31,
      family,
      index,
      speed,
      decelWidths[index % decelWidths.length],
      stopProgresses[index % stopProgresses.length],
      stopDurations[index % stopDurations.length],
    );
    scenarios.push(item.script);
    metadata.push(item.meta);
    index++;
  }
}

const scenarioSet = {
  SchemaVersion: "cursor-mirror-motion-scenarios/1",
  Seed: 19401,
  GenerationProfile: "v19-step04b-abrupt-stop-revision-high-speed-creep-phase",
  DurationMilliseconds: scenarios.reduce((sum, s) => sum + s.DurationMilliseconds, 0),
  ScenarioDurationMilliseconds: Math.max(...scenarios.map((s) => s.DurationMilliseconds)),
  SampleRateHz: 240,
  Scenarios: scenarios,
};

fs.writeFileSync(path.join(step, "abrupt-stop-scenarios-revised.json"), JSON.stringify(scenarioSet, null, 2) + "\n");
fs.writeFileSync(path.join(step, "scenario-metadata-revised.json"), JSON.stringify({
  schemaVersion: "cursor-prediction-v19-step04b-scenario-metadata/1",
  metadata,
}, null, 2) + "\n");

const scores = {
  schemaVersion: "cursor-prediction-v19-step-04b-generator-revision/1",
  generatedAtUtc: new Date().toISOString(),
  scenarioSet: "abrupt-stop-scenarios-revised.json",
  scenarioMetadata: "scenario-metadata-revised.json",
  scenarioCount: scenarios.length,
  familyCounts: Object.fromEntries(families.map((f) => [f, metadata.filter((m) => m.family === f).length])),
  dimensions: {
    speeds,
    decelWidths,
    stopDurations,
    stopProgresses,
    includesVeryHighSpeed: true,
    includesOneToThreeFrameDecelProxy: true,
    includesPhaseCrossingProxy: true,
    includesStaleLatestSampleProxy: true,
    includesMissedPollProxy: true,
    includesNearZeroLastVelocity: true,
    includesCurvedApproach: true,
  },
  verificationStatus: "pending-step-04-replay",
};
fs.writeFileSync(path.join(step, "scores.json"), JSON.stringify(scores, null, 2) + "\n");

fs.writeFileSync(path.join(step, "notes.md"), `# Step 04b Notes: Generator Revision

The first Step 04 replay over Step 03 scenarios produced zero detected stop events. The scenario duration/path-speed combination was too gentle for the Step 01 stop-event predicate.

This revision keeps the data POC-local and adds faster, shorter MotionLab scenarios:

- abrupt stop after very high speed
- deceleration over roughly 1-3 60Hz frames via narrow speed-point widths
- DWM phase-crossing proxy families
- stale latest sample / missed poll proxies through low-speed or jumpy speed-point behavior
- near-zero last velocity that is not exactly zero
- curved approach before stop

Product source was not modified.
`);

fs.writeFileSync(path.join(step, "report.md"), `# Step 04b Report: Generator Revision

Generated ${scenarios.length} revised abrupt-stop scenarios for reproduction testing.

The revision is necessary because Step 04 found that the original Step 03 family did not produce any stop events under the Step 01 event-window definition.

Next action: rerun the Step 04 product-equivalent replay against \`abrupt-stop-scenarios-revised.json\`.
`);

console.log(`generated ${scenarios.length} revised abrupt-stop scenarios`);

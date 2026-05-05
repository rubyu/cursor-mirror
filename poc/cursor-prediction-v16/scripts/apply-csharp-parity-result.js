const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const result = JSON.parse(fs.readFileSync(path.join(root, "runtime", "csharp-parity", "results.json"), "utf8"));
const updateParity = (parity) => ({ ...(parity || {}), ...result });

const selectedPath = path.join(root, "runtime", "selected-candidate.json");
const selected = JSON.parse(fs.readFileSync(selectedPath, "utf8"));
selected.parity = updateParity(selected.parity);
fs.writeFileSync(selectedPath, JSON.stringify(selected, null, 2) + "\n");

const scoresPath = path.join(root, "scores.json");
const scores = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
scores.selectedCandidate.runtimeParity = updateParity(scores.selectedCandidate.runtimeParity);
scores.selectedCandidate.runtimeShape.csharpCompileRun = result.csharpCompileRun;
scores.selectedCandidate.runtimeShape.csharpRuntime = result.runtime;
if (scores.runtimeExports && scores.runtimeExports[scores.selectedCandidate.modelId]) {
  scores.runtimeExports[scores.selectedCandidate.modelId].parity = updateParity(
    scores.runtimeExports[scores.selectedCandidate.modelId].parity
  );
}
if (scores.runtimeExports) {
  for (const [modelId, exported] of Object.entries(scores.runtimeExports)) {
    if (modelId === scores.selectedCandidate.modelId) {
      continue;
    }
    exported.parity = {
      ...(exported.parity || {}),
      csharpCompileRun: "not_applicable_shortlist_candidate",
    };
  }
}
scores.runtimeCsharpParity = result;
scores.interpretation =
  "Adopt as a product-integration candidate for guarded 60Hz runtime testing, not as product code yet. " +
  "The strongest deployable shape is a hardtanh tiny MLP over FSMN-style causal features. " +
  "It exports real arrays and passes both generated-shape parity and real C# compile/run parity; " +
  "app-loop latency measurement and product feature-input integration remain open.";
fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2) + "\n");

const reportPath = path.join(root, "report.md");
let report = fs.readFileSync(reportPath, "utf8");
report = report.replace(
  new RegExp("- C# compile/run: `[^\\r\\n`]+`\\r?\\n\\r?" + "Full C# " + "compile/run remains [^.]+\\\\.?"),
  [
    `- C# compile/run: \`${result.csharpCompileRun}\``,
    `- C# sample count: ${result.sampleCount}`,
    `- C# runtime: \`${result.runtime}\``,
    "",
    "The generated C# source was compiled and executed against an independent JSON-descriptor evaluator.",
  ].join("\n")
);
report = report.replace(
  /- Method: `python_reference_runtime_graph_vs_serialized_generated_shape`/,
  `- Method: \`${result.method}\``
);
report = report.replace(
  /It exports real arrays and passes generated-shape parity in Python, but C# compile\/run and app-loop latency measurement remain open\./,
  "It exports real arrays and passes both generated-shape parity and real C# compile/run parity; app-loop latency measurement and product feature-input integration remain open."
);
fs.writeFileSync(reportPath, report);

const readmePath = path.join(root, "README.md");
let readme = fs.readFileSync(readmePath, "utf8");
if (!readme.includes("runtime/csharp-parity/")) {
  readme = readme.replace(
    "- `runtime/candidates/`: exported candidate descriptors for the shortlist.\n",
    "- `runtime/candidates/`: exported candidate descriptors for the shortlist.\n" +
      "- `runtime/csharp-parity/`: C# compile/run parity harness and result.\n"
  );
fs.writeFileSync(readmePath, readme);
}

const candidatesDir = path.join(root, "runtime", "candidates");
for (const file of fs.readdirSync(candidatesDir)) {
  if (!file.endsWith(".json")) {
    continue;
  }
  const candidatePath = path.join(candidatesDir, file);
  const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  if (candidate.modelId === selected.modelId) {
    candidate.parity = updateParity(candidate.parity);
  } else {
    candidate.parity = {
      ...(candidate.parity || {}),
      csharpCompileRun: "not_applicable_shortlist_candidate",
    };
  }
  fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + "\n");
}

const notesPath = path.join(root, "notes.md");
let notes = fs.readFileSync(notesPath, "utf8");
if (!notes.includes("C# parity command")) {
  notes += `
C# parity command:

\`\`\`powershell
$env:DOTNET_CLI_HOME=(Join-Path (Get-Location) '.dotnet-cli-home'); $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'; $env:DOTNET_NOLOGO='1'; & 'C:\\Program Files\\dotnet\\dotnet.exe' build poc\\cursor-prediction-v16\\runtime\\csharp-parity\\CSharpParity.csproj --configuration Release --no-restore --nologo
$env:DOTNET_CLI_HOME=(Join-Path (Get-Location) '.dotnet-cli-home'); $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'; $env:DOTNET_NOLOGO='1'; & 'C:\\Program Files\\dotnet\\dotnet.exe' run --project poc\\cursor-prediction-v16\\runtime\\csharp-parity\\CSharpParity.csproj --configuration Release --no-build -- poc\\cursor-prediction-v16\\runtime\\selected-candidate.json poc\\cursor-prediction-v16\\runtime\\csharp-parity\\results.json
\`\`\`
`;
  fs.writeFileSync(notesPath, notes);
}

console.log(JSON.stringify({ updated: true, result }, null, 2));

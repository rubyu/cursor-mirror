# Step 01 - Data Inventory

## Scope

This inventory records where v17 can read prior POCs, MotionLab/mouse trace/calibration data, and related product code. It does not copy raw data.

## Prior POCs

| POC | path | files | bytes |
| --- | --- | ---: | ---: |
| v14 | `poc\cursor-prediction-v14` | 5 | 94711 |
| v15 | `poc\cursor-prediction-v15` | 7 | 540146 |
| v16 | `poc\cursor-prediction-v16` | 19 | 2443508 |

## Raw Data At Repository Root

- ZIP count: 39
- Total ZIP bytes: 342538737
- By kind: `{'calibration': 2, 'motion-recording': 13, 'trace': 24}`

| zip | kind | bytes |
| --- | --- | ---: |
| `cursor-mirror-calibration-20260502-230553.zip` | calibration | 1569 |
| `cursor-mirror-calibration-20260502-230713.zip` | calibration | 1372 |
| `cursor-mirror-motion-recording-20260503-193218.zip` | motion-recording | 233679 |
| `cursor-mirror-motion-recording-20260503-194156.zip` | motion-recording | 324051 |
| `cursor-mirror-motion-recording-20260503-194850.zip` | motion-recording | 324391 |
| `cursor-mirror-motion-recording-20260503-201431.zip` | motion-recording | 15434057 |
| `cursor-mirror-motion-recording-20260503-212102.zip` | motion-recording | 2180276 |
| `cursor-mirror-motion-recording-20260503-212556.zip` | motion-recording | 15177846 |
| `cursor-mirror-motion-recording-20260503-215632.zip` | motion-recording | 14922386 |
| `cursor-mirror-motion-recording-20260504-062321.zip` | motion-recording | 16481394 |
| `cursor-mirror-motion-recording-20260504-063726.zip` | motion-recording | 16319976 |
| `cursor-mirror-motion-recording-20260504-070055.zip` | motion-recording | 14747412 |
| `cursor-mirror-motion-recording-20260504-070211.zip` | motion-recording | 13885506 |
| `cursor-mirror-motion-recording-20260504-070248.zip` | motion-recording | 17311725 |
| `cursor-mirror-motion-recording-20260504-070307.zip` | motion-recording | 16564685 |
| `cursor-mirror-trace-20260501-000443.zip` | trace | 241129 |
| `cursor-mirror-trace-20260501-091537.zip` | trace | 5516072 |
| `cursor-mirror-trace-20260501-195819.zip` | trace | 11442073 |
| `cursor-mirror-trace-20260501-231621.zip` | trace | 9617120 |
| `cursor-mirror-trace-20260501-235043.zip` | trace | 1476008 |
| `cursor-mirror-trace-20260502-094201.zip` | trace | 27481073 |
| `cursor-mirror-trace-20260502-114656.zip` | trace | 10998464 |
| `cursor-mirror-trace-20260502-122134.zip` | trace | 12277445 |
| `cursor-mirror-trace-20260502-124831.zip` | trace | 5111847 |
| `cursor-mirror-trace-20260502-130828.zip` | trace | 5147248 |
| `cursor-mirror-trace-20260502-132725.zip` | trace | 7724859 |
| `cursor-mirror-trace-20260502-134341.zip` | trace | 10294141 |
| `cursor-mirror-trace-20260502-145302.zip` | trace | 7327849 |
| `cursor-mirror-trace-20260502-152600.zip` | trace | 8416994 |
| `cursor-mirror-trace-20260502-153745.zip` | trace | 8807156 |
| `cursor-mirror-trace-20260502-154732.zip` | trace | 10113796 |
| `cursor-mirror-trace-20260502-161143.zip` | trace | 10559685 |
| `cursor-mirror-trace-20260502-163258.zip` | trace | 8596478 |
| `cursor-mirror-trace-20260502-165358.zip` | trace | 6229126 |
| `cursor-mirror-trace-20260502-173150.zip` | trace | 5957895 |
| `cursor-mirror-trace-20260502-175951.zip` | trace | 6729383 |
| `cursor-mirror-trace-20260502-184947.zip` | trace | 5317362 |
| `cursor-mirror-trace-20260503-185536.zip` | trace | 8781103 |
| `cursor-mirror-trace-20260503-190129.zip` | trace | 4464106 |

## Reusable Split And Runtime Inputs

- Split manifest: `poc/cursor-prediction-v12/step-2-clean-split/split-manifest.json`
- v16 selected runtime descriptor: `poc/cursor-prediction-v16/runtime/selected-candidate.json`
- v16 selected model: `mlp_fsmn_h8_hardtanh_label_q0p125_lag0p5`

## Product And Analysis Locations

| location | exists |
| --- | --- |
| `src\CursorMirror.Core\MouseTrace` | True |
| `src\CursorMirror.Core\MotionLab` | True |
| `src\CursorMirror.Core\MotionLabInputBlocker.cs` | True |
| `src\CursorMirror.MotionLab` | True |
| `src\CursorMirror.Calibrator` | True |
| `artifacts\analysis` | True |
| `artifacts\calibration` | True |
| `poc\cursor-prediction-v12\step-2-clean-split\split-manifest.json` | True |

## Notes

- Step 2 should read MotionLab ZIPs in place through the POC13 loader.
- The first analysis target is Step5 vs v16 selected DistilledMLP, not retraining.
- Raw ZIPs, expanded CSVs, checkpoints, and tensor dumps remain out of scope for v17 artifacts.

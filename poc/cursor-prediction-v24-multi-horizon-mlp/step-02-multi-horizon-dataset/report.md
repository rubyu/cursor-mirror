# Step 02 Report - Multi-Horizon Dataset Audit

## Summary

This step verifies the existing v21 MotionLab package shape and estimates the size of a multi-horizon dataset without writing a large row dump.

All required ZIP entries and required header columns were present: True.

The initial horizon grid contains 11 labels per eligible runtime row:

```text
-24, -16, -8, 0, 4, 8, 12, 16, 24, 32, 40
```

## Sample Package

| item | value |
| --- | ---: |
| package | m195438 |
| split | test |
| quality | normal |
| alignment rows read | 252111 |
| runtimeSchedulerPoll rows | 15360 |
| eligible rows after warmup | 9600 |
| eligible ratio | 0.038078 |

## Estimated Dataset Size

| split | packages | manifest alignment rows | estimated eligible rows | estimated labels |
| --- | ---: | ---: | ---: | ---: |
| robustness | 4 | 1814708 | 69100 | 760100 |
| test | 1 | 252111 | 9600 | 105600 |
| train | 4 | 1548433 | 58961 | 648571 |
| validation | 1 | 567051 | 21592 | 237512 |

## Decision

Proceed to a row-level builder only after Step 03 confirms the exact training format. The likely builder should stream rows, interpolate labels for the horizon grid, and write either compact sampled training arrays or untracked large artifacts.

## Command

```powershell
powershell -ExecutionPolicy Bypass -File poc\cursor-prediction-v24-multi-horizon-mlp\step-02-multi-horizon-dataset\dataset-audit.ps1
```

# Cursor Mirror mouse trace 予測 PoC Step 2

## 目的

Step 1 で最良だった `constant-velocity-last2` を基準に、より低誤差かつ軽量な短期カーソル予測モデルを評価した。特に、固定 gain / damping、constant acceleration、last2 と EMA の velocity blend、online expert selection を試し、「誤差が自動的に小さくなるように選ぶ」方向が有効かを確認した。

作業成果物はこの directory 以下に限定した。zip や大きな trace CSV は保存していない。

## 実行方法

PowerShell と標準 .NET のみを使う。追加依存や外部ネットワークは不要。

```powershell
Set-Location "C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor"
& "poc/cursor-prediction/step-2 adaptive-refinements/run_adaptive_refinements.ps1"
```

任意で入力 zip / 出力先 / idle gap threshold を指定できる。

```powershell
& "poc/cursor-prediction/step-2 adaptive-refinements/run_adaptive_refinements.ps1" `
  -ZipPath "cursor-mirror-trace-20260501-000443.zip" `
  -OutputPath "poc/cursor-prediction/step-2 adaptive-refinements/scores.json" `
  -IdleGapMs 100
```

## 主要結果

主比較は後半 30% test。Step 1 baseline は `constant-velocity-last2`、cap none。

| horizon ms | best model | mean px | p95 px | p99 px | mean change vs baseline |
|---:|---|---:|---:|---:|---:|
| 4 | constant-acceleration-last3-accelterm-cap-4px | 1.697 | 6.319 | 12.650 | -0.06% |
| 8 | constant-velocity-last2 | 3.367 | 12.602 | 25.549 | 0.00% |
| 12 | constant-velocity-last2-gain-0.875 | 5.412 | 22.957 | 44.331 | -1.26% |
| 16 | constant-velocity-last2-gain-0.875 | 7.639 | 32.268 | 61.856 | -2.18% |
| 24 | constant-velocity-last2-gain-0.875 | 13.392 | 57.456 | 115.193 | -4.60% |
| 32 | constant-velocity-last2-gain-0.875 | 20.388 | 89.459 | 175.338 | -6.04% |
| 48 | constant-velocity-last2-gain-0.75 | 36.884 | 166.869 | 336.313 | -9.57% |

ただし tail safety では注意が必要。gain damping は 24ms / 32ms / 48ms の mean と p95 を改善した一方、p99 や max は baseline より悪化する horizon がある。online expert selection は mean でも baseline を安定して超えず、p99 / max が大きく悪化した。

## 結論

product 実装候補は次の 2 つに絞る。

1. `constant-velocity-last2`: 8ms 以下、または tail 安全性と単純性を優先する既定候補。
2. horizon-dependent fixed gain: 12-32ms は gain 0.875、48ms は gain 0.75 を候補。ただし p99 悪化があるため、利用側が mean / p95 改善を重視する場合だけ採用する。

online expert selection は今回の小さな expert set では不採用。短い trace 内では expert の勝ち負けが局所的で、EWMA の選択が遅れ、hold-current や過 damping expert を選ぶ場面が tail を増やした。


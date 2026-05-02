# Cursor Mirror mouse trace 予測 PoC step-1

## 目的

短期カーソル位置予測の基礎分析と、軽量なオンライン baseline の初回評価を行う。実 Windows hook は使わず、プロジェクトルートの `cursor-mirror-trace-20260501-000443.zip` 内の `trace.csv` だけを読む。

## データ概要

- zip entries: `trace.csv`, `metadata.json`
- metadata: `Cursor Mirror トレースツール` / `v1.2.0-dev+20260430.4f700b2c43b6.dirty`
- samples: 15,214
- event: `move` 15,214 件
- duration: 500.273 sec（`trace.csv` の first/last elapsed 差）
- coordinate range: x = -3748..4288, y = -83..2188
- interval: mean 32.885 ms, p50 8.013 ms, p90 16.093 ms, p95 71.948 ms, p99 496.177 ms, max 15448.841 ms
- idle gap threshold: 100 ms
- idle gaps: 656 gaps, 657 segments
- segment length: p50 15 samples, p95 76 samples, max 250 samples

100 ms を超える sample interval は idle gap とみなし、その gap をまたぐ評価 target は除外した。速度履歴も同じ threshold で reset する。

## 実行方法

PowerShell と .NET 標準ライブラリだけを使う。追加依存・外部ネットワークは不要。

```powershell
Set-Location "C:\Users\seigl\OneDrive\my\ドキュメント\projects\cursor"
& "poc/cursor-prediction/step-1 data-audit-baselines/run_baselines.ps1"
```

出力:

- `scores.json`: 監査結果、全 model / horizon / cap / split のスコア、top model、実行時間

任意で zip や出力先を指定できる。

```powershell
& "poc/cursor-prediction/step-1 data-audit-baselines/run_baselines.ps1" `
  -ZipPath "cursor-mirror-trace-20260501-000443.zip" `
  -OutputPath "poc/cursor-prediction/step-1 data-audit-baselines/scores.json" `
  -IdleGapMs 100
```

## 評価した model

- `hold-current`: 現在位置をそのまま予測
- `constant-velocity-last2`: 直近 2 samples の速度を外挿
- `linear-regression-velocity-N3/N5/N8`: 直近 N samples の線形回帰 slope を速度として外挿
- `ema-velocity-alpha-0.2/0.35/0.5/0.75`: 速度 EMA を外挿

horizon は 0, 4, 8, 12, 16, 24, 32, 48 ms。prediction offset cap は `none`, 16, 32, 64 px。

## 主要結果

後半 30% test の非ゼロ horizon では、全 horizon で `constant-velocity-last2` + cap `none` が mean error 最小だった。horizon=0ms は全 model が 0px になるため、model 選択からは除外して見る。

| horizon ms | best model | cap | n | mean px | RMSE px | p50 px | p90 px | p95 px | p99 px |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | constant-velocity-last2 | none | 4173 | 1.698 | 3.222 | 0.848 | 4.067 | 6.472 | 12.892 |
| 8 | constant-velocity-last2 | none | 4125 | 3.367 | 6.336 | 1.690 | 8.112 | 12.602 | 25.549 |
| 12 | constant-velocity-last2 | none | 4068 | 5.481 | 10.497 | 2.499 | 13.560 | 22.410 | 43.655 |
| 16 | constant-velocity-last2 | none | 4005 | 7.809 | 15.117 | 3.387 | 19.514 | 31.851 | 62.940 |
| 24 | constant-velocity-last2 | none | 3896 | 14.038 | 27.228 | 5.631 | 36.693 | 58.578 | 111.837 |
| 32 | constant-velocity-last2 | none | 3771 | 21.698 | 42.121 | 8.363 | 58.367 | 91.212 | 175.096 |
| 48 | constant-velocity-last2 | none | 3544 | 40.789 | 79.270 | 15.553 | 111.856 | 173.675 | 334.807 |

`hold-current` に対する mean error 改善は test で約 73%（4-8ms）から約 46%（48ms）まで。cap は今回の trace では mean / tail ともに悪化し、特に長い horizon で fast motion を過度に抑えた。

## 次の仮説

1. 直近速度が強いので、まず `constant-velocity-last2` を低レイテンシ baseline として採用する。
2. 長い horizon では誤差 tail が大きいので、速度外挿に horizon-dependent damping を入れる。
3. 固定 cap ではなく、直近 speed / acceleration / segment 内 jitter に応じた adaptive cap を試す。
4. last2 の急変に弱い局面だけ EMA や alpha-beta filter に切り替える regime detector を試す。
5. 32-48ms 予測は p95 が大きいので、描画側の利用目的に応じて horizon を 8-16ms へ寄せる。

# step-1 詳細レポート: data audit と baseline 評価

## 概要

`cursor-mirror-trace-20260501-000443.zip` 内の `trace.csv` を使い、短期カーソル位置予測の data audit と baseline 評価を行った。評価は「時刻 t までの過去 sample から、t+horizon の位置を予測し、実際の t+horizon 位置と比較」する形式。実位置は sample 間の線形補間で求めた。

成果物はこの directory 内に閉じている。zip の copy や展開済み `trace.csv` は保存していない。

## データ監査

| item | value |
|---|---:|
| samples | 15,214 |
| duration | 500.273 sec |
| events | move: 15,214 |
| x range | -3748 .. 4288 |
| y range | -83 .. 2188 |
| movement p50 | 3.162 px/sample |
| movement p95 | 51.245 px/sample |
| movement max | 277.856 px/sample |

interval 分布:

| metric | ms |
|---|---:|
| mean | 32.885 |
| p50 | 8.013 |
| p90 | 16.093 |
| p95 | 71.948 |
| p99 | 496.177 |
| max | 15448.841 |

100 ms を idle gap threshold とした。通常 sampling は p50 8ms / p90 16ms 付近に集中し、100ms 超は意図的な停止・入力なし・記録間断とみなすのが妥当と判断した。100ms threshold で 656 gaps、657 segments になった。

大きい idle gap 上位:

| after seq | before seq | gap ms |
|---:|---:|---:|
| 11974 | 11975 | 15448.841 |
| 6605 | 6606 | 6672.344 |
| 13322 | 13323 | 6080.231 |
| 6580 | 6581 | 5585.204 |
| 14942 | 14943 | 5111.967 |
| 12658 | 12659 | 4984.270 |
| 10996 | 10997 | 4984.131 |
| 13464 | 13465 | 4863.173 |
| 14324 | 14325 | 4808.141 |
| 4869 | 4870 | 4657.185 |

## 評価方法

各 sample を anchor とし、horizon = 0, 4, 8, 12, 16, 24, 32, 48 ms を評価した。target 時刻の実位置は隣接 sample の線形補間で求めた。

除外ルール:

- target が trace 終端を超える anchor は除外。
- target 補間に 100ms 超の idle gap をまたぐ必要がある anchor は除外。
- velocity model の履歴も 100ms 超 gap で reset。
- regression model は直近 N samples が同一 segment 内に揃わない場合、非ゼロ horizon の評価から除外。

split:

- `all`: valid anchor 全体。
- `train_first_70pct`: sample index の前半 70%。今回の model は fit しないため、参考集計。
- `test_latter_30pct`: sample index の後半 30%。主な比較対象。

score:

- mean error px
- RMSE px
- p50 / p90 / p95 / p99 error px
- max error px
- evaluation sample count

## 評価 model

| model | 計算量目安 | 内容 |
|---|---|---|
| hold-current | O(1) | 現在位置をそのまま使う |
| constant-velocity-last2 | O(1) | 直近 2 samples の速度で外挿 |
| linear-regression-velocity-N3 | O(3) | 直近 3 samples の線形回帰 slope を速度にする |
| linear-regression-velocity-N5 | O(5) | 直近 5 samples の線形回帰 slope を速度にする |
| linear-regression-velocity-N8 | O(8) | 直近 8 samples の線形回帰 slope を速度にする |
| ema-velocity-alpha-* | O(1) | 速度 EMA を使う。alpha = 0.2, 0.35, 0.5, 0.75 |

max prediction offset cap は `none`, 16, 32, 64 px を評価した。cap は「現在位置から予測位置までの offset 長」に適用した。

## 主要スコア: 後半 30% test

非ゼロ horizon の best はすべて `constant-velocity-last2` + cap `none`。

| horizon ms | n | mean px | RMSE px | p50 px | p90 px | p95 px | p99 px | max px |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 4173 | 1.698 | 3.222 | 0.848 | 4.067 | 6.472 | 12.892 | 48.518 |
| 8 | 4125 | 3.367 | 6.336 | 1.690 | 8.112 | 12.602 | 25.549 | 97.036 |
| 12 | 4068 | 5.481 | 10.497 | 2.499 | 13.560 | 22.410 | 43.655 | 152.802 |
| 16 | 4005 | 7.809 | 15.117 | 3.387 | 19.514 | 31.851 | 62.940 | 208.772 |
| 24 | 3896 | 14.038 | 27.228 | 5.631 | 36.693 | 58.578 | 111.837 | 319.592 |
| 32 | 3771 | 21.698 | 42.121 | 8.363 | 58.367 | 91.212 | 175.096 | 445.738 |
| 48 | 3544 | 40.789 | 79.270 | 15.553 | 111.856 | 173.675 | 334.807 | 720.628 |

`hold-current` との比較:

| horizon ms | hold mean px | hold p95 px | best mean px | best p95 px | mean improvement |
|---:|---:|---:|---:|---:|---:|
| 4 | 6.322 | 29.295 | 1.698 | 6.472 | 73.1% |
| 8 | 12.655 | 58.924 | 3.367 | 12.602 | 73.4% |
| 12 | 18.897 | 89.515 | 5.481 | 22.410 | 71.0% |
| 16 | 25.347 | 118.686 | 7.809 | 31.851 | 69.2% |
| 24 | 38.154 | 178.454 | 14.038 | 58.578 | 63.2% |
| 32 | 50.898 | 233.032 | 21.698 | 91.212 | 57.4% |
| 48 | 75.504 | 344.488 | 40.789 | 173.675 | 46.0% |

## 主要スコア: 全体評価

全体評価でも非ゼロ horizon の best は `constant-velocity-last2` + cap `none`。

| horizon ms | n | mean px | p95 px | p99 px | max px |
|---:|---:|---:|---:|---:|---:|
| 4 | 13988 | 1.693 | 6.136 | 14.007 | 374.331 |
| 8 | 13816 | 3.332 | 12.107 | 27.263 | 748.663 |
| 12 | 13661 | 5.428 | 20.846 | 46.998 | 1139.402 |
| 16 | 13472 | 7.645 | 29.981 | 68.527 | 1530.792 |
| 24 | 13131 | 13.497 | 54.946 | 119.606 | 2396.463 |
| 32 | 12762 | 20.573 | 85.997 | 185.718 | 3229.831 |
| 48 | 12025 | 38.042 | 162.785 | 341.212 | 4900.710 |

全体の max は test より大きく、特定 segment の高速移動や座標ジャンプが tail を作っている。mean / p95 の傾向は test と一致しているため、model ranking は安定している。

## cap の結果

test で各 cap の best mean を比べると、すべて `none` が最良だった。

| horizon ms | none | cap 16 | cap 32 | cap 64 |
|---:|---:|---:|---:|---:|
| 4 | 1.70 | 2.98 | 2.19 | 1.74 |
| 8 | 3.37 | 7.69 | 5.92 | 4.34 |
| 12 | 5.48 | 12.91 | 10.52 | 8.01 |
| 16 | 7.81 | 18.63 | 15.57 | 12.27 |
| 24 | 14.04 | 30.48 | 26.47 | 22.16 |
| 32 | 21.70 | 42.59 | 37.95 | 32.71 |
| 48 | 40.79 | 65.47 | 60.79 | 54.30 |

固定 cap は今回の trace では速い移動に追従できず、mean だけでなく tail も悪化した。cap が必要なら、固定値ではなく speed-aware / horizon-aware な adaptive cap がよい。

## 軽量性とレイテンシ観点

PowerShell 実装で candidate 4,381,632、valid prediction 3,776,492。評価 loop は 77.361 sec、script total は 79.506 sec、約 48,816 predictions/sec だった。

この測定は PowerShell loop、JSON 生成、zip 読み込みを含むため、実アプリの処理時間ではない。C# などの実装では大幅に軽くなるはずだが、model 間の相対的な重さは次の通り。

- `hold-current`: 最軽量だが移動中の精度が低い。
- `constant-velocity-last2`: O(1) で今回の best。短期予測の基準に適する。
- `EMA`: O(1) だが今回の trace では last2 より少し遅れる。
- `linear regression`: O(N)。N=3 はまだ軽いが、N=5/N=8 は精度も悪化した。

レイテンシ用途では、まず last2 を使い、長い horizon にだけ damping や tail guard を足す方が良い。

## 注意点

- データは 1 trace のみ。ユーザー、mouse device、monitor layout、アプリ状態が変わると ranking が変わる可能性がある。
- `event` は `move` のみで、click / drag / wheel などの状態差は評価していない。
- 100ms threshold は今回の分布に基づく初期値。別 trace では p90/p95 を見直すべき。
- train/test split は online baseline の holdout 集計であり、学習済み model の汎化評価ではない。
- `scores.json` の performance は単一 run の wall-clock なので、厳密な benchmark ではない。

## 推奨 next steps

1. `constant-velocity-last2` を first implementation baseline として、描画側で 8-16ms horizon を中心に試す。
2. horizon が長いほど速度を弱める damping 係数を grid search する。
3. speed / acceleration / recent error proxy に応じた adaptive cap を試す。
4. alpha-beta filter または constant-acceleration last3 を追加する。
5. 大きな error tail の segment を抽出し、座標 jump、monitor boundary、急旋回、停止直後のどれが原因かを分類する。

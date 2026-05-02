# Step 2 詳細レポート: adaptive refinements

## 概要

`cursor-mirror-trace-20260501-000443.zip` の `trace.csv` を使い、Step 1 best の `constant-velocity-last2` を基準に、軽量な refinement を評価した。評価条件は Step 1 と合わせ、idle gap threshold は 100ms、target actual は sample 間の線形補間、100ms 超 gap をまたぐ target は除外した。

主比較は後半 30% test。全体評価も `scores.json` に含めた。

## 評価方法

各 sample `i` を anchor とし、`t[i] + horizon` の実カーソル位置を線形補間で求めた。horizon は 4, 8, 12, 16, 24, 32, 48ms。score は mean / RMSE / p50 / p90 / p95 / p99 / max error px / n。

split は次の通り。

| split | 内容 |
|---|---|
| all | valid anchor 全体 |
| train_first_70pct | sample index 前半 70% |
| test_latter_30pct | sample index 後半 30%。主比較 |

online expert selection では future leak を避けた。各 expert の EWMA error は、過去 anchor の target time が現在 sample time に到達した後だけ更新し、現在 anchor の選択には未観測の正解を使っていない。

## 評価モデル

| family | 内容 | 計算量目安 |
|---|---|---|
| baseline-last2 | Step 1 best: `constant-velocity-last2`, gain 1, cap none | O(1) |
| last2-gain-grid | gain = 0.25, 0.5, 0.75, 0.875, 1.0, 1.125, 1.25, 1.5 | O(1) |
| constant-acceleration-last3 | 直近 3 samples から v1/v2/a を推定 | O(1) |
| constant-acceleration-last3-clamped | acceleration term を 2/4/8/16px に vector cap | O(1) |
| ema | EMA velocity alpha = 0.35, 0.5, 0.75 | O(1) |
| velocity-blend | last2 velocity と EMA velocity の blend | O(1) |
| online-expert-selection | EWMA error 最小 expert を選択。expert 数 6 | O(E), E=6 |

評価した unique model は 30、score row は 630。

## 後半 30% test の baseline

| horizon ms | n | mean px | RMSE px | p50 px | p90 px | p95 px | p99 px | max px |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 4173 | 1.698 | 3.222 | 0.848 | 4.067 | 6.472 | 12.892 | 48.518 |
| 8 | 4125 | 3.367 | 6.336 | 1.690 | 8.112 | 12.602 | 25.549 | 97.036 |
| 12 | 4068 | 5.481 | 10.497 | 2.499 | 13.560 | 22.410 | 43.655 | 152.802 |
| 16 | 4005 | 7.809 | 15.117 | 3.387 | 19.514 | 31.851 | 62.940 | 208.772 |
| 24 | 3896 | 14.038 | 27.228 | 5.631 | 36.693 | 58.578 | 111.837 | 319.592 |
| 32 | 3771 | 21.698 | 42.121 | 8.363 | 58.367 | 91.212 | 175.096 | 445.738 |
| 48 | 3544 | 40.789 | 79.270 | 15.553 | 111.856 | 173.675 | 334.807 | 720.628 |

## Best by Horizon

| horizon ms | best model | n | mean px | p95 px | p99 px | max px |
|---:|---|---:|---:|---:|---:|---:|
| 4 | constant-acceleration-last3-accelterm-cap-4px | 4000 | 1.697 | 6.319 | 12.650 | 46.121 |
| 8 | constant-velocity-last2 | 4125 | 3.367 | 12.602 | 25.549 | 97.036 |
| 12 | constant-velocity-last2-gain-0.875 | 4068 | 5.412 | 22.957 | 44.331 | 142.649 |
| 16 | constant-velocity-last2-gain-0.875 | 4005 | 7.639 | 32.268 | 61.856 | 189.474 |
| 24 | constant-velocity-last2-gain-0.875 | 3896 | 13.392 | 57.456 | 115.193 | 311.017 |
| 32 | constant-velocity-last2-gain-0.875 | 3771 | 20.388 | 89.459 | 175.338 | 450.775 |
| 48 | constant-velocity-last2-gain-0.75 | 3544 | 36.884 | 166.869 | 336.313 | 752.895 |

mean では damping が効く。ただし「baseline を mean と p95/p99 の両面で明確に改善するか」という判断基準では、完全に満たす horizon は少ない。24ms / 32ms / 48ms は p95 が改善する一方、p99 または max が悪化する。

## Gain / Damping

gain 0.875 は 12-32ms の mean を改善した。48ms は gain 0.75 が mean 最小。

| horizon ms | baseline mean | best gain | best gain mean | mean change | p95 change | p99 change |
|---:|---:|---:|---:|---:|---:|---:|
| 12 | 5.481 | 0.875 | 5.412 | -1.26% | +2.44% | +1.55% |
| 16 | 7.809 | 0.875 | 7.639 | -2.18% | +1.31% | -1.72% |
| 24 | 14.038 | 0.875 | 13.392 | -4.60% | -1.92% | +3.00% |
| 32 | 21.698 | 0.875 | 20.388 | -6.04% | -1.92% | +0.14% |
| 48 | 40.789 | 0.75 | 36.884 | -9.57% | -3.92% | +0.45% |

短い horizon では gain 1.0 が強い。長い horizon では damping により平均的な overshoot が減るが、急な高速移動を追い切れず tail が残る。

## Constant Acceleration

unclamped acceleration は長い horizon で棄却。48ms test は mean 62.906px / p99 457.826px / max 2158.088px で、baseline より大幅に悪い。

acceleration term clamp は tail を抑えた。4px cap は 24ms p95 55.187px、32ms p99 171.553px、48ms max 683.452px など一部 tail 指標で良い。ただし mean は baseline や fixed gain を明確には超えず、履歴 3 点が必要で n も減る。実装候補としては優先度を下げる。

## Velocity Blend / EMA

EMA alpha 0.75 と last2 の blend は、Step 1 の EMA と同じく遅れが入る。最良寄りの `velocity-blend-last2-w-0.75-ema-alpha-0.75` でも全 horizon で baseline または fixed gain に負けた。

| horizon ms | blend mean | baseline mean |
|---:|---:|---:|
| 8 | 3.426 | 3.367 |
| 16 | 7.969 | 7.809 |
| 32 | 22.016 | 21.698 |
| 48 | 41.258 | 40.789 |

この trace では、smoothing による noise reduction よりも反応遅れの損失が大きい。

## Online Expert Selection

expert は `last2 gain 0.75/0.875/1.0/1.125`, `ema alpha 0.75`, `hold-current`。EWMA beta は 0.05, 0.1, 0.2。

| horizon ms | best online | mean px | p95 px | p99 px | max px | baseline mean |
|---:|---|---:|---:|---:|---:|---:|
| 4 | beta 0.2 | 1.722 | 6.581 | 14.342 | 81.740 | 1.698 |
| 8 | beta 0.2 | 3.430 | 12.985 | 27.561 | 163.490 | 3.367 |
| 12 | beta 0.2 | 5.592 | 21.841 | 47.626 | 256.558 | 5.481 |
| 16 | beta 0.2 | 8.120 | 32.970 | 73.469 | 352.054 | 7.809 |
| 24 | beta 0.2 | 14.718 | 63.694 | 134.399 | 532.054 | 14.038 |
| 32 | beta 0.05 | 23.131 | 104.693 | 203.601 | 711.806 | 21.698 |
| 48 | beta 0.05 | 43.109 | 200.055 | 379.990 | 1039.013 | 40.789 |

結論として、今回の online expert selection は不採用。選択器自体は future leak なしで動いているが、EWMA error だけでは regime change を先読みできない。短期的に良かった expert を選ぶことで、次の急変で max error が増える。

## 軽量性とレイテンシ

実行性能は次の通り。

| item | value |
|---|---:|
| evaluation elapsed | 0.772 sec |
| total script elapsed | 0.790 sec |
| predictions | 2,783,175 |
| predictions/sec | 3,605,445 |
| candidate count | 3,194,940 |

これは PowerShell から起動した .NET 実装の単一 run であり、JSON 書き出しや zip 読み込みも含む。厳密な CPU benchmark ではないが、すべての候補はアプリ実装上は軽量。相対的には、`constant-velocity-last2` と fixed gain は最小コスト、online expert selection は expert 数分の予測と score 更新が必要で、今回の精度では複雑性に見合わない。

## 注意点

- trace は 1 本のみ。別ユーザー、別 device、drag 状態、monitor layout で ranking が変わる可能性がある。
- acceleration 系は履歴 3 点が揃わない anchor を除外しており、baseline と n が違う。
- online expert selection は hold-current を含むため、segment start のような baseline last2 が無効な anchor も評価に入る。baseline と完全同一 n の比較ではない点に注意。
- mean が改善しても p99 / max が悪化する候補がある。描画品質では tail が目立つ可能性がある。

## 次ステップ

1. 実装候補は `constant-velocity-last2` を既定にする。
2. 12ms 以上で mean / p95 を重視する用途だけ、horizon-dependent gain を feature flag で試す。候補は 12-32ms gain 0.875、48ms gain 0.75。
3. tail safety を優先するなら fixed gain より、予測結果の利用側で 8-16ms horizon に寄せる。
4. online adaptation を続けるなら、EWMA error だけでなく speed change、turn angle、直近停止、segment age などの観測可能 feature を使った regime detector に切り替える。

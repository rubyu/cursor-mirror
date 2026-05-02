# 実験ログ

## 2026-05-01 Step 2

### 初期仮説

Step 1 では `constant-velocity-last2` + cap none が、後半 30% test の非ゼロ horizon すべてで最良だった。固定 cap は速い移動を削って悪化したため、Step 2 では cap よりも速度外挿の強さを調整する方向を優先した。

仮説は 4 つ置いた。

1. horizon が長いほど last2 velocity の外挿は強すぎるので、gain 0.75-0.875 程度の damping が効く。
2. 直近 3 点から acceleration を入れると短い horizon では旋回や加減速に追従できるが、長い horizon では過大外挿の tail が出る。
3. EMA velocity は Step 1 で last2 に負けたが、last2 と blend すれば noise と遅れの中間が取れる可能性がある。
4. online expert selection は、区間ごとに最良 expert が変わるなら固定 gain より良くなる。ただし future leak を避けるには、予測時点ではまだ到達していない t+horizon の正解を使ってはいけない。

### スクリプト実装

成果物を `poc/cursor-prediction/step-2 adaptive-refinements/` に限定し、`run_adaptive_refinements.ps1` を作成した。PowerShell から標準 .NET/C# を `Add-Type` でコンパイルして実行する形式にした。理由は Step 1 の純 PowerShell loop が約 80 秒かかっており、Step 2 は候補数が増えるため、再実行性と速度の両方を取りたかったため。

最初は `Add-Type -ReferencedAssemblies` に compression 系だけを明示したところ、`List<>` など標準型の解決で失敗した。参照指定を外し、事前に `System.IO.Compression` / `System.IO.Compression.FileSystem` を load する形に修正して通した。

trace は zip から stream read し、展開済み CSV は保存していない。評価対象は Step 1 と同じく 100ms 超の idle gap をまたぐ target を除外し、target actual は sample 間の線形補間で求めた。split も sample index の前半 70% / 後半 30% を踏襲した。

### 評価したモデル

baseline 再掲として `constant-velocity-last2` を入れた。さらに `constant-velocity-last2-gain` の gain = 0.25, 0.5, 0.75, 0.875, 1.0, 1.125, 1.25, 1.5 を評価した。cap は none のまま。

constant acceleration は直近 3 samples から v1 / v2 と acceleration を推定し、`current + v*h + 0.5*a*h^2` とした。tail が大きくなる可能性が高いため、acceleration term `0.5*a*h^2` の vector 長だけを 2px / 4px / 8px / 16px に clamp する variant も追加した。

velocity blend は `last2_weight * last2_velocity + (1 - last2_weight) * ema_velocity` とし、weight = 0.25, 0.5, 0.75、EMA alpha = 0.35, 0.5, 0.75 を試した。EMA 単体 alpha = 0.35, 0.5, 0.75 も比較に残した。

online expert selection は expert を小さく保った。expert は last2 gain 0.75, 0.875, 1.0, 1.125、EMA alpha 0.75、hold-current。beta = 0.05, 0.1, 0.2 を評価した。

online simulation では、各 anchor の予測をした時点ではその anchor の target error を score 更新に使わない。時刻 i に来たとき、過去 anchor の target time が現在 sample time 以下になっているものだけを score に反映し、その後で現在 anchor の expert を選ぶ。これで offline evaluation の future leak を避けた。

### 観測したこと

gain grid は仮説通り、長い horizon では damping が効いた。12-32ms は gain 0.875、48ms は gain 0.75 が test mean 最小だった。改善幅は 12ms で 1.26%、16ms で 2.18%、24ms で 4.60%、32ms で 6.04%、48ms で 9.57%。4ms / 8ms では baseline gain 1.0 がほぼ最良だった。

ただし p99 は一貫して改善しなかった。24ms gain 0.875 は mean と p95 を改善したが p99 は baseline 111.837px から 115.193px に悪化。32ms gain 0.875 も p99 は 175.096px から 175.338px にわずかに悪化。48ms gain 0.75 は p95 を 173.675px から 166.869px に下げたが、p99 は 334.807px から 336.313px、max は 720.628px から 752.895px に悪化した。mean だけで採用すると tail risk が残る。

constant acceleration は短い horizon では少し良い場面があった。4ms は accel term cap 4px が mean 1.697px / p95 6.319px で、baseline mean 1.698px / p95 6.472px とほぼ同等から微改善。ただし n が baseline より少ないため、履歴が 3 点揃う anchor だけの評価であることに注意する必要がある。

unclamped acceleration は長い horizon で明確に棄却した。48ms test は mean 62.906px / p95 216.720px / p99 457.826px / max 2158.088px まで悪化し、予想通り過大外挿の tail が出た。acceleration term clamp は tail をかなり抑え、4px cap は 48ms p99 332.505px / max 683.452px で baseline tail より良い面もあったが、mean は 40.956px で baseline 40.789px よりわずかに悪い。product 候補としては、履歴 3 点要件と調整軸の追加に見合う優位はない。

velocity blend はほぼ棄却した。最良寄りの `velocity-blend-last2-w-0.75-ema-alpha-0.75` でも、8ms mean 3.426px、16ms mean 7.969px、48ms mean 41.258px で baseline または gain damping に負けた。EMA の遅れが入り、last2 の強みを薄めている。

online expert selection は期待ほど効かなかった。beta 0.2 が短い horizon では最も良かったが、8ms test mean 3.430px で baseline 3.367px に届かない。12ms では p95 は 21.841px と baseline 22.410px より良いが、mean 5.592px、p99 47.626px、max 256.558px が悪化した。24ms 以降は mean / p95 / p99 / max すべてで明確に悪い。

selection count を見ると、beta 0.2 の test では 24ms 以降で gain 0.75 が多く選ばれ、hold-current も一定数選ばれていた。局所的な EWMA score が良く見える expert を選んでも、次の motion regime で外す場面がある。expert selection は「過去の誤差が近未来の最良 expert を表す」という前提が弱く、特に急な motion change と segment start で tail を増やしたと見ている。

### 棄却した方向

unclamped constant acceleration は tail が大きすぎるので棄却。

EMA 単体と velocity blend は、Step 1 と同じく smoothing delay が勝ってしまい、baseline を明確に超えないため棄却。

online expert selection は今回の小さな expert set と EWMA error だけでは不採用。mean 改善がなく、p99 / max が悪化するため、product の tail safety に合わない。

### 残った候補

最も堅い候補は Step 1 と同じ `constant-velocity-last2`。8ms 以下ではこれをそのまま使うのが良い。

長い horizon で mean / p95 を少しでも下げたい場合は、horizon-dependent fixed gain が候補。12-32ms は gain 0.875、48ms は gain 0.75。ただし p99 / max が悪化する horizon があるため、描画側で tail が見えにくい用途か、別途 guard を入れる場合に限る。


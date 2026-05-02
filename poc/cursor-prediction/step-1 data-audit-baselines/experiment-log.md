# 実験ログ

## 2026-05-01 step-1

### 初期確認

作業対象を `poc/cursor-prediction/step-1 data-audit-baselines/` 以下に限定した。プロジェクトルートには `cursor-mirror-trace-20260501-000443.zip` があり、`poc` ディレクトリは未作成だった。

zip の中身を確認したところ、entries は `trace.csv` と `metadata.json` の 2 つだった。`trace.csv` の header は指定通り `sequence,stopwatchTicks,elapsedMicroseconds,x,y,event`。先頭行は `move` event の連続で、座標と elapsed microseconds が記録されていた。

`metadata.json` は次の内容だった。

- ProductName: Cursor Mirror トレースツール
- ProductVersion: v1.2.0-dev+20260430.4f700b2c43b6.dirty
- CreatedUtc: 2026-04-30T15:04:54.2148992Z
- SampleCount: 15214
- DurationMicroseconds: 500631525
- StopwatchFrequency: 10000000

### スクリプト形式の判断

最初に Python 標準ライブラリのみの実験スクリプトを用意したが、この環境では `python` / `python3` / `py` が PATH に無かった。そのため、ローカル再実行性を優先して PowerShell 版へ切り替えた。

最終的な `run_baselines.ps1` は PowerShell と .NET 標準ライブラリだけで動く。zip から `trace.csv` を stream read し、展開済み CSV や大きな binary を `poc` 以下には保存しない。

### データ監査で見たこと

`trace.csv` は 15,214 samples、全 event が `move` だった。`trace.csv` の first/last elapsed 差は 500.273 sec。座標範囲は x = -3748..4288、y = -83..2188 で、複数 monitor または仮想 desktop をまたいだ座標系に見える。

sample interval は p50 8.013 ms、p90 16.093 ms と短い一方、p95 71.948 ms、p99 496.177 ms、max 15448.841 ms だった。通常の motion sampling と明確な idle pause が混ざっているため、100 ms を超える interval を idle gap として扱うことにした。この threshold では 656 gaps、657 segments に分割され、segment length は p50 15 samples、p95 76 samples、max 250 samples だった。

### 評価方法

各 sample `i` の時刻を anchor `t` とし、`t+horizon` の実位置を sample 間の線形補間で求めた。`t+horizon` が trace 終端を超える場合、または 100 ms 超の idle gap をまたぐ補間が必要な場合は評価から除外した。

速度を使う model では、同じ 100 ms threshold で履歴を reset した。例えば last2 は直前 sample が同一 segment にある場合だけ有効、回帰 N は直近 N samples が同一 segment に揃う場合だけ有効、EMA も gap 後に初期化する。

split は sample index の時系列 split として、前半 70% を `train_first_70pct`、後半 30% を `test_latter_30pct` にした。今回の baseline は online model で学習 fit は無いため、split は評価集計の分離として使っている。

### 試した model と理由

`hold-current` は動かない予測の下限 baseline として入れた。カーソルが停止または低速の区間では強く、動く区間では horizon に比例して悪化するはず。

`constant-velocity-last2` は最小コストで速度を使う baseline。hook / render loop に入れる想定では、直近 2 点だけの O(1) 計算がレイテンシ面で有利。

`linear-regression-velocity-N3/N5/N8` は last2 のノイズを短い窓でならす狙い。N が増えると古い motion が混ざるため、曲がりや加減速には弱くなる可能性がある。

`ema-velocity-alpha-0.2/0.35/0.5/0.75` は速度 smoothing の baseline。alpha が高いほど last2 に近く、低いほど安定だが遅れる。

cap は `none`, 16, 32, 64 px を試した。大きな外挿の tail を抑えられる可能性を見るため。ただし cap は予測 offset にかけており、最終 error を直接 clip しているわけではない。

### 観測結果

horizon=0ms は当然すべて 0px になるため、model 比較では非ゼロ horizon を見ることにした。

後半 30% test の非ゼロ horizon では、全 horizon で `constant-velocity-last2` + cap `none` が mean error 最小だった。EMA は alpha=0.75 がほぼ常に 2 位で、linear regression は N=3 が最も良く、N=5/N=8 は smoothing delay が増えて悪化した。

test の `constant-velocity-last2` は、4ms mean 1.698px / p95 6.472px、8ms mean 3.367px / p95 12.602px、16ms mean 7.809px / p95 31.851px、32ms mean 21.698px / p95 91.212px、48ms mean 40.789px / p95 173.675px だった。

`hold-current` は test で 8ms mean 12.655px、16ms mean 25.347px、48ms mean 75.504px。last2 は mean error を 4-8ms で約 73%、48ms でも約 46% 改善した。

cap は今回の trace では悪化した。例えば 48ms test では cap none が mean 40.789px / p95 173.675px だったのに対し、cap 64 でも mean 54.304px / p95 283.778px。fast motion が多く、固定 cap が必要な移動量を削っていると見られる。

全体評価でも test と同じ傾向だった。非ゼロ horizon の best はすべて `constant-velocity-last2` + cap `none`。ただし全体評価の max error は test より大きく、48ms では max 4900.710px まで出ている。これは特定 segment の高速移動または大きな座標ジャンプが tail を作っている可能性がある。

### 実行時間

PowerShell 実装で candidate 4,381,632、valid prediction 3,776,492。評価 loop は 77.361 sec、script total は 79.506 sec、約 48,816 predictions/sec だった。これは PowerShell loop と JSON 化を含む 1 回のローカル測定なので、アプリ内実装の実コストではなく、相対比較の参考値として扱う。

model の 1 prediction あたり計算量は、hold-current O(1)、last2 O(1)、EMA O(1)（速度更新済み前提）、linear regression O(N)。実装候補としては last2 が精度・軽量性のバランスで最初の基準になる。

### 次に試す判断

固定 cap は一旦優先度を下げる。代わりに、last2 を基準にして horizon が長くなるほど速度を減衰する damping、speed-aware / acceleration-aware な adaptive cap、alpha-beta filter、last2 と EMA を切り替える regime detector を試すのが良さそう。

また 32-48ms は tail が大きいため、描画側が許すなら 8-16ms 予測に寄せる方が扱いやすい。もし 32ms 以上が必要なら、単一の速度外挿ではなく tail 対策を主目的にした model が必要になる。

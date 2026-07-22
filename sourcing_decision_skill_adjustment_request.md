# sourcing-decision スキル調整依頼

## 目的

HAKSAI Centralの`decision_pack`を誤読せず、根拠が不足している候補を推測でGO判定しないようにする。

## データ仕様

- `candidate`: 入力ASINのKeepa候補情報。
- `candidate.status`: 一次選別ステータスであり、最終的な参入可否ではない。
- 数値の`null`: 未取得。ゼロとして扱わない。
- 数値の`0`: 確認済みのゼロ。
- `fee_table`: 自社商品の直近90日手数料実績。候補商品の需要予測には使わない。
- `fee_table.orders_90d`: 重複を除いたAmazon注文番号数。
- `fee_table.transaction_lines_90d`: 取引明細行数。
- `fee_table.units_90d`: 直近90日の販売個数合計。
- `own_baseline.units`: `own_baseline_date_from`〜`own_baseline_date_to`の販売個数。月販と呼べるのは期間が1か月の場合のみ。
- `own_baseline`: 自社実績の参考値であり、候補商品の予測値ではない。
- `unit_price_1688`と`landed_cost_actual`は現行CentralではJPY。
- `yen_per_cny_composite_median=null`: 円/元係数は利用不能。

## 必須ルール

1. `candidate=null`なら個別参入判断を行わず、「候補データなし」と返す。
2. `price_min`または`price_max`が`null`なら販売価格を推定しない。
3. `offer_count`または`fba_count`が`null`なら、競合ゼロ・供給不足・未開拓と判定しない。
4. `yen_per_cny_composite_median=null`なら、円/元係数、中国仕入原価、着地原価、利益率を推定しない。
5. 1688単価をユーザーが明示していない場合、仮の元単価を置かない。
6. `fee_table`の注文数・明細数・販売個数を、候補商品の月販として扱わない。
7. `own_baseline`のCVRや販売数を候補商品の予測値へ直接転用しない。
8. `fba_fee_unit=0`はFBA手数料ゼロの根拠にせず、自己発送・欠損の可能性がある参考外データとして扱う。
9. A+、動画、広告による改善率を、根拠データなしに定量化しない。
10. 価格・原価・競合数のいずれかが不足し、利益検証できない場合は最終判定を`追加調査`または`条件付き保留`にする。

## 推奨する回答構成

1. 確認できた事実
2. 未取得・不足データ
3. 自社実績から使える参考レンジ
4. 利益計算に必要な追加入力
5. 条件別判断（例: 着地原価X円以下なら検討）
6. 最終判定: GO / 条件付き保留 / 見送り

## 禁止する推論例

- `offer_count=null`を「出品者0」と解釈する。
- `orders_90d=1355`を「月販1355」と解釈する。
- `yen_per_cny_composite_median=null`から「自社平均32〜38倍」と推定する。
- 根拠のない10元を置き、利益率53%と計算する。
- 自社卓上ベルのCVR 58.7%を候補ヘアゴムの期待CVRとして扱う。

## 受け入れテスト

候補ASINの入力が以下の場合:

- `monthly_sold=300`
- `price_min=null`, `price_max=null`
- `offer_count=null`, `fba_count=null`
- `yen_per_cny_composite_median=null`

期待する回答:

- 月販300は確認済み事実として記載する。
- 価格、競合数、原価、利益率は「未取得」とする。
- 供給不足や競合ゼロとは判定しない。
- GO判定や初回500個発注を提示しない。
- 必要な追加情報として想定販売価格、人民元単価、見積着地原価、実際の競合数を求める。
- 最終判定を`追加調査`または`条件付き保留`とする。

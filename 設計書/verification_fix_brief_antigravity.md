# 仮説検証機能 修正指示書（Antigravity向け）

- 対象: `index.html`（`buildActualPack_` / `buildHypothesisPack_` / `renderVerificationSection` 周辺）および `コア/コード.js`（`generateRetrospective_` のパック構築・保存処理）
- 前提: 卒業商品タブの仮説検証機能は実装済み。本書はその監査で見つかった不具合の修正指示
- 着手前に `/DESIGN.md`（特に Accent Law）を読むこと
- 作成日: 2026-07-12

---

## 課題1: 月販実績が実勢より大幅に少なく表示される（最優先）

### 1.1 原因（コード確認済み）

`index.html` の `buildActualPack_()`:

```js
const rows = safeArray(card.sales_actual)
  .filter(...).sort(...).slice(-3);          // 直近3ヶ月 = 進行中の当月を含む
monthly_sales = rows.length ? qty / rows.length : null;  // 単純に月数で割る
```

**進行中の当月（本日=7月12日なら 2026-07 は12日分の数量しかない）を「1ヶ月」として頭数に含めて平均している。** さらに販売開始月（月の途中から販売開始した部分月）も同様に1ヶ月扱い。

実データでの影響例（research_lessons 2行目）:
- periods=[2026-06, 2026-07]、qty=33 → 33÷2＝**16.5個/月** と算出
- しかし7月は12日分しかないため、仮に6月24個・7月9個なら実勢は**月販24個ペース**。約3割減で表示されている
- 1行目は periods 3ヶ月中、開始月と当月の両方が部分月の可能性があり、希釈が二重にかかる

### 1.2 調査タスク（修正前に実施し、結果を報告すること）

1. 対象2カード（card_id: `907e0d26-…` / `f1657220-…`）の `sales_actual` 生データ（period / qty / sales_taxin / gross_profit）をログ出力し、月別内訳を確認する
2. `resolveSaleStartDate_()` の返す販売開始日と、最初の period の関係を確認（開始月が部分月か）
3. `syncTransactions()` 側で数量の取りこぼしがないか簡易確認（当該ASINの取引行数と sales_actual の qty 合計が一致するか、返品がマイナス計上されているか）
4. 以上から「表示16.5 vs 実勢」の差の内訳（当月希釈○%・開始月希釈○%・データ欠落○%）を1〜3行で報告

### 1.3 修正仕様

`buildActualPack_()` を以下のロジックへ変更する（サーバー側 `generateRetrospective_` 内の実績パック構築も**同一ロジックに同期**すること。フロントとサーバーで数字が食い違ってはならない）:

```
1. 当月（進行中の月）は平均の分母に含めない
2. 販売開始月が部分月の場合:
   - 開始月以外に完了月が1ヶ月以上あれば、開始月も分母から除外
   - 完了月が開始月しかなければ、開始月を日割り補正して使う
     （qty × 月の日数 ÷ 販売開始日からの在籍日数）
3. 対象は直近の完了月 最大3ヶ月
4. 完了月が0件（今月販売開始）の場合のみ、当月を日割り換算した速報値を返し
   provisional: true を立てる
5. price / profit_rate も同じ対象月で計算する
```

戻り値に根拠情報を追加する:

```js
return { price, monthly_sales, profit_rate, data_ready,
         provisional,                      // 日割り速報値のとき true
         basis: rows.map(r => ({ period: r.period, qty: toNumber(r.qty), prorated: bool })) };
```

### 1.4 表示仕様（根拠の可視化）

- 対比表の「月販」行の直下に、根拠サブ行を沈み面（`rgba(0,0,0,0.18)`・`--mono`・11px）で表示する:
  `根拠: 5月 12個 ／ 6月 24個（当月・開始月は平均から除外）`
- `provisional: true` のときは実績セルに「速報値」を `--check` 色で添える
- 仮説側が null（手動カード等）のとき、判定チップは出さず仮説セルに「仮説なし」を `--muted` で表示する。**nullを0扱いして「要確認」判定を出してはならない**
- 判定チップは方向を出す: 的中（±15%以内）／要確認（上振れ）／要確認（下振れ）

---

## 課題2: リサーチ時の長文テキストが無成型で表示・Geminiへ無制限投入されている

### 2.1 原因（コード確認済み）

`buildHypothesisPack_()`:

```js
thesis: [card.weakness, safeObject(project&&project.extra_texts).free_memo]
          .filter(Boolean).join(' / ')
```

`free_memo` には過去のAI相談ログ全文（数千字）が入っているカードがあり、これが weakness と連結されて:
1. 詳細画面の「参入テーゼ：」に無成型のまま流し込まれる（改行なしの巨大ブロック）
2. Gemini への入力と `hypothesis_snapshot_json.thesis` に無制限で入る（トークン浪費・セル肥大）
3. サーバー側で `entry_thesis_tags` に weakness **全文**が1タグとして混入する（全文一致は二度と起きない死にタグ）

### 2.2 修正仕様（パック構造の分離）

```js
// buildHypothesisPack_ の thesis を分離。フロント・サーバー共通
{
  price, monthly_sales, profit_rate,
  thesis: String(card.weakness || '').trim(),               // 参入テーゼ = weakness のみ
  memo: String(free_memo || '').trim().slice(0, 4000)       // 相談メモ = 上限4,000字で切る
}
```

- **memo を入力から外さないこと。** 前回の生成結果では、hit/missed の仮説（「初心者向け実用セット」「12種ミックスが本命」）はこのメモから抽出されており、検証材料として有効。上限だけ設ける
- `hypothesis_snapshot_json` も `{ ..., thesis, memo }` の分離構造で保存する

### 2.3 表示仕様

- 「参入テーゼ：」行は `thesis`（weakness）のみを表示
- memo がある場合はその下に折りたたみを追加:
  ```html
  <details><summary>リサーチ時の相談メモ（{文字数}字）</summary>
    <div style="white-space:pre-line; color:var(--muted2); font-size:12px; ...">{memo}</div>
  </details>
  ```
  デフォルト閉。`white-space:pre-line` で改行を保持し、無成型ブロックを解消する
- 詳細モーダル内で free_memo / summary を生テキスト表示している箇所が他にあれば、同じ `white-space:pre-line` ＋折りたたみパターンを適用する

---

## 課題3: research_lessons の保存データ品質（サーバー側）

### 3.1 entry_thesis_tags の汚染修正

現状の実データ: `["ブランド力に依存しており、機能的な説明やセット提案が不足している","sourcing","listing"]`

- weakness 全文のタグ投入を**廃止**。タグは `lessons_json[].tag` の重複排除のみで構成する
- Gemini プロンプトに追記: 「`tag` は applies_to の値（sourcing/ad/listing）を流用せず、テーマを表す短句にする。例: 需要予測、価格帯xページ品質、セット販売、ブランド代替」

### 3.2 own_asin の空欄修正

2行目の own_asin が空（1行目は入っている）。保存時の解決を以下のフォールバックにする:

```js
own_asin = own_listing.primary_asin || card.asin || own_listing.parent_asin
        || (own_listing.child_asins || [])[0] || '';
```

空のままだと教訓ライブラリの実例リンクと `getLessonsForCandidate_` の example が欠落するため必須。

### 3.3 プロンプト追記（教訓の切れ味）

「『〜場合がある』のようなヘッジで終わらせず、どんな場合かを条件側に書く（条件→帰結の形を守る）」を lessons の指示に1行追加する。

---

## 実装上の制約

- フロント `buildActualPack_` / `buildHypothesisPack_` とサーバー側（generateRetrospective_ 内）のパック構築は**必ず同一ロジック**にする。本書§1.3・§2.2 が正本
- 既存の research_lessons 行は書き換えない（追記専用の原則を維持。旧構造の行は表示側で `thesis` に旧 `thesis` 全文が来ても崩れないよう、表示は先頭200字＋折りたたみでフォールバック）
- 一覧・詳細の表示時に追加API・AI呼び出しを増やさない
- 色は既存トークンのみ（判定=シグナル配色、根拠サブ行=沈み面）。DESIGN.md の Accent Law を遵守

## 受け入れ条件

1. 7月12日時点で periods=[06,07]・6月24個・7月9個のカードの月販実績が **24.0** と表示される（16.5にならない）
2. 完了月が0件のカードは日割り速報値＋「速報値」表示になり、90日経過判定とは独立に動く
3. 月販行の直下に月別内訳の根拠サブ行が表示される
4. 仮説月販が null のカードで「要確認」判定が出ない（「仮説なし」表示）
5. 「参入テーゼ：」に weakness のみが表示され、相談メモは折りたたみ＋改行保持で表示される
6. 新規生成の hypothesis_snapshot_json で thesis と memo が分離され、memo が4,000字以内
7. 新規生成の entry_thesis_tags に weakness 全文・applies_to 値が混入しない
8. own_asin がフォールバックで必ず埋まる（sku接続済みカードで空にならない）
9. 修正後にフロントの対比表とサーバー保存の actual_snapshot_json の数値が一致する
10. 課題1の調査報告（差の内訳）が提出される

## テストケース（抜粋）

- 開始月のみ（今月開始・完了月0）→ 日割り速報値＋provisional
- 開始月（部分月）＋完了月2ヶ月 → 開始月・当月とも除外、完了月2ヶ月の平均
- 月の1日開始（部分月でない開始月）→ 通常の完了月として扱われる
- sales_actual に gross_profit 欠損月が混在 → profit_rate は欠損月を除いた月で計算（現行踏襲）
- 旧構造の research_lessons 行（thesis に長文連結）→ 表示が崩れず折りたたみにフォールバック

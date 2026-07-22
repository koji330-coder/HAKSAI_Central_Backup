# HAKSAI Central「ページ案」一覧画面改修 ＋ 寝かせ（Shelf）機能 設計書

- 対象: `index.html`（ページ案タブの一覧描画）/ `コード.js` / （読み取り連携のみ）`分析/秘書.js`
- 前提: ページ制作モーダル改修（`derivePageProductionProgress()` 実装済み）の上に構築する
- 準拠: `DESIGN.md`（Accent Law / シグナル配色＝意味固定 / primary抑制）
- 作成日: 2026-07-11

---

## 0. 設計思想

1. **一覧＝次にやることリスト。** カードの主役は手動ステータスではなく、`derivePageProductionProgress()` が導出する「次の一手」。
2. **停滞警告は必ず actionable。** 停滞バッジは単なる表示ではなく「進める／寝かせる／撤退」の再判断トリガー。警告が溜まり続ける構造を作らない。
3. **寝かせる＝意思決定。** 「いつかやるかも」を放置ではなく、理由と再判断期日つきの明示的な選択として記録する。
4. **消さない、隠すだけ。** 寝かせ中カードは一覧から消えるが、件数は常に見え、いつでも復活できる。
5. **すべての判断をログに残す。** 秘書機能（マイカ）が後から拾って掘り起こし・棚卸しを促せるよう、イベントログを正本として蓄積する。

---

## 1. データモデル

### 1.1 `page_projects` への追加列（4列）

`REQUIRED_HEADERS_PAGE` に追記する。`ensureHeaders_()` が起動時に自動追加するため既存行のマイグレーションは不要（空文字＝寝かせていない）。

```text
shelf_state    : '' | 'shelved'
shelved_at     : ISO日時。寝かせた日時
wake_at        : ISO日時 or ''。再表示予定日。空は無期限
shelf_reason   : 寝かせ理由（UI上必須。データ上は文字列）
```

設計判断: **既存 `status` とは直交させる。** status は制作工程の現在地（構成前／素材追加中／…）、shelf_state は可視性の状態。混ぜると、素材追加中まで進んだカードを起こしたとき工程情報が失われる。`status='撤退'` は従来どおり「見送りの最終判断」として使い、寝かせとは意味を分ける（§5）。

### 1.2 イベントログシート `page_project_events`（新設・秘書連携の正本）

秘書機能拡充で後から読み取ることを前提に、寝かせ以外のイベントも追記できる汎用スキーマにする。

```text
REQUIRED_HEADERS_PAGE_EVENTS = [
  'event_id',          // UUID
  'page_project_id',
  'source_card_id',    // 秘書がASIN/カード起点で辿れるように冗長保持
  'event_type',        // §1.3 参照
  'reason',            // ユーザー入力の一言（shelf_reason等）
  'payload_json',      // 追加情報 {wake_at, extend_count, prev_status, ...}
  'actor',             // 'user' | 'maika' | 'system'
  'created_at'
]
```

追記専用（更新・削除しない）。書き込みは共通関数1つに集約する:

```js
function logPageProjectEvent_(projectId, sourceCardId, eventType, reason, payload, actor) {
  const sh = getSheetByName_(SHEET_PAGE_EVENTS, REQUIRED_HEADERS_PAGE_EVENTS);
  sh.appendRow([Utilities.getUuid(), projectId, sourceCardId || '', eventType,
    reason || '', JSON.stringify(payload || {}), actor || 'user', new Date().toISOString()]);
}
```

### 1.3 event_type 一覧

| event_type | 発生タイミング | payload_json の主キー |
|---|---|---|
| `shelved` | 寝かせ実行 | `{wake_at, prev_status}` |
| `shelf_extended` | 起床時に「もう寝かせる」を選択 | `{wake_at, extend_count}` |
| `woke_manual` | 寝かせ一覧から手動で起こした | `{}` |
| `woke_due` | 期限到来で一覧に復帰表示された（表示時に1回だけ） | `{wake_at}` |
| `retired_from_shelf` | 寝かせ→撤退に転換 | `{shelved_days, extend_count}` |
| `retired` | 通常カードから撤退 | `{prev_status}` |
| `stale_prompted` | 停滞バッジから再判断メニューを開いた | `{stale_days}` |
| `shelf_review_done` | 棚卸しを完了した（マイカ促し経由含む） | `{reviewed_count, retired_count}` |

> 将来の秘書拡充では、このシートを既存の秘書イベント収集系と同様に読み取るだけでよい。ページ制作側は event を書く責務のみ持ち、秘書側の表示仕様には依存しない。

### 1.4 定数（一元管理）

```js
const PAGE_STALE_DAYS = 7;            // 停滞判定。★7日
const SHELF_REVIEW_INTERVAL_DAYS = 30; // 棚卸し促しの間隔
const SHELF_EXTEND_NUDGE_COUNT = 2;    // この回数目の延長でマイカが撤退を提案
```

停滞日数はフロント・サーバーで**この定数以外に書かない**。フロントは `getConfig` 系の既存初期ロードに載せるか、同値のJS定数を1箇所に定義し、コメントで同期先を明記する。

---

## 2. 一覧画面の仕様

### 2.1 表示フィルタ（デフォルト）

```
表示: shelf_state='' かつ status≠'撤退' のカード
非表示: 寝かせ中（→ §2.4 の畳み行へ）、撤退（従来どおり）
```

### 2.2 カード表面（フェーズ1＋2）

各カードで `derivePageProductionProgress(project, null)` を呼び、以下を描画する（追加API・AI呼び出しなし）。

1. **次の一手チップ**（カード下部・タップ可）
   - `nextAction.label` を表示。タップ→モーダルを開き `runPageNextAction()` を即実行（該当箇所へスクロール／フォーカス）
   - 塗り（ゴールドprimary）は労力=⚡1タップ系（`adopt_extracted_input`）のみ。他はゴールド枠のアウトライン
2. **労力バッジ**: nextAction.type→労力の対応表
   - ⚡1タップ: `adopt_extracted_input`
   - 🤖AI 1分: `generate_draft` / `extract_inputs`
   - 📷素材待ち: `add_screenshots` / `enter_supplier_url` / `confirm_facts`
   - ✅仕上げ: `review_draft`
3. **停滞バッジ**: `updated_at` から **7日** 超過 かつ 未完了（`review` 未complete）かつ shelf_state='' のとき、`--check` 色で「N日停滞」
   - **タップで再判断メニュー**（§2.3）。表示だけのバッジにしない
4. **ミニステッパー**（フェーズ3）: 5ドット。complete=`--go`、現在地=`--accent` 1点、他は沈み色

### 2.3 停滞バッジ → 再判断メニュー

タップでインラインの3択を出す（モーダル不要、カード内展開でよい）:

```
このカード、7日止まってるよ。どうする？
[▶ 進める]（→ 次の一手チップと同じ動作）
[🛌 寝かせる]（→ §3.1 寝かせダイアログ）
[🗑 撤退にする]（→ status='撤退' ＋ retired イベント）
```

メニューを開いた時点で `stale_prompted` をログ（連打防止に同カード1日1回まで）。

### 2.4 寝かせ中の畳み行（一覧最下部）

```
─────────────────────────────
🛌 寝かせ中 12件（うち起床期限切れ 2件）      [▼]
─────────────────────────────
```

- 常時1行。**件数は隠さない**（完全に別タブへ隠すと墓場化するため）
- 展開するとコンパクト表示: 商品名（1行省略）／shelf_reason／wake_at（「無期限」含む）／[起こす] ボタン
- `wake_at` 昇順ソート。期限切れは先頭＋`--check` 色
- [起こす] → `shelf_state=''` に戻し `woke_manual` をログ。カードは通常一覧へ復帰（statusは寝かせる前のまま）

### 2.5 期限起床（wake_at 到来）

時間駆動トリガーは**作らない**。一覧描画時に `wake_at <= 今日` を検出して処理する:

- 該当カードを通常一覧の**先頭グループ「おかえり（N）」**に表示。「おかえり」バッジ＋shelf_reason を添える
- カードの選択肢は3択に固定: **[▶ 進める] [🛌 もう1ヶ月寝かせる] [🗑 撤退にする]**。「とりあえず放置」に戻さない
- 初回表示時に `woke_due` を1回だけログ（payload に wake_at。二重ログ防止は「同project・同wake_atの woke_due 既存チェック」で行う）
- 「もう寝かせる」選択時は `shelf_extended` をログし `extend_count` をインクリメント

### 2.6 一覧のグループ分け（正式仕様）

通常一覧は日付の平坦な並びをやめ、以下のグループに分割して表示する。
グループ判定は §2.2-2 の労力バッジと同一のマッピングを使い、
判定関数は1つに集約する（別ロジックを作らない）。

| 順 | グループ見出し | 含まれる nextAction.type | 見出し色 |
|---|---|---|---|
| 1 | 👋 おかえり | wake_at 到来カード（§2.5。type問わず最優先） | --check |
| 2 | ⚡ あと1タップで進む | adopt_extracted_input, adopt_candidate | --accent（唯一のゴールド見出し） |
| 3 | 🤖 AIに投げるだけ | generate_draft, extract_inputs | --muted2 |
| 4 | ✅ 完成・販売準備 | review_draft, connect_own_asin, manage_own_listing、および nextAction=null（status=ページ案完成/輸入判断OK） | --muted2 |
| 5 | 📷 素材待ち | add_screenshots, enter_supplier_url, confirm_facts | --muted2 |
| 6 | 🛌 寝かせ中 N件 | shelf_state='shelved'（§2.4 の畳み行。カードは非展開） | --muted |

- 見出しには件数を付ける（例:「⚡ あと1タップで進む（2）」）
- 0件のグループは見出しごと非表示
- グループ内の並び: updated_at 昇順（古い＝停滞が上に浮く）。「おかえり」のみ wake_at 昇順
- 検索ボックス使用時もグループ構造を維持し、ヒット0件のグループは消す
- 撤退カードはどのグループにも属さない（従来どおり非表示）
- 完成案件は消さない。自社ASIN未接続なら「自社ASINを紐付ける」、接続済みなら「販売情報を確認」を次の一手として表示する
- グループ内で停滞カードを先頭に浮かせ、停滞専用グループは作らない
- `derivePageProductionProgress(project, null)` でラクマート候補情報が見えない場合の補正は、グループ側へ別実装せず状態判定関数内に限定する

---

## 3. 寝かせ操作の仕様

### 3.1 寝かせダイアログ（ミニマム2項目）

```
🛌 このカードを寝かせる
理由（必須）: [________________________]
  placeholder: 例）単価が読めない、為替次第 ／ 季節商品、来春に見る
いつ見直す？: ( ) 2週間  (●) 1ヶ月  ( ) 3ヶ月  ( ) 無期限
[寝かせる]  [やめる]
```

- **理由は必須**（空なら実行ボタンを押させない）。3ヶ月後の自分が再判断コストゼロで文脈を取り戻すため
- 実行時: `shelf_state='shelved'` / `shelved_at=now` / `wake_at`（無期限は''）/ `shelf_reason` を保存し、`shelved` イベントをログ（payload に prev_status）

### 3.2 入口

1. 停滞バッジの再判断メニュー（§2.3）— 主経路
2. カードのコンテキスト操作（長押し or … メニュー）— 停滞前でも寝かせられる
3. ページ制作モーダル内（任意・後回し可）

### 3.3 API（サーバー）

既存の `updatePageProject` を流用せず専用アクションにする（ログとバリデーションを1箇所に固定するため）:

```js
// doPost
if (action === 'shelvePageProject')
  return jsonResponse({status:'ok', data: shelvePageProject_(body.pageProjectId, body.reason, body.wakeAt)});
if (action === 'wakePageProject')
  return jsonResponse({status:'ok', data: wakePageProject_(body.pageProjectId, body.mode, body.wakeAt)});
  // mode: 'manual' | 'extend' | 'retire'
```

`shelvePageProject_` は reason 空を throw（「寝かせ理由を入力してください。」）。`wakePageProject_` は mode に応じて shelf列クリア／wake_at更新／status='撤退' を行い、対応する event_type をログする。**どちらもシート正本行を読み書きし、クライアント送信の projectData は受け取らない。**

---

## 4. マイカ連携（掘り起こし・棚卸し）

すべて既存データの集計のみで生成する（表示時のAI呼び出しなし）。

### 4.1 モメンタム帯（一覧最上部・1行）

優先順位つきで**1メッセージだけ**表示する:

1. **起床期限切れあり**: 「寝かせてた『{商品名}』、{期間}経ったよ。市場は変わってるかも。見てみて👀」
2. **棚卸し促し**: 寝かせ中 ≥5件 かつ 直近の `shelf_review_done` から30日超 →「寝かせ中が{N}件あるよ。5分で棚卸しする？ 何件かは見送りにできるかも」→ タップで畳み行を展開＋棚卸しモード（§4.3）
3. **⚡案件あり**: 「あと1タップで生成が解放できる案件が{N}件あるよ」
4. **通常**: 今日更新したカード件数など

### 4.2 撤退への誘導（掘り起こし＝手放す促し）

- 起床時の3択で「もう寝かせる」が **2回目**（`extend_count >= SHELF_EXTEND_NUDGE_COUNT`）になったら、マイカが一言添える:
  「2回目の延長だよ。正直、見送りにしてもいい案件かも？ 撤退にしても記録は残るから、いつでも見返せるよ」
- 撤退＝敗北ではなく判断ログ、というトーンを守る。撤退時は `retired_from_shelf` に寝かせ日数と延長回数を payload で残し、将来の秘書分析（「寝かせ→撤退の平均日数」等）の材料にする

### 4.3 棚卸しモード（畳み行の拡張）

畳み行を展開した状態で「棚卸しを始める」を押すと、寝かせカードを1件ずつ順送りで提示し、各件に [進める][寝かせ続ける][撤退] の3択を出す。完了時に `shelf_review_done` をログ（reviewed_count / retired_count）。凝ったUIは不要で、展開リストの各行に3ボタンを並べる実装でも受け入れ可。

### 4.4 秘書側への引き渡し（今回はフック関数のみ）

秘書機能拡充で朝礼カードに載せられるよう、集計関数を1つ用意して終わりにする（秘書.js の改修は本設計書のスコープ外）:

```js
function getShelfDigestForSecretary_() {
  // returns {shelved_count, due_count, due_items:[{id,title,shelf_reason,wake_at}],
  //          last_review_at, extend_nudge_items:[...]}
}
```

---

## 5. 撤退との棲み分け（ユーザー向け文言にも反映）

| | 寝かせる | 撤退 |
|---|---|---|
| 意味 | まだ決めてない | 見送ると決めた |
| 再判断 | 期日が来たら必ず問われる | 促さない（手動で復活は可能） |
| 一覧 | 畳み行に件数表示 | 非表示（従来どおり） |
| ログ | shelved / woke_* / shelf_extended | retired / retired_from_shelf |

寝かせダイアログの下部に補足1行: 「見送ると決めたなら『撤退』へ。撤退は再判断を促しません。」

---

## 6. デザイン規約への適合

- 停滞・期限切れ＝`--check`（要確認の意味）。寝かせ畳み行・寝かせカード＝沈み色（`--muted` 系）。ゴールドは次の一手チップと現在地ドットのみ
- カード内のゴールド塗りは最大1つ（⚡チップ）。再判断メニュー・起床3択はすべて ghost/outline
- マイカ帯は案A準拠（コアトークン＋ゴールド、`--sec-*` 不使用）
- DESIGN.md へ v1.3 として「一覧カードの進捗表現」「寝かせ行」の項を doc-first で追記してから実装

---

## 7. 実装対象と順序

| 順 | 対象 | 内容 |
|---|---|---|
| 1 | コード.js | 列追加（REQUIRED_HEADERS_PAGE）、`SHEET_PAGE_EVENTS` 新設、`logPageProjectEvent_` / `shelvePageProject_` / `wakePageProject_` / ルート追加、定数 `PAGE_STALE_DAYS=7` |
| 2 | index.html | 一覧フィルタ変更、次の一手チップ＋労力バッジ＋停滞バッジ（7日）＋再判断メニュー、寝かせダイアログ、畳み行、期限起床グループ |
| 3 | index.html | ミニステッパー、モメンタム帯（マイカ）、棚卸しモード、延長2回目の撤退ナッジ |
| 4 | コード.js | `getShelfDigestForSecretary_()`（秘書拡充への引き渡し口） |
| — | DESIGN.md | v1.3 追記（実装前） |

---

## 8. 受け入れ条件

1. 停滞バッジは更新から**7日**超で表示され、タップで「進める／寝かせる／撤退」が選べる（表示だけのバッジが存在しない）
2. 寝かせは理由未入力では実行できない
3. 寝かせたカードは一覧から消え、最下部の畳み行に件数が常時表示される
4. 畳み行から任意のカードを1タップで起こせ、寝かせる前の status のまま復帰する
5. wake_at 到来カードは一覧先頭「おかえり」グループに理由つきで復帰し、選択肢は3択（進める／延長／撤退）のみ
6. すべての shelved / woke_* / shelf_extended / retired_from_shelf / retired / stale_prompted / shelf_review_done が `page_project_events` に追記される（更新・削除なし）
7. 同一カード・同一 wake_at の `woke_due` が重複記録されない
8. 延長2回目の起床時にマイカの撤退ナッジ文言が表示される
9. 寝かせ中 5件以上かつ棚卸し30日超で、モメンタム帯に棚卸し促しが出る
10. 一覧表示・寝かせ・起床のいずれもAI呼び出しゼロ、追加のGET APIゼロ（既存の getPageProjects で shelf列も返る）
11. 停滞判定・棚卸し間隔・ナッジ回数は定数1箇所の変更で全体に反映される
12. 撤退カードに停滞バッジ・起床促しが表示されない

## 9. テストケース（抜粋）

- 更新6日→バッジなし／8日→「8日停滞」表示（境界）
- 寝かせ→即起こす→status・extracted_input・listing_handoff が完全に保持されている
- wake_at 無期限（''）のカードが期限起床に決して現れない
- 期限起床カードを再表示（リロード）しても `woke_due` が増えない
- 延長→wake_at が選択期間ぶん更新され、extend_count がインクリメントされる
- 寝かせ→撤退: shelf_state がクリアされ status='撤退'、`retired_from_shelf` に shelved_days が記録される
- events シートが存在しない初回起動で自動作成される

# HAKSAI Central「ページ制作」UX改修プラン

- 対象: `index_32_.html`（ページ制作モーダル）/ `コード.js` / `rakumart_sourcing.gs`
- 準拠: `DESIGN.md` v1.1（Accent Law・明度の梯子・primary1つの原則）
- 作成日: 2026-07-11

---

## 1. 現状の情報設計上の問題点（コード根拠付き）

### 1.1 ロック判定が「全案件ロック」になっている

`createPageProjectFromCard()`（コード.js L1252）は**全ての新規ページ案件**に `sourcing_state: 'needs_search_brief'` を設定します。一方フロントのゲート判定は：

```js
const gated = (safeArray(p.tags).includes('ATLAS') && !handoff.ready)
           || (!!p.sourcing_state && !handoff.ready);
```

後半の条件により、**ATLAS以外の案件も含めて、ラクマート候補を採用しない限り全案件が永久にロック**されます（受け入れ条件9の違反が現行仕様に内在）。サーバー側 `generatePageDraft_()` L1794 も同一条件です。

### 1.2 見た目の順序と状態機械が一致していない

モーダルの視覚順序は：

```
1️⃣ 探す条件を作る → 2️⃣ ラクマート候補を保存 → 3️⃣ 候補を比較・採用
→ （番号なし）📎 仕入元・競合素材（URL＋スクショ＋Gemini抽出）
→ 4️⃣ ページ制作
```

「📎 仕入元・競合素材」セクションは**番号を持たず**、1️⃣〜3️⃣とは独立した完結ルートに見えます。しかし `extractPageInputs` ルート（コード.js L486〜）が更新するのは `extracted_input` / `extraction_meta` / `extra_image_ids` のみで、ゲート解放に必要な `listing_handoff` / `adopted_candidate_id` / `sourcing_state` には**一切触れません**。

今回の事例（B08FD57ZH8）がまさにこれです：

| ユーザーが完了した認識 | 実データ |
|---|---|
| スクショ6枚保存・解析 | `extra_image_ids: 6件` ✅ |
| 素材・サイズ抽出 | `evidence: 5件（confidence: high, source_image付き）` ✅ |
| 仕入先確定 | `adopted_candidate_id: 空` / `listing_handoff: {}` ❌ |
| — | `sourcing_state: needs_search_brief`（初期値のまま）❌ |

さらに `extra_texts.supplier_url` は**空**でした。URL入力欄が「rakumart-candidate-url」と「page-supplier-url」の2箇所あり、どちらに入れたか／保存されたかがユーザーに見えないことの証左です。

### 1.3 「解析済み」と「採用済み」の区別が伝わらない

抽出結果は `page-extracted-input`（読み取り専用textarea）に生JSONで表示されるだけで、「これはまだ**候補として採用されていない**」ことを示すUIがありません。抽出直後のトーストも「未確認項目だけ確認してください」であり、次に採用操作が必要だとは読めません。

### 1.4 ロック理由が抽象的・無反応

```js
$('generatePageDraftBtn').disabled = gated;
$('page-generation-gate').textContent = '先にラクマート候補を採用し、確認済み仕様を確定してください。';
```

disabledボタンは押しても無反応。どのセクションの、どのボタンで、何のデータが不足しているかが示されません。

### 1.5 状態更新後の反映が関数ごとにバラバラ

`adoptRakumartCandidate()` はモーダル全体を再オープン、`extractPageInputs()` はtextareaとギャラリーのみ更新、`savePageProject()` はタブ再描画のみ。ゲート表示・進捗の再計算が一元化されていないため、操作後に「今どこか」が更新されません。

### 1.6 サーバーゲートがクライアント送信データを信用している

`generatePageDraft` ルートは `body.projectData` をそのまま `generatePageDraft_()` に渡して検証しています。ゲート判定に使う `listing_handoff` / `sourcing_state` は**シートの正本行から読むべき**です（現状はフロント改変で理論上迂回可能）。

---

## 2. 改善後のユーザーフロー

```
┌─ ページ制作案件を開く ──────────────────────────────┐
│                                                      │
│  [進行ステッパー] ①競合情報 ②仕入先・素材 ③仕入候補の確定 │
│                   ④ページ案生成 ⑤内容確認・仕上げ        │
│                                                      │
│  [マイカ・ガイド] 現在地の要約＋次の一手を1つ提示          │
│  [次にやること] 主ボタン1つ（状態に応じて切替）            │
└──────────────────────────────────────────────────┘

ルートA（今回の事例型：仕入先を自力で見つけた場合）
  URL入力 → スクショ追加 → 「スクショから抽出」
  → ★新設「この解析結果を仕入候補として採用」 ← 1クリックでゲート解放
  → ページ案を生成

ルートB（従来型：ラクマートで探す場合）
  検索指示書生成 → 候補URL＋スクショ登録 → 比較 → 「この候補を採用」
  → ページ案を生成（従来どおり、後方互換）
```

ポイントは、**ルートAの解析結果をルートBの採用データ構造（`listing_handoff`）へ安全に変換する新API**を1つ追加し、URL・スクショの再入力を不要にすることです。

---

## 3. ワイヤーフレーム

### 3.1 モバイル（〜719px）

```
┌──────────────────────────────┐
│ [status ▼]                 × │
│──────────────────────────────│
│ ●──●──◉──○──○   ← 縦積みしない │
│ ①完 ②完 ③今 ④鍵 ⑤未          │
│ ┌──────────────────────────┐ │
│ │③ 仕入候補の確定（現在地）    │ │ ← 現在ステップの
│ │ スクショ6枚・仕様抽出済み。  │ │    詳細だけ展開
│ │ 採用候補が未確定です。      │ │
│ └──────────────────────────┘ │
│ ┌─ 👱‍♀️ マイカ ───────────────┐ │
│ │ スクショ6枚の解析は終わってる│ │
│ │ よ✨ 次は下のボタンで採用！  │ │
│ └──────────────────────────┘ │
│ ┌─ 次にやること ─────────────┐ │
│ │ 解析済みの仕入先情報を採用   │ │
│ │ 候補として確定してください。 │ │
│ │ [この解析結果を仕入候補として│ │ ← primary（ゴールド）
│ │  採用]                     │ │    画面唯一の塗りボタン
│ └──────────────────────────┘ │
│ ▼ 以下、既存セクション（順序整理）│
└──────────────────────────────┘
```

ステッパーは5点＋接続線の**ドット型**（ラベルは現在ステップのみフル表示、他は短縮）。横スクロール不要。

### 3.2 PC（720px〜）

```
┌────────────────────────────────────────────────┐
│ ①競合情報 ──── ②仕入先・素材 ──── ③仕入候補の確定 ──── ④ページ案生成 ──── ⑤仕上げ │
│   完了 ✓        完了 ✓(6枚)       ◉ 現在地           🔒 ロック中        未着手   │
│  （各ステップにラベル＋detail1行を常時表示）                                      │
├────────────────────────────────────────────────┤
│ 👱‍♀️ マイカ・ガイド ＋ 次にやることパネル（横並び2カラム可）                        │
└────────────────────────────────────────────────┘
```

### 3.3 セクション順序の再編成

現在の 1️⃣2️⃣3️⃣（ラクマート）→📎素材→4️⃣生成 を、進行順に合わせて再配置します。

```
[進捗ステッパー]（新設・モーダル最上部）
[マイカ・ガイド]（新設）
[次にやること]（新設）
──────
② 仕入先・素材（旧📎を昇格。URL＋スクショ＋抽出＋★採用ボタン）
③ 仕入候補の確定
   ├ タブA「解析結果から採用」（★新設：②の結果サマリー＋採用ボタン）
   └ タブB「ラクマートで探す」（旧1️⃣2️⃣3️⃣を折りたたみで格納）
④ ページ制作（生成ボタン＋説明可能ゲート）
⑤ 生成結果・利益・輸入判断（既存のまま）
```

ラクマート系3セクションは `<details>` 折りたたみに格納し、`sourcing_brief` が存在する案件では自動展開（後方互換）。

---

## 4. 状態別の表示一覧

ステップ状態は5種類に固定します：`complete` / `current` / `attention`（要確認）/ `locked` / `pending`。

| 状態 | 色（既存トークン） | アイコン |
|---|---|---|
| complete | `--go` 系（`--go-bg`地＋`--go-bdr`縁） | ✓ |
| current | `--accent`（ゴールド発光。現在地は最も目立つ） | ◉ |
| attention | `--check` 系 | ⚠ |
| locked | `--muted` ＋ 🔒 | 🔒 |
| pending | `--muted`（縁のみ） | ○ |

シグナル配色は「判断状態の意味」への固定（DESIGN.md 原則8）に準拠：complete=go、要確認=check。装飾流用ではなく進行判断そのものなので適合します。

### nextAction 一覧（表示文言の正本）

| type | 発生条件 | ボタンラベル | reason文言 |
|---|---|---|---|
| `enter_supplier_url` | URL空・スクショ空 | 仕入先URLを入力 | 仕入先URLがまだ保存されていません。 |
| `add_screenshots` | URL有・スクショ0枚 | スクリーンショットを追加 | 仕様の根拠になるスクショがありません。 |
| `extract_inputs` | スクショ有・抽出なし | スクショから必要事項を抽出 | Gemini解析がまだ実行されていません。 |
| `adopt_extracted_input` | 抽出済・未採用・根拠付き事実≥1 | この解析結果を仕入候補として採用 | 解析済みですが、ページ制作へ渡す確認済み仕様がまだ確定していません。 |
| `confirm_facts` | 採用済だが `ready=false` | 確認済み仕様を追加 | 根拠付きの確認済み仕様が0件のため生成できません。不足: {missing列挙} |
| `adopt_candidate` | ラクマート候補有・未採用（タブB利用中） | 候補カードの「この候補を採用」を押す | 候補は保存済みですが未採用です。 |
| `generate_draft` | `ready=true`・ドラフト未生成 | ページ案を生成 | 確認済み仕様だけを使って生成します。 |
| `review_draft` | ドラフト生成済 | 内容を確認して仕上げる | タイトル・箇条書き・画像構成を確認してください。 |

**1画面のprimary（ゴールド塗り）は nextAction のボタン1つのみ。** `generatePageDraftBtn` は nextAction が `generate_draft` のときだけ primary になり、それ以外は ghost＋🔒表示（原則6遵守。現状は保存ボタン等と塗りが複数併存しており、この機会に整理）。

### ロック中の「ページ案を生成」の挙動

- disabled にはせず、**押下可能なghostのまま**にする。
- 押すと `page-generation-gate` パネル（下記）へスムーズスクロール＋一瞬ハイライト。完全な無反応を排除。
- パネル内容：

```
🔒 まだ生成できません
理由: ページ制作へ渡す確認済み仕様（listing_handoff）が未確定です。
不足: 採用済み仕入候補
これで解放: ③のタブA「この解析結果を仕入候補として採用」を押す
※ 完了済みのスクショ解析をやり直す必要はありません。
```

---

## 5. マイカのコメント例

**デザイン上の判断（要確認・doc-first）:** DESIGN.md v1.1 の Accent Law はピンク（`--sec-*`）を「秘書タブの朝礼カード」のみに限定しています。ページ制作モーダル内のマイカ・ガイドは：

- **推奨案A（Accent Law完全遵守）**: 器はコアトークン（`--surface2`＋ゴールド細縁）、アバターリングのみ既存SVGアバターをそのまま使用。ピンクは一切使わない。キャラクター性は口調・絵文字で担保。
- **案B**: DESIGN.md を v1.2 に更新し「マイカ発話カード（場所を問わず、彼女が話者であるカード）」へ `--sec-*` スコープを拡張してから実装。ただし波及リスクがあるため、拡張するのは `--sec-pink-bdr`（アバターリング）と `--sec-pink-soft`（名前ラベル）の2つだけに限定し、塗りCTA・グロー背景は朝礼カード専用のまま維持。

本プランは**案A**で実装コードを書きます（案Bにする場合はCSSクラス1つの差し替えで済む構造にします）。

コメントはフロントの純粋関数でテンプレート生成します（Gemini呼び出しなし。指示書6.4の要件どおり）。

```
状態: adopt_extracted_input（今回の事例）
─────────────────────────────
👱‍♀️ マイカ
スクショ6枚の解析は終わってるよ✨
ステンレス素材と、20cm・25cm・30cmの3サイズまで確認できてる！
ただ、この解析結果はまだ「採用候補」になってないの。
下の「この解析結果を仕入候補として採用」を押せば、ページ案生成が解放されるよ。

状態: confirm_facts
─────────────────────────────
👱‍♀️ マイカ
採用まで進んだけど、根拠付きの確認済み仕様がまだ0件…💦
価格かサイズか素材、どれか1つでもスクショで確認できれば生成に進めるよ。
不足: 単価（元）／セット内容

状態: generate_draft
─────────────────────────────
👱‍♀️ マイカ
準備ばっちり！確認済み仕様5件でページ案を作れるよ🎉
未確認の項目（単価・MOQ）は生成文には使わないから安心してね。

状態: review_draft
─────────────────────────────
👱‍♀️ マイカ
ページ案できてるよ！タイトル3案と画像7枚構成を見て、
気になるところは直接編集して保存してね📝
```

差し込み変数: 商品名 / `extra_image_ids.length` / 確認済み仕様の要約（material・dimensionsを優先して最大2件）/ `unknown_fields` / `cost_simulation` の有無 / currentStep。「マイカに相談」ボタン（ghost）を併設し、押されたときだけ既存の秘書AI相談ルートを呼ぶ（画面表示時のAI呼び出しゼロを維持）。

---

## 6. `derivePageProductionProgress()` の設計と実装

フロント側の**純粋関数**。同じ判定ロジックをサーバーの `evaluatePageGenerationGate_()` にも置き、両者は本節を正本として同期させます（言語環境が違うため物理共有は不可。テストケース§11で両者の一致を担保）。

```js
// ============ ページ制作: 進行状態の一元判定（純粋関数・API呼び出しなし） ============
// 正本: page_production_ux_plan.md §6。サーバー evaluatePageGenerationGate_() と同期必須。

function derivePageProductionProgress(project, rakumartBoard) {
  const p = project || {};
  const extra = safeObject(p.extra_texts);
  const handoff = safeObject(p.listing_handoff);
  const extracted = safeObject(p.extracted_input);
  const board = safeObject(rakumartBoard);
  const candidates = safeArray(board.candidates);
  const draft = safeObject(p.page_draft);

  // --- 素材の実態 ---
  const shotCount = safeArray(p.extra_image_ids).length;
  const hasUrl = !!String(extra.supplier_url || safeObject(extracted.supplier).url || '').trim();
  const hasExtraction = !!(extracted._meta || safeObject(p.extraction_meta).extracted_at);

  // --- 根拠付き事実（推定は昇格させない）---
  const confirmedFacts = safeArray(extracted.confirmed_facts);
  const evidenceFacts = safeArray(extracted.evidence)
    .filter(ev => ev && ev.source_image != null && String(ev.field || '').trim());
  const adoptableFacts = confirmedFacts.length ? confirmedFacts : evidenceFacts;

  // --- 採用状態 ---
  const adopted = !!String(p.adopted_candidate_id || '').trim();
  const ready = handoff.ready === true;
  const isAtlas = safeArray(p.tags).includes('ATLAS');
  const sourcingActivity = adopted
    || Object.keys(safeObject(p.sourcing_brief)).length > 0
    || candidates.length > 0
    || ['supplier_adopted', 'supplier_needs_confirmation'].includes(String(p.sourcing_state || ''));
  // ゲート対象: ATLAS案件、または仕入探索フローを実際に開始した案件（受け入れ条件9）
  const gateApplies = isAtlas || sourcingActivity;
  const gated = gateApplies && !ready;

  // --- ドラフト・仕上げ ---
  const hasDraft = !!(draft.concept || safeArray(draft.title_candidates).length);
  const reviewed = ['ページ案完成', '輸入判断OK'].includes(String(p.status || ''));

  // --- 不足項目の具体化 ---
  const missing = [];
  if (!hasUrl) missing.push('仕入先URL');
  if (!shotCount) missing.push('スクリーンショット');
  if (hasExtraction && !adoptableFacts.length) missing.push('根拠付きの確認済み仕様（1件以上）');

  // --- ステップ状態 ---
  const s2 = !hasUrl && !shotCount ? (hasExtraction ? 'attention' : 'pending')
           : (hasExtraction ? 'complete' : 'current');
  const s3 = !gateApplies ? 'complete'
           : ready ? 'complete'
           : (adopted ? 'attention' : (s2 === 'complete' ? 'current' : 'pending'));
  const s4 = hasDraft ? 'complete'
           : gated ? 'locked'
           : (s3 === 'complete' ? 'current' : 'pending');
  const s5 = reviewed ? 'complete' : (hasDraft ? 'current' : 'pending');

  const steps = [
    { id: 'research', label: '競合情報', state: 'complete',
      detail: p.source_card_id ? 'リサーチカード連携済み' : '手動作成' },
    { id: 'materials', label: '仕入先・素材', state: s2,
      detail: [hasUrl ? 'URL保存済み' : 'URL未保存',
               shotCount ? `スクショ${shotCount}枚` : 'スクショなし',
               hasExtraction ? '仕様抽出済み' : '未抽出'].join('・') },
    { id: 'supplier_confirmation', label: '仕入候補の確定', state: s3,
      detail: !gateApplies ? '（この案件では不要）'
            : ready ? `確認済み仕様 ${safeArray(handoff.confirmed_facts).length}件`
            : adopted ? '採用済み・確認済み仕様が0件'
            : '採用候補が未確定' },
    { id: 'draft', label: 'ページ案生成', state: s4,
      detail: hasDraft ? `生成済み（${draft.review_status || 'draft'}）` : gated ? 'ロック中' : '' },
    { id: 'review', label: '内容確認・仕上げ', state: s5, detail: '' }
  ];

  // --- 次にやること（優先順位つき・常に1つ）---
  let nextAction;
  if (reviewed)              nextAction = null;
  else if (hasDraft)         nextAction = { type: 'review_draft', label: '内容を確認して仕上げる',
                                            reason: 'タイトル・箇条書き・画像構成を確認してください。' };
  else if (!gated)           nextAction = { type: 'generate_draft', label: 'ページ案を生成',
                                            reason: '確認済み仕様だけを使って生成します。' };
  else if (adopted && !ready) nextAction = { type: 'confirm_facts', label: '確認済み仕様を追加',
                                            reason: `根拠付きの確認済み仕様が0件です。不足: ${missing.join('、') || '確認済み仕様'}` };
  else if (hasExtraction && adoptableFacts.length && hasUrl)
                             nextAction = { type: 'adopt_extracted_input',
                                            label: 'この解析結果を仕入候補として採用',
                                            reason: '解析済みですが、ページ制作へ渡す確認済み仕様がまだ確定していません。' };
  else if (hasExtraction && adoptableFacts.length && !hasUrl)
                             nextAction = { type: 'enter_supplier_url', label: '仕入先URLを入力して保存',
                                            reason: '解析は済んでいますが、仕入先URLが保存されていません。' };
  else if (hasExtraction)    nextAction = { type: 'confirm_facts', label: '根拠が写ったスクショを追加して再抽出',
                                            reason: '解析結果に根拠付きの事実がありません。' };
  else if (shotCount)        nextAction = { type: 'extract_inputs', label: 'スクショから必要事項を抽出',
                                            reason: 'Gemini解析がまだ実行されていません。' };
  else if (candidates.length) nextAction = { type: 'adopt_candidate', label: '候補カードの「この候補を採用」を押す',
                                            reason: '候補は保存済みですが未採用です。' };
  else                       nextAction = { type: 'add_screenshots', label: '仕入先URLとスクショを追加',
                                            reason: '仕入先の素材がまだありません。ラクマートで探す場合は「探す条件を作る」からでもOK。' };

  const currentStep = (steps.find(s => s.state === 'current' || s.state === 'attention') || steps[0]).id;
  return { currentStep, steps, nextAction, missing, gated,
           secretaryMessage: buildMaikaPageGuide_(p, { currentStep, nextAction, shotCount, adoptableFacts, extracted, handoff }) };
}
```

`buildMaikaPageGuide_()` は §5 のテンプレートを状態→文言のマップで実装した小関数（AI呼び出しなし）。状態名・文言はこの2関数以外のDOM操作へ分散させません。

---

## 7. 通常解析結果を安全に採用するAPI設計

### 7.1 仕様

- action: `adoptExtractedInputAsSupplier`
- 入力: `pageProjectId`（＋任意 `supplierUrl`。フロントの未保存URL欄をフォールバック送信）
- **サーバーはシートの正本行を読み**、クライアント送信の projectData は使わない
- 安全原則:
  - `confirmed_facts` があればそれを、無ければ **`source_image` 付き `evidence`** のみを確認済み事実として採用（`inferred` 系や `evidence_note` のみの項目は昇格させない）
  - `unknown_fields` はそのまま `unconfirmed_items` / `prohibited_claims` へ
  - 根拠付き事実0件なら `ready=false`・`sourcing_state='supplier_needs_confirmation'` として保存し、**不足項目をエラーではなくレスポンスで返す**（画面が次の指示を出せる）
  - URLが皆無なら採用前に具体的不足を throw
- `adopted_candidate_id` は `'extracted:' + project.id` 形式（ラクマート候補UUIDと衝突せず、既存入力採用であることが後から判別可能）
- ラクマート候補シートには**書き込まない**（brief必須制約を回避し、既存ボードの後方互換を維持。後からラクマート候補を採用すれば handoff は上書きされ、従来動作と同一）

### 7.2 実装（rakumart_sourcing.gs へ追加）

```js
/** 通常ルート（仕入先URL＋スクショ解析）の結果を、採用済み仕入候補として確定する。 */
function adoptExtractedInputAsSupplier_(pageProjectId, supplierUrlOverride) {
  const projects = getAllPageProjects();
  const project = projects.find(function(p){ return String(p.id) === String(pageProjectId); });
  if (!project) throw new Error('ページ案件が見つかりません。');

  const extracted = project.extracted_input && typeof project.extracted_input === 'object' ? project.extracted_input : {};
  if (!extracted._meta && !(project.extraction_meta && project.extraction_meta.extracted_at)) {
    throw new Error('採用できません。不足: スクショ解析結果（先に「スクショから必要事項を抽出」を実行してください）');
  }

  // URL解決: 保存済みextra_texts → 抽出結果 → フロントの未保存入力
  const extra = project.extra_texts || {};
  const url = String(extra.supplier_url || (extracted.supplier && extracted.supplier.url) || supplierUrlOverride || '').trim();
  if (!url) throw new Error('採用できません。不足: 仕入先URL（仕入先URL欄に入力して保存してください）');
  if (!/^https?:\/\//i.test(url)) throw new Error('仕入先URLはhttp(s)形式で入力してください。');

  // 根拠付き事実のみ採用（推定を昇格させない）
  const confirmed = Array.isArray(extracted.confirmed_facts) && extracted.confirmed_facts.length
    ? extracted.confirmed_facts
    : (Array.isArray(extracted.evidence) ? extracted.evidence : []).filter(function(ev){
        return ev && ev.source_image != null && String(ev.field || '').trim();
      }).map(function(ev){
        return { field: ev.field, value: ev.value, source_image: ev.source_image,
                 confidence: ev.confidence || 'medium', evidence_note: ev.evidence_note || '' };
      });
  const unknown = Array.isArray(extracted.unknown_fields) ? extracted.unknown_fields : [];

  const brief = project.sourcing_brief && typeof project.sourcing_brief === 'object' ? project.sourcing_brief : {};
  const candidateId = 'extracted:' + project.id;
  const supplier = extracted.supplier || {};

  const handoff = {
    ready: confirmed.length > 0,
    selected_candidate_id: candidateId,
    supplier: {
      url: url,
      title: supplier.title || '',
      unit_price_cny: supplier.unit_price_cny == null ? null : supplier.unit_price_cny,
      screenshot_ids: Array.isArray(project.extra_image_ids) ? project.extra_image_ids : []
    },
    market_insights: brief.market_insights || [],
    confirmed_facts: confirmed,
    unconfirmed_items: unknown,
    selected_variations: (supplier.dimensions && supplier.dimensions.specifications) || supplier.variations || [],
    claim_guard: {
      allowed_claims: confirmed,
      prohibited_claims: unknown,
      market_priorities: brief.must_have_conditions || []
    },
    candidate_decision_log: {
      origin: 'extracted_input',
      adopted_at: new Date().toISOString()
    }
  };

  // 既存adoptと同じ概算利益の自動計算（失敗しても継続）
  try {
    const roughSim = calculateRoughProfit_(project, supplier.unit_price_cny || null);
    if (roughSim) { project.cost_simulation = roughSim; project.profit = roughSim; }
  } catch (simErr) { Logger.log('AdoptExtracted: 利益シミュレーション失敗(継続): ' + simErr); }

  project.adopted_candidate_id = candidateId;
  project.supplier_selection = { candidate_id: candidateId, origin: 'extracted_input',
    supplier_url: url, screenshot_ids: project.extra_image_ids || [], extracted: extracted };
  project.listing_handoff = handoff;
  project.sourcing_state = handoff.ready ? 'supplier_adopted' : 'supplier_needs_confirmation';
  project.extra_texts = project.extra_texts || {};
  project.extra_texts.supplier_url = url;
  project.updated_at = new Date().toISOString();
  updatePageProjectInSheet(project);

  // 親ライフサイクルカードへの利益同期（既存adoptと同じ・失敗許容）
  const sourceCardId = String(project.source_card_id || '').trim();
  if (sourceCardId && project.cost_simulation) {
    try {
      const parentCard = getCardDetail_ProductLifecycle(sourceCardId);
      if (parentCard) {
        parentCard.cost_simulation = project.cost_simulation;
        parentCard.profit = project.profit;
        updateCardInLifecycle(parentCard);
      }
    } catch (syncErr) { Logger.log('AdoptExtracted: 親カード同期失敗(継続): ' + syncErr); }
  }
  return { project: project, ready: handoff.ready,
           missing: handoff.ready ? [] : ['根拠付きの確認済み仕様（1件以上）'] };
}
```

### 7.3 ルーティング追加とゲート堅牢化（コード.js doPost 内）

```js
if (action === 'adoptExtractedInputAsSupplier') {
  return jsonResponse({ status: 'ok',
    data: adoptExtractedInputAsSupplier_(body.pageProjectId, body.supplierUrl || '') });
}
```

`generatePageDraft` ルートは、ゲート関連フィールドをシート正本で上書きしてから検証します：

```js
if (action === 'generatePageDraft') {
  const projectData = body.projectData || {};
  // ゲート判定はシートの正本を信用する（クライアント送信値で解錠させない）
  const stored = getAllPageProjects().find(p => String(p.id) === String(projectData.id));
  if (stored) {
    projectData.sourcing_state = stored.sourcing_state;
    projectData.listing_handoff = stored.listing_handoff;
    projectData.adopted_candidate_id = stored.adopted_candidate_id;
    projectData.tags = stored.tags;
  }
  // ...以降は既存処理
}
```

`generatePageDraft_()` のゲート条件も §6 と同期させます（受け入れ条件9対応）：

```js
const isAtlasProject = Array.isArray(p.tags) && p.tags.indexOf('ATLAS') >= 0;
const sourcingActivity = !!String(p.adopted_candidate_id || '').trim()
  || Object.keys(p.sourcing_brief || {}).length > 0
  || ['supplier_adopted', 'supplier_needs_confirmation'].indexOf(String(p.sourcing_state || '')) >= 0;
if ((isAtlasProject || sourcingActivity) && !handoff.ready) {
  throw new Error('まだ生成できません。理由: 確認済み仕様（listing_handoff）が未確定です。'
    + '「この解析結果を仕入候補として採用」またはラクマート候補の採用を先に行ってください。');
}
```

> 補足: `needs_search_brief` を「即ロック」条件から外すことで、ATLAS以外の（仕入探索を使わない）案件の不要ロックが解消されます。ATLAS案件は引き続きタグ条件でロックされるため安全性は低下しません。

---

## 8. 変更対象ファイルと関数一覧

| ファイル | 変更 | 内容 |
|---|---|---|
| `rakumart_sourcing.gs` | 追加 | `adoptExtractedInputAsSupplier_()`（§7.2） |
| `コード.js` | 追加 | doPostルート `adoptExtractedInputAsSupplier`（§7.3） |
| `コード.js` | 変更 | `generatePageDraft` ルートで正本上書き / `generatePageDraft_()` のゲート条件とエラー文言（§7.3） |
| `コード.js` | 変更（任意） | `createPageProjectFromCard()`: 非ATLASカードは `sourcing_state: ''` で作成（新規分の整合。既存行は§10のロジック側吸収で対応） |
| `index_32_.html` | 追加 | CSS `.page-progress` `.page-next-action` `.maika-guide`（§9.1） |
| `index_32_.html` | 追加 | HTML: modal-body 先頭に進捗＋ガイド＋次アクションの3ブロック（§9.2） |
| `index_32_.html` | 追加 | JS: `derivePageProductionProgress()` / `buildMaikaPageGuide_()` / `renderPageProductionProgress()` / `adoptExtractedInput()`（§6, §9.3） |
| `index_32_.html` | 変更 | `openPageProjectModal()`・`extractPageInputs()`・`adoptRakumartCandidate()`・`savePageProject()` の末尾で `renderPageProductionProgress()` を呼ぶ（状態反映の一元化） |
| `index_32_.html` | 変更 | `generatePageDraftBtn` を disabled 廃止 → ロック時は説明パネルへスクロール（§9.3） |
| `index_32_.html` | 変更 | セクション並び替え＋ラクマート3セクションを `<details>` 化（§3.3） |
| `DESIGN.md` | 追記 | v1.2: ページ制作の進捗ステッパー規約＋「マイカ発話カード（コアトークン版）」を§4に追加（doc-first） |

---

## 9. 実装コード（フロント）

### 9.1 CSS（既存トークンのみ使用・新変数なし）

```css
/* ── ページ制作: 進捗ステッパー ── */
.page-progress { display:flex; gap:0; margin:4px 0 12px; }
.page-progress .pp-step { flex:1; min-width:0; text-align:center; position:relative; padding-top:4px; }
.page-progress .pp-step::before { /* 接続線 */
  content:''; position:absolute; top:15px; left:-50%; width:100%; height:2px;
  background:var(--border); z-index:0; }
.page-progress .pp-step:first-child::before { display:none; }
.page-progress .pp-dot {
  width:24px; height:24px; border-radius:50%; margin:0 auto; position:relative; z-index:1;
  display:flex; align-items:center; justify-content:center; font-size:12px;
  background:var(--surface2); border:1px solid var(--border); color:var(--muted); }
.page-progress .pp-label { font-size:10px; color:var(--muted); margin-top:4px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.page-progress .pp-detail { font-size:9px; color:var(--muted); display:none; }
.pp-step.is-complete .pp-dot { background:var(--go-bg); border-color:var(--go-bdr); color:var(--go); }
.pp-step.is-complete .pp-label { color:var(--muted2); }
.pp-step.is-current .pp-dot { background:var(--accent); border-color:var(--accent); color:#0c0c0e; font-weight:700;
  box-shadow:0 0 12px rgba(232,213,163,0.35); }
.pp-step.is-current .pp-label { color:var(--accent); font-weight:700; }
.pp-step.is-attention .pp-dot { background:var(--check-bg); border-color:var(--check-bdr); color:var(--check); }
.pp-step.is-attention .pp-label { color:var(--check); }
.pp-step.is-locked .pp-dot { color:var(--muted); }
@media (min-width:720px) { .page-progress .pp-detail { display:block; } .page-progress .pp-label { font-size:11px; } }

/* 現在ステップの詳細（モバイルで縦要約1枚） */
.page-progress-summary { background:var(--surface2); border:1px solid var(--border);
  border-radius:12px; padding:10px 12px; font-size:12px; color:var(--muted2); margin-bottom:10px; }
.page-progress-summary b { color:var(--text); }

/* ── マイカ・ガイド（コアトークン版。--sec-*不使用 = Accent Law遵守）── */
.maika-guide { background:var(--surface2); border:1px solid var(--border);
  border-left:3px solid var(--accent); padding:12px 14px; margin-bottom:10px;
  display:flex; gap:10px; align-items:flex-start; }
.maika-guide .mg-avatar { width:34px; height:34px; border-radius:50%; flex-shrink:0;
  border:2px solid var(--accent); overflow:hidden; background:var(--surface3); }
.maika-guide .mg-avatar img { width:100%; height:100%; object-fit:cover; }
.maika-guide .mg-name { font-size:11px; font-weight:700; color:var(--accent); margin-bottom:2px; }
.maika-guide .mg-body { font-size:13px; line-height:1.7; color:var(--text); white-space:pre-line; }

/* ── 次にやることパネル ── */
.page-next-action { background:var(--surface2); border:1px solid var(--accent);
  border-radius:12px; padding:14px; margin-bottom:14px; }
.page-next-action .pna-title { font-size:11px; font-weight:700; color:var(--accent);
  letter-spacing:0.08em; margin-bottom:6px; }
.page-next-action .pna-reason { font-size:12px; color:var(--muted2); margin-bottom:10px; line-height:1.6; }
.page-next-action.is-locked-info { border-color:var(--check-bdr); background:var(--check-bg); }
.page-next-action.flash { animation:pnaFlash 0.9s ease; }
@keyframes pnaFlash { 0%{box-shadow:0 0 0 3px rgba(232,213,163,0.5);} 100%{box-shadow:none;} }
```

> 単辺ボーダー（`.maika-guide` の border-left）には角丸を付けない（DESIGN.md アンチパターン準拠のため `border-radius` 未指定。全周境界併用に変える場合のみ12px可）。

### 9.2 HTML（modal-body 先頭へ挿入）

```html
<div id="page-progress-root"></div>
<div id="maika-page-guide"></div>
<div id="page-next-action-root"></div>
```

および 4️⃣ページ制作セクションのゲート表示を差し替え：

```html
<div class="section section-ai">
  <div class="section-title">④ ページ制作</div>
  <button class="btn" id="generatePageDraftBtn">ページ案を生成</button>
  <div id="page-generation-gate" class="page-next-action is-locked-info" style="display:none;"></div>
</div>
```

### 9.3 描画・イベント（一元化）

```js
let currentPageProgress = null;

function renderPageProductionProgress() {
  if (!currentEditingPageProject) return;
  const prog = derivePageProductionProgress(currentEditingPageProject, currentRakumartBoard);
  currentPageProgress = prog;

  // ステッパー
  $('page-progress-root').innerHTML =
    `<div class="page-progress">` + prog.steps.map((s,i) => `
      <div class="pp-step is-${s.state}">
        <div class="pp-dot">${s.state==='complete'?'✓':s.state==='locked'?'🔒':s.state==='attention'?'⚠':(i+1)}</div>
        <div class="pp-label">${escapeHtml(s.label)}</div>
        <div class="pp-detail">${escapeHtml(s.detail||'')}</div>
      </div>`).join('') + `</div>` +
    `<div class="page-progress-summary"><b>${escapeHtml(prog.steps.find(s=>s.id===prog.currentStep).label)}</b>：`
      + escapeHtml(prog.steps.find(s=>s.id===prog.currentStep).detail || '進行中') + `</div>`;

  // マイカ・ガイド（AI呼び出しなし）
  $('maika-page-guide').innerHTML = `
    <div class="maika-guide">
      <div class="mg-avatar"><img src="${MAIKA_AVATAR_SRC}" alt=""></div>
      <div><div class="mg-name">マイカ</div>
      <div class="mg-body">${escapeHtml(prog.secretaryMessage)}</div></div>
    </div>`;

  // 次にやること（primaryはここだけ）
  const na = prog.nextAction;
  $('page-next-action-root').innerHTML = !na ? '' : `
    <div class="page-next-action" id="pna-panel">
      <div class="pna-title">次にやること</div>
      <div class="pna-reason">${escapeHtml(na.reason)}</div>
      <button class="btn btn-primary" onclick="runPageNextAction()">${escapeHtml(na.label)}</button>
    </div>`;

  // 生成ボタン: disabledにせず、ロック時は説明へ誘導
  const genBtn = $('generatePageDraftBtn');
  const gate = $('page-generation-gate');
  if (prog.gated) {
    genBtn.classList.remove('btn-primary');
    gate.style.display = 'block';
    gate.innerHTML = `<div class="pna-title">🔒 まだ生成できません</div>
      <div class="pna-reason">理由: ${escapeHtml(na ? na.reason : '確認済み仕様が未確定です。')}<br>
      これで解放: <b>${escapeHtml(na ? na.label : 'ラクマート候補の採用')}</b><br>
      ※ 完了済みのスクショ解析をやり直す必要はありません。</div>`;
  } else {
    genBtn.classList.toggle('btn-primary', na && na.type === 'generate_draft');
    gate.style.display = 'none';
  }
}

function runPageNextAction() {
  const na = currentPageProgress && currentPageProgress.nextAction;
  if (!na) return;
  const map = {
    adopt_extracted_input: adoptExtractedInput,
    generate_draft: generatePageDraft,
    extract_inputs: extractPageInputs,
    enter_supplier_url: () => { $('page-supplier-url').focus();
      $('page-supplier-url').scrollIntoView({behavior:'smooth', block:'center'}); },
    add_screenshots: () => $('page-extra-images').scrollIntoView({behavior:'smooth', block:'center'}),
    adopt_candidate: () => $('rakumart-candidate-list').scrollIntoView({behavior:'smooth', block:'center'}),
    confirm_facts: () => $('page-extra-images').scrollIntoView({behavior:'smooth', block:'center'}),
    review_draft: () => $('page-concept').scrollIntoView({behavior:'smooth', block:'center'})
  };
  (map[na.type] || (()=>{}))();
}

async function adoptExtractedInput() {
  if (!currentEditingPageProject) return;
  if (!confirm('解析結果の根拠付き仕様だけをページ制作へ渡します。よろしいですか？')) return;
  showLoading('解析結果を採用候補として確定中...', '確認済み仕様と未確認項目を分離しています。');
  try {
    const json = await apiPost({ action:'adoptExtractedInputAsSupplier',
      pageProjectId: currentEditingPageProject.id,
      supplierUrl: $('page-supplier-url').value.trim() });
    currentEditingPageProject = json.data.project;
    const idx = allPageProjects.findIndex(p => p.id === currentEditingPageProject.id);
    if (idx >= 0) allPageProjects[idx] = JSON.parse(JSON.stringify(currentEditingPageProject));
    $('page-supplier-url').value = safeObject(currentEditingPageProject.extra_texts).supplier_url || '';
    renderPageProductionProgress();  // 開き直し不要で進捗・ボタンが更新される
    showToast(json.data.ready
      ? '採用完了！ページ案生成が解放されました。'
      : '採用しましたが確認済み仕様が0件です。根拠が写ったスクショを追加してください。');
  } catch (e) { alert('採用に失敗しました。\n' + e.message); }
  finally { hideLoading(); }
}

// ロック中でも生成ボタンを無反応にしない
function generatePageDraft() {
  if (currentPageProgress && currentPageProgress.gated) {
    const gate = $('page-generation-gate');
    gate.scrollIntoView({ behavior:'smooth', block:'center' });
    gate.classList.remove('flash'); void gate.offsetWidth; gate.classList.add('flash');
    return;
  }
  /* ...既存の生成処理... */
}
```

既存関数へのフック（各1行追加）：

- `openPageProjectModal()` 末尾: `renderPageProductionProgress()`
- `loadRakumartBoard()` 成功時: `renderPageProductionProgress()`（board情報が進捗に影響するため）
- `extractPageInputs()` 成功時 / `adoptRakumartCandidate()` 成功時 / `savePageProject()` 成功時: 同上

---

## 10. 後方互換方針

- **既存のラクマート候補ルートは無変更で存続。** `adoptRakumartCandidate_()` は従来どおり handoff を生成し、`adoptExtractedInputAsSupplier_` 採用後にラクマート候補を採用し直せば handoff は上書きされる（最後の採用が勝つ、現行と同じ挙動）。
- **既存行データ:** `sourcing_state='needs_search_brief'` のまま止まっている非ATLAS案件は、新ゲート条件（ATLASタグ or 仕入探索の実活動）により自動的にロック解除される。ATLAS案件は従来どおりロックされ、新設の1クリック採用で解放する。マイグレーションスクリプトは不要。
- **`adopted_candidate_id` の名前空間:** `extracted:` プレフィックスによりラクマート候補UUIDと判別可能。`renderRakumartBoard()` は candidate シートを見るだけなので影響なし。
- **`listing_handoff` スキーマ:** `adoptRakumartCandidate_` と同一キー構成（`candidate_decision_log.origin` を追加するのみ）。`generatePageDraft_()`・相談ブリーフMarkdown出力は無修正で動作。
- **`createPageProjectFromCard()` の変更は新規行のみに影響。** 既存行は読み取り側ロジックで吸収。

---

## 11. テストケース

### A. ゲート解放（今回の事例の再現）

1. 添付の `page_projects` 行（B08FD57ZH8）を復元 → モーダルを開く
   - 期待: ステッパー ①完了 ②完了(スクショ6枚・仕様抽出済み) ③現在地 ④🔒 ⑤未着手 / nextAction=`adopt_extracted_input`
2. 「この解析結果を仕入候補として採用」を押す（URLは `page-supplier-url` に入力済みの状態）
   - 期待: `confirmed_facts` に evidence 5件（material/dimensions/claims×3、全て source_image 付き）が昇格、`ready=true`、`sourcing_state='supplier_adopted'`、`adopted_candidate_id='extracted:f4599ea1-...'`
   - 期待: **開き直しなしで** ③完了・④現在地に更新、生成ボタンがprimary化（受け入れ条件5）
3. 同状態で「ページ案を生成」→ サーバー例外なく生成される（受け入れ条件6）

### B. 不足項目の具体表示

4. URLを空にして採用 → エラー文言に「不足: 仕入先URL」が含まれ、nextAction=`enter_supplier_url`（受け入れ条件7）
5. `evidence` を空・`confirmed_facts` を空にして採用 → `ready=false`・`sourcing_state='supplier_needs_confirmation'`、トーストとステッパー③が⚠、nextAction=`confirm_facts`、④は🔒のまま
6. `inferred_facts` のみ存在する抽出結果で採用 → confirmed_facts に**昇格しない**こと（安全原則）

### C. ロックの説明可能性

7. ロック状態で「ページ案を生成」を押す → 無反応にならず、説明パネルへスクロール＋フラッシュ（受け入れ条件12の前段）
8. フロントで `listing_handoff.ready=true` を注入して generatePageDraft を送信 → サーバーがシート正本で上書きし、例外を返す（受け入れ条件12）

### D. 後方互換

9. 既存フロー: 指示書生成 → 候補保存 → 採用 → 生成、が従来どおり完走（受け入れ条件8）
10. 解析採用済みの案件でラクマート候補を後から採用 → handoff がラクマート候補で上書きされ生成可能
11. 非ATLAS・仕入探索未使用の既存案件（`sourcing_state='needs_search_brief'`）→ ④がロックされない（受け入れ条件9）

### E. 表示・通信

12. モーダル表示時のネットワークログに追加のAPI/Gemini呼び出しがない（既存の `getRakumartSourcingBoard` / `getActivePageSkillPack` のみ。受け入れ条件10）
13. 380px幅で ステッパー・マイカ・次アクションが横スクロールなしで読める（受け入れ条件11）
14. フロント `derivePageProductionProgress().gated` とサーバー `generatePageDraft_()` の判定が、A/B/Dの全ケースで一致する

---

## 12. 実装順序の提案

1. **サーバー先行**（安全側から）: `adoptExtractedInputAsSupplier_` ＋ ルート追加 ＋ ゲート条件修正 → テストB/C-8/D
2. **フロント状態関数**: `derivePageProductionProgress` ＋ `renderPageProductionProgress` → テストA-1/E
3. **UI組み込み**: ステッパー/マイカ/次アクションのHTML・CSS、セクション並び替え、`<details>`化
4. **DESIGN.md v1.2 追記**（doc-first。実装前にコミット）: 進捗ステッパー規約＋マイカ発話カード（コアトークン版）

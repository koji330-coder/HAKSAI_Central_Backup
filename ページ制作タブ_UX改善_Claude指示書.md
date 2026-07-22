# HAKSAI Central「ページ制作」UX改善 指示書

## 1. 依頼の目的

HAKSAI Central の「ページ制作」タブについて、ユーザーが現在地・完了済みの作業・次に行う操作を迷わず理解できる画面へ改善してください。

現状は、仕入先URLの入力、スクリーンショット保存、仕様抽出まで上から順に操作しても、「ページ案を生成」ボタンが解放されない場合があります。内部的には別系統の「ラクマート候補採用」が必要ですが、その関係が画面から理解できません。

既存のページデザイン、配色、余白、カード表現、マイカ（秘書）のキャラクター性に合わせて設計してください。単なる装飾ではなく、操作経路の統合・現在地の可視化・ロック理由の具体化を重視してください。

## 2. 対象画面

- HAKSAI Central の「ページ制作」タブ
- ページ制作案件の詳細モーダル `pageDetailModal`
- 特に以下の領域
  - 基本情報・競合情報
  - 仕入先URL、追加スクリーンショット、スクリーンショット解析
  - ラクマート検索指示書
  - ラクマート仕入候補の登録・比較・採用
  - ページ案生成

## 3. 現在の処理構造

### 3.1 上部の通常素材入力ルート

ユーザーはページ制作案件で以下を操作できます。

1. 仕入先URLを入力
2. スクリーンショットを追加
3. `extractPageInputs` を実行
4. Geminiがスクリーンショットから仕様を抽出

このルートで更新される主な項目は以下です。

```text
extra_texts.supplier_url
extra_image_ids
extracted_input
extraction_meta
status = 素材追加中
```

しかし、このルートではページ生成ゲートに必要な以下の項目は作られません。

```text
adopted_candidate_id
supplier_selection
listing_handoff.ready
sourcing_state = supplier_adopted
```

### 3.2 ラクマート候補ルート

ページ案生成を正式に解放する現在の経路は以下です。

1. ラクマート検索指示書を生成
2. ラクマート候補URLとスクリーンショットを登録
3. 必要に応じて候補を比較
4. 候補カードの「この候補を採用」を押す
5. `confirmed_facts` が1件以上あれば `listing_handoff.ready = true`

採用処理では以下が設定されます。

```text
adopted_candidate_id
supplier_selection
sourcing_brief
sourcing_comparison
listing_handoff
sourcing_state = supplier_adopted | supplier_needs_confirmation
extra_texts.supplier_url
extracted_input
```

### 3.3 現在のボタンロック判定

フロント側では概ね次の条件で「ページ案を生成」を無効化しています。

```js
const handoff = safeObject(p.listing_handoff);
const gated =
  (safeArray(p.tags).includes('ATLAS') && !handoff.ready) ||
  (!!p.sourcing_state && !handoff.ready);
```

サーバー側でも `generatePageDraft_()` が同様に検証しています。

```js
if (
  (isAtlasProject && !handoff.ready) ||
  String(p.sourcing_state || '') === 'needs_search_brief' ||
  (p.sourcing_state && !handoff.ready)
) {
  throw new Error('先にラクマート候補を採用し、確認済み仕様を確定してください。');
}
```

フロントだけでロックを外す設計にはしないでください。生成に利用できる確認済み仕様を `listing_handoff` として正しく作る必要があります。

## 4. 実際に発生した事例

対象ページ案件：

```text
page_project_id: f4599ea1-c4a4-4791-9f34-fd7ea06cacac
source_card_id: atlas_B08FD57ZH8_20260625104324
ASIN: B08FD57ZH8
商品: BETTERSTORE 27cmピンセット2本セット
```

ユーザーが完了したと認識している作業：

- 仕入先URL入力
- スクリーンショット6枚の保存
- スクリーンショット解析
- 素材・サイズ・訴求内容の抽出
- 仕入先確定に相当する操作

実際に保存されていた情報：

```text
status: 素材追加中
extra_image_ids: 6件
extracted_input: あり
素材: ステンレス鋼
サイズ: 20cm / 25cm / 30cm
その他確認情報: 歯付き先端、防磁・耐腐食性など
```

一方、ゲート用データは以下でした。

```text
sourcing_state: needs_search_brief
adopted_candidate_id: 空
sourcing_brief: {}
supplier_selection: {}
listing_handoff: {}
```

したがって、ユーザーから見ると仕入先情報が揃っているのに、「ページ案を生成」がロックされたままになりました。

## 5. 現状のUX上の課題

### 5.1 見た目が似た入力経路が二重化している

- 通常の「仕入先URL＋スクショ解析」
- 「ラクマート候補URL＋候補スクショ＋採用」

ユーザーには両者の目的の違いが分かりません。同じURLとスクリーンショットを再入力させる可能性があります。

### 5.2 上から順に操作しても完了しない

画面の視覚的な順序と、内部で必要な状態遷移が一致していません。

### 5.3 現在地が分からない

何が完了し、何が未完了で、どの操作がページ案生成を解放するのか一覧表示がありません。

### 5.4 ロック理由が抽象的

現在の案内は次の一文だけです。

```text
先にラクマート候補を採用し、確認済み仕様を確定してください。
```

対象セクション、押すボタン、足りないデータが示されません。

### 5.5 「解析済み」と「採用済み」の違いが伝わらない

スクリーンショットから仕様が抽出されると、ユーザーは仕入先確定まで完了したと自然に認識します。しかし内部的には採用処理が別に必要です。

### 5.6 状態更新後のフィードバックが弱い

採用、保存、仕様確認などを行った後、進捗や次の操作が画面上で明確に変化する必要があります。

## 6. 求める改善

### 6.1 進行ステップをページ上部へ表示

例：

```text
① 競合情報          完了
② 仕入先・素材      完了（スクショ6枚・仕様抽出済み）
③ 仕入候補の確定    未完了
④ ページ案生成      ロック中
⑤ 内容確認・仕上げ  未着手
```

要件：

- 完了・作業中・要確認・ロック中を視覚的に区別する
- 現在のステップを最も目立たせる
- モバイルでも横スクロールを強制しない
- 既存データから計算し、進捗表示のためだけのAPI通信は増やさない
- 状態判定を一つの関数へまとめる

### 6.2 「次にやること」を一つに絞って表示

例：

```text
次にやること
解析済みの仕入先情報を採用候補として確定してください。
[この解析結果を仕入候補として採用]
```

ユーザーに複数の同格ボタンを見せず、現在の状態に応じた主操作を1つ示してください。

### 6.3 通常解析結果をラクマート候補へ引き継ぐ

次のような操作を追加してください。

```text
[現在のURL・スクショ解析結果を仕入候補として採用]
```

この操作では既存の以下を再利用します。

```text
extra_texts.supplier_url
extra_image_ids
extracted_input
extraction_meta
```

そして、安全に以下を作成します。

```text
supplier_selection
listing_handoff
adopted_candidate_id または既存入力採用を表す明確なID
sourcing_state
```

重要事項：

- 推定情報を確認済み情報へ昇格させない
- `confirmed_facts` または根拠付き `evidence` のみを生成用事実にする
- `unknown_fields` は未確認のまま保持する
- URLまたは確認済み仕様が不足する場合は、採用前に具体的な不足項目を示す
- 既存のラクマート候補管理ルートも壊さない

### 6.4 ページ制作専用の秘書ガイドを表示

マイカのコメント領域を追加してください。

例：

```text
👱‍♀️ マイカ

スクショ6枚の解析は終わってるよ✨
20cm・25cm・30cmとステンレス素材まで確認できてる！

ただ、解析結果がまだ採用候補になってないから、
次は「この解析結果を採用」を押してね。
```

要件：

- 通常表示はフロント側で既存データから即時生成する
- 画面を開くたびにGeminiを呼ばない
- 商品名、画像枚数、確認済み仕様、未確認項目、利益状態、現在ステップを差し込む
- 必要なら別途「マイカに相談」ボタンを設け、そのときだけAIを呼ぶ設計にする
- キャラクター性は保つが、次の操作を最優先で明確にする

### 6.5 ロック中ボタンを説明可能にする

無効ボタンだけを置かないでください。ロック中には次を表示してください。

- なぜ押せないか
- 何が不足しているか
- どのボタンを押せばよいか
- 完了済みの作業をやり直す必要があるか

可能であれば、ロックされた「ページ案を生成」を押した際にも同じ説明パネルへスクロールまたはフォーカスしてください。完全な無反応にしないでください。

## 7. 秘書コメント・進捗判定に利用できる既存データ

```text
project.status
project.tags
project.source_card_id
project.extra_texts.supplier_url
project.extra_image_ids
project.extracted_input
project.extraction_meta
project.sourcing_state
project.adopted_candidate_id
project.sourcing_brief
project.supplier_selection
project.listing_handoff.ready
project.listing_handoff.confirmed_facts
project.listing_handoff.unconfirmed_items
project.cost_simulation
project.page_draft.concept
project.page_draft.title_candidates
project.page_draft.bullets
project.page_draft.image_plan
```

## 8. 実装上の制約

- 既存のデザインシステムとCSS変数を利用する
- ページ表示時の新規Gemini呼び出しは禁止
- 進捗表示のためだけの新規API呼び出しは禁止
- 大きな生成元別テンプレート分岐は避ける
- 状態から表示文言を決める軽量な関数を利用する
- フロント側だけで生成ゲートを解除しない
- サーバー側の安全検証は維持する
- 未確認の仕入先仕様をAmazonページ原稿へ混入させない
- `listing_handoff.confirmed_facts` と `claim_guard.allowed_claims` を生成時の正本として維持する
- 既存のラクマート候補登録・比較・採用を後方互換で残す
- PCとスマートフォンの両方で操作できること

## 9. 推奨する状態判定モデル

表示用に次のような純粋関数を設計してください。

```js
derivePageProductionProgress(project, rakumartBoard)
```

返却例：

```js
{
  currentStep: 'supplier_confirmation',
  steps: [
    { id:'research', label:'競合情報', state:'complete' },
    { id:'materials', label:'仕入先・素材', state:'complete', detail:'スクショ6枚・仕様抽出済み' },
    { id:'supplier_confirmation', label:'仕入候補の確定', state:'current' },
    { id:'draft', label:'ページ案生成', state:'locked' },
    { id:'review', label:'内容確認・仕上げ', state:'pending' }
  ],
  nextAction: {
    type: 'adopt_extracted_input',
    label: 'この解析結果を仕入候補として採用',
    reason: '解析済みですが、ページ制作へ渡す確認済み仕様がまだ確定していません。'
  },
  missing: [],
  secretaryMessage: '...'
}
```

状態名と表示文言をDOM操作の各所へ分散させないでください。

## 10. 受け入れ条件

1. ページ制作案件を開いた瞬間に現在地が分かる
2. 次に行う主操作が1つ明示される
3. URLとスクリーンショットの不必要な再入力が発生しない
4. 通常の解析結果から安全に仕入候補を採用できる
5. 採用完了後、画面を開き直さなくても進捗とボタン状態が更新される
6. `listing_handoff.ready = true` になった場合のみページ案生成が解放される
7. 確認済み仕様がない場合は、具体的な不足理由を表示する
8. 既存のラクマート候補登録・比較・採用も引き続き利用できる
9. ATLAS以外のページ案件も不必要にロックされない
10. ページ表示時の追加AI通信・追加API通信がない
11. モバイル表示で進捗、次の操作、秘書コメントが読みやすい
12. サーバー側の生成安全ゲートを回避しない

## 11. Claudeへ渡す現状コード

### 必須ファイル

#### 1. `_github_HAKSAI-Central/index.html`

フロント画面、ページ制作モーダル、ボタン制御、ラクマート候補UIがすべて含まれます。

特に確認する関数・要素：

```text
pageDetailModal
openPageProjectModal()
applyPageInputsToCurrentProject()
savePageProject()
loadRakumartBoard()
renderRakumartBoard()
generateRakumartBrief()
saveRakumartCandidate()
compareRakumartCandidates()
adoptRakumartCandidate()
extractPageInputs()
generatePageDraft()
generatePageDraftBtn
page-generation-gate
```

#### 2. `コア/コード.js`

APIルーティング、`page_projects` スキーマ、ページ案件の作成・更新、スクショ解析、ページ案生成、安全ゲートが含まれます。

特に確認する箇所：

```text
REQUIRED_HEADERS_PAGE
JSON_COLS_PAGE
OBJECT_JSON_COLS_PAGE
doPost()
createPageProjectFromCard()
updatePageProjectInSheet()
extractPageInputs または対応するAPI処理
generatePageDraft_()
```

#### 3. `rakumart_sourcing.gs`

検索指示書、候補保存、比較、採用、`listing_handoff` 生成の正本です。

特に確認する関数：

```text
generateRakumartSearchBrief_()
getRakumartSourcingBoard_()
addRakumartCandidate_()
compareRakumartCandidates_()
adoptRakumartCandidate_()
```

### デザイン整合のために渡すファイル

#### 4. `DESIGN.md`

HAKSAI Centralの視覚言語の正本です。色、余白、コンポーネント、情報階層を合わせるために必ず参照してください。

### 秘書の人格・既存UIとの整合に必要なファイル

#### 5. `分析/秘書.js`

秘書の設定、イベント、カード生成、既存の業務ガイドの考え方を確認するために渡してください。

#### 6. `分析/秘書機能メモ.md`

秘書機能の設計意図と既存ルートを理解する参考資料です。

### 商品固有データで再現確認する場合

#### 7. 今回の `page_projects` 行データ

添付済みの以下のテキストを再現データとして渡してください。

```text
f4599ea1-c4a4-4791-9f34-fd7ea06cacac ... pasted-text.txt
```

個人情報・APIキー・スプレッドシートIDなどが含まれていないことを確認してから共有してください。

### 原則として不要なファイル

今回のUX改善だけであれば、以下は渡す必要がありません。

```text
原価_在庫/*
商品登録/*
折りコン/*
AIレビュー/*
Keepaリサーチ/*
デバッグ_保守/*
```

ただし、利益シミュレーションの詳細表示まで変更する場合のみ `原価_在庫/概算利益計算.js` を追加してください。

## 12. Claudeへの成果物依頼

以下を提出してください。

1. 現状の情報設計上の問題点
2. 改善後のユーザーフロー
3. PC・モバイル双方のワイヤーフレーム
4. 状態別の表示一覧
5. マイカのコメント例
6. `derivePageProductionProgress()` の設計
7. 通常解析結果を安全に採用するAPI設計
8. 変更対象ファイルと関数一覧
9. 実装コード
10. 既存データ・既存ラクマート候補との後方互換方針
11. テストケース

デザイン案だけで終わらせず、既存コードへ適用できる具体的な変更案まで作成してください。

# Deployment Guide

HAKSAI-Landed-Cost を新規GAS Webアプリとしてデプロイする手順。

## 1. GASプロジェクトを作成

1. Google Driveで管理起点フォルダを開く
   - `1m_0CzRoXee5B_8OR-mRqQ_MqyuiLzS60`
2. 新規 Apps Script プロジェクトを作成する
3. プロジェクト名を `HAKSAI-Landed-Cost` にする
4. このリポジトリのファイルを配置する
   - `Code.js`
   - `Index.html`
   - `appsscript.json`

補足:

- GASエディタの「ファイルを追加」から作れるのは通常 `.gs` と `.html` だけ。
- `appsscript.json` は新規作成するファイルではなく、マニフェストを表示して編集する。
- 左メニューの「プロジェクトの設定」を開き、「appsscript.json マニフェスト ファイルをエディタで表示する」をONにする。
- エディタ左側に表示された `appsscript.json` を開き、このリポジトリの `appsscript.json` の内容で置き換える。

## 2. Advanced Google Services

GASエディタで Drive API を有効化する。

1. 左メニューの「サービス」を開く
2. Drive API を追加する
3. Google Cloud側の Drive API も有効になっていることを確認する

未有効の場合、Excel変換時に `Drive is not defined` で失敗する。

## 3. スクリプトプロパティ

GASプロジェクト設定で以下を登録する。

必須:

| Key | Value |
|---|---|
| `LC_ROOT_FOLDER_ID` | `1m_0CzRoXee5B_8OR-mRqQ_MqyuiLzS60` |
| `HAKSAI_SS_ID` | CENTRALメインスプレッドシートID |
| `GEMINI_API_KEY` | Gemini APIキー |
| `ALERT_MAIL_TO` | 支払アラート送信先メールアドレス |

任意:

| Key | Value |
|---|---|
| `GEMINI_MODEL` | 未設定なら `gemini-3.1-flash-lite` |

`setupAll()` 実行後に自動保存される:

| Key | 内容 |
|---|---|
| `LC_TOOL_SS_ID` | 専用台帳スプレッドシートID |
| `LC_FOLDER_EXCEL` | Excel入庫フォルダID |
| `LC_FOLDER_EXCEL_DONE` | Excel処理済みフォルダID |
| `LC_FOLDER_INBOX` | 請求書インボックスID |
| `LC_FOLDER_ARCHIVE` | 請求書アーカイブID |

## 4. setupAll

GASエディタから `setupAll()` を実行する。

確認すること:

- 管理起点フォルダ配下に専用スプレッドシートが作成される
- 以下のシートが作成される
  - `import_invoices`
  - `invoice_ledger`
  - `商品別`
  - `処理済み`
- 以下のDriveフォルダが作成される
  - `01_ラクマートEXCEL入庫`
  - `01_ラクマートEXCEL入庫/処理済み`
  - `02_請求書インボックス`
  - `02_請求書インボックス/アーカイブ`
- 再実行してもシートやフォルダが増えない

## 5. Webアプリデプロイ

1. GASエディタで「デプロイ」→「新しいデプロイ」
2. 種類: Webアプリ
3. 実行ユーザー: 自分
4. アクセスできるユーザー: 自分のみ
5. デプロイURLを控える

## 6. CENTRAL側設定

CENTRAL側GASのスクリプトプロパティに、WebアプリURLを登録する。

| Key | Value |
|---|---|
| `LANDED_COST_WEBAPP_URL` | HAKSAI-Landed-Cost のWebアプリURL |

設定後、CENTRALの発注管理タブ上部に「着地原価ツールを開く」リンクが表示される。

## 7. 初回検証

### D-1: アップロード

1. Webアプリを開く
2. `P2026060917233625-302343.xlsx` を投入する
3. `RW6000052781 - 請求書 - JBX1TW46919.pdf` を投入する
4. 正しいフォルダに保存されることを確認する
5. 同じファイルを再投入し、`DUP_SKIP` になることを確認する

### B-1: 請求書取込

1. `インボックス取込` を実行する
2. `invoice_ledger` に行が追加されることを確認する
3. Gemini抽出結果を確認する
4. 問題なければ `confirmed` をTRUEにする

### B-2: 確認済み整理

1. `確認済みを整理` を実行する
2. 請求書が `アーカイブ/{YYYY}/{MM}` に移動することを確認する
3. 関税請求書の場合、`import_invoices` に `rw_no` と金額が入ることを確認する

### A-1: Excel計算

1. `Excel計算実行` を実行する
2. `商品別` に明細が追加されることを確認する
3. `処理済み` にログが追加されることを確認する
4. 総仕入額が旧ツール結果と一致することを確認する

検証値:

- `P2026060917233625-302343.xlsx`
  - RW番号: `RW6000052781`
  - レート: `24.6`
  - 請求書金額: `31,300`
  - 総仕入額: `251,004`
  - 旧ツールの仕入合計との差: `-2円`

- `P2026060111490338-302343.xlsx`
  - RW番号: `RW6000052304`
  - レート: `24.55`
  - 請求書金額: `16,300`
  - 総仕入額: `151,963`
  - 旧ツールの仕入合計との差: `0円`

### A-2: CENTRAL同期

1. `CENTRAL同期 dry-run` を実行する
2. `readyToSync`、`skipped`、`unresolvedSamples` を確認する
3. 問題がなければ `CENTRALへ本同期` を実行する
4. CENTRALの `reorder_history` に行が追加されることを確認する
5. `product_lifecycle.current_landed_cost` が更新されることを確認する

### C: 支払監視

1. `invoice_ledger` に期限=明日の未払テスト行を用意する
2. `支払期限を確認` を実行する
3. `ALERT_MAIL_TO` にメールが届くことを確認する
4. 該当なしの日はメールが送信されないことを確認する

## 8. トリガー

支払監視を毎朝8時に実行する場合:

1. GASエディタから `setupPaymentDueTrigger()` を実行する
2. トリガー一覧に `checkPaymentDueTrigger` があることを確認する

## 9. 運用メモ

- `fba_arrival_date` は初期値として請求書日付が入る
- 実際のFBA納品日が分かったら、`import_invoices.fba_arrival_date` を手修正する
- 修正後にCENTRAL同期することで、売上タブの原価逆引き精度が上がる
- 過去データも同期対象にするため、dry-runで重複候補を必ず確認する

# HAKSAI-Landed-Cost

HAKSAI Central と連携する、着地原価計算・請求書管理専用のGAS Webアプリ。

CENTRAL本体には請求書台帳やDrive整理ロジックを混ぜず、このアプリで計算・確認・整理した結果だけを
CENTRALの `reorder_history` と `product_lifecycle.current_landed_cost` へ同期する。

## 実装済み

### Phase 0

- 専用スプレッドシートの作成または再利用
- 4シートの作成とヘッダー保証
  - `import_invoices`
  - `invoice_ledger`
  - `商品別`
  - `処理済み`
- Driveサブフォルダの冪等作成
  - `01_ラクマートEXCEL入庫`
  - `01_ラクマートEXCEL入庫/処理済み`
  - `02_請求書インボックス`
  - `02_請求書インボックス/アーカイブ`
- スクリプトプロパティへのID保存

### Phase D-1

- Webアプリ画面
- ドラッグ&ドロップ/タップ選択でのファイル投入
- 拡張子による保存先振り分け
  - `.xlsx` / `.xls` -> Excel入庫
  - `.pdf` / `.jpg` / `.jpeg` / `.png` -> 請求書インボックス
- 20MB超過ファイルの拒否
- 同名同サイズファイルの `DUP_SKIP`
- 同名別サイズファイルのタイムスタンプリネーム保存

### Phase A-1

- 旧 `processImportCost` のcore化
- Excel入庫フォルダから最古のExcelを1件処理
- Drive APIでGoogleスプレッドシートへ一時変換
- 配送依頼書番号、RW番号、レート、経費項目、明細行を抽出
- `import_invoices` に請求書金額がなければ `NEED_INPUT` を返す
- 請求書金額と請求書日付を受け取って再実行可能
- 商品代金比率で着地原価を案分
- `商品別` と `処理済み` に記録
- 処理済みExcelと一時変換シートを `処理済み` フォルダへ移動

### Phase B-1/B-2

- 請求書インボックス直下のPDF/JPG/PNGを `invoice_ledger` へ取り込み
- Geminiで issuer / invoice_no / issue_date / due_date / amount / doc_type / rw_no を抽出
- Gemini失敗時は処理を止めず、manual行として台帳に登録
- 既存 `drive_file_id` は重複スキップ
- `confirmed=TRUE` の請求書を `アーカイブ/{YYYY}/{MM}` へ移動
- `日付_発行者_金額` 形式へリネーム
- doc_typeが `関税` かつ rw_no がある行は `import_invoices` へ橋渡し
- Webアプリの「インボックス取込」「確認済みを整理」ボタンを有効化

### Phase A-2

- `商品別` の未同期行からCENTRAL同期予定を作成
- `import_invoices` を配送依頼書番号で参照し、到着日とレートを取得
- FNSKU/ASINから `sku_master` と `product_lifecycle` を使って `product_id` を解決
- `reorder_history.notes = 依頼書:{p_no}` で重複候補を検出
- Webアプリの「CENTRAL同期 dry-run」ボタンを有効化
- dry-run結果に同期予定件数、スキップ内訳、未解決SKUサンプル、仮日付件数を表示
- 本同期関数も用意。ただしWeb画面からはまだdry-runのみ実行可能

### Phase C

- `invoice_ledger` の `payment_status=未払` を対象に支払期限を確認
- 期限超過と3日以内の期限間近を分類
- 該当がある場合だけ `ALERT_MAIL_TO` へGmail送信
- 期限未設定の未払はメール末尾に要確認として表示
- 日次8時の支払監視トリガーを設定可能
- Webアプリの「支払期限を確認」ボタンを有効化

## 管理起点フォルダ

`1m_0CzRoXee5B_8OR-mRqQ_MqyuiLzS60`

`setupAll()` はこのフォルダ配下に必要なスプレッドシートとサブフォルダを作る。

## 次の実装予定

1. 発注管理タブからのリンク導線
2. 実データでのE2E検証

## Web操作フロー

1. Excel/PDFを投入する
2. `インボックス取込` を実行する
3. `invoice_ledger` で内容を目視確認し、問題なければ `confirmed` をTRUEにする
4. `確認済みを整理` を実行する
5. `Excel計算実行` を実行する
6. 請求書金額が未登録なら、画面に出る入力欄へ金額と請求書日付を入れて再実行する
7. `CENTRAL同期 dry-run` で同期予定を確認する
8. 問題なければ `CENTRALへ本同期` を実行する
9. `支払期限を確認` で未払の期限超過・期限間近を確認する

## 初期セットアップ

1. 新規GASプロジェクトにこのリポジトリのファイルを配置する
2. Advanced Google Services で Drive API を有効化する
3. `setupAll()` を実行する
4. 作成されたスプレッドシート、Driveフォルダ、スクリプトプロパティを確認する

詳しい手順は [DEPLOYMENT.md](DEPLOYMENT.md) を参照。

function onOpen(e) {
  try {
    addHaksaiMaintenanceMenu_();
  } catch (err) {
    Logger.log('HAKSAIメンテ menu failed: ' + (err && err.stack ? err.stack : err));
    SpreadsheetApp.getUi()
      .createMenu('HAKSAIメンテ')
      .addItem('メニュー初期化エラーをログ出力', 'logHaksaiMenuError_')
      .addToUi();
  }

  try {
    if (typeof addResearchReviewMenu_ === 'function') addResearchReviewMenu_();
  } catch (err) {
    Logger.log('HAKSAI AIレビュー menu failed: ' + (err && err.stack ? err.stack : err));
  }
}

function onInstall(e) {
  onOpen(e);
}

function addHaksaiMaintenanceMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 HAKSAIメンテ')
    .addItem('📋 マニュアルを開く', 'showManualSidebar')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('① 商品登録')
        .addItem('未登録商品を一括登録', 'registerUnregisteredAsins')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('② 粗利計算')
        .addItem('計算できていない商品を抽出', 'exportUncalculatedProducts')
        .addItem('原価を一括登録（uncalculated取込）', 'importFromUncalculated')
        .addItem('原価を一括登録（missing_skus取込）', 'importFromMissingSkus')
        .addSeparator()
        .addItem('平均原価の原価不足を抽出', 'exportMovingAverageCostIssues')
        .addItem('平均原価の原価入力を確認（dryRun）', 'importMovingAverageCostIssues')
        .addItem('平均原価の原価入力を反映', 'applyMovingAverageCostIssues')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('③ SKUマスター補完')
        .addItem('inventory-reportから補完', 'fillMissingSkusFromInventoryReport')
        .addItem('missing_skusから補完', 'fillSkuMasterFromMissingSkus')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('④ バリエーション・subtitle')
        .addItem('subtitle未設定商品を抽出', 'exportMissingSubtitles')
        .addItem('subtitle一括反映', 'importFromMissingSubtitles')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('⑤ 折コン管理')
        .addItem('シートを初期化', 'setupBoxSheets')
        .addItem('QRコード印刷シートを生成', 'generateBoxQrSheet')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('⑥ トランザクション')
        .addItem('シートをクリア（再取込前）', 'setupTransactionSheets')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('⑥ AI相談カルテ')
        .addItem('🧾 AI相談カルテ生成', 'showProductAiExportSidebar')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('⑥ AI相談カルテ')
        .addItem('🧾 AI相談新商品相談カルテ生成', 'showResearchReviewSidebar')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('⑦ 期首在庫')
        .addItem('2026-01-01 期首在庫シートを作成', 'createOpeningInventory20260101')
        .addItem('2026-01-01 登録前プレビュー', 'previewOpeningInventory20260101')
        .addSeparator()
        .addItem('2026-01-01 期首在庫を本番登録', 'applyOpeningInventory20260101')
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('⑧ 発注履歴整理')
        .addItem('整理プレビューを作成', 'createReorderHistoryCleanupPreview20260101')
        .addSeparator()
        .addItem('整理を本番反映', 'applyReorderHistoryCleanup20260101')
    )
    .addToUi();
}

function logHaksaiMenuError_() {
  Logger.log('HAKSAIメンテ menu failed. Apps Script の実行ログを確認してください。');
}

function showManualSidebar() {
  const html = HtmlService.createHtmlOutput(getManualHtml())
    .setTitle('HAKSAI メンテナンスマニュアル')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getManualHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif;
    background: #0c0c0e;
    color: #eeede6;
    font-size: 12px;
    line-height: 1.6;
    padding: 12px;
  }
  h1 {
    font-size: 13px;
    font-weight: 700;
    color: #e8d5a3;
    letter-spacing: 0.08em;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    margin-bottom: 14px;
  }
  .section {
    background: #141417;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 10px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: #e8d5a3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .step {
    background: #1c1c21;
    border-radius: 7px;
    padding: 8px 10px;
    margin-bottom: 6px;
    border-left: 3px solid rgba(232,213,163,0.3);
  }
  .step:last-child { margin-bottom: 0; }
  .step-num {
    font-size: 10px;
    font-weight: 700;
    color: #e8d5a3;
    margin-bottom: 3px;
  }
  .step-desc {
    color: #9a9890;
    font-size: 11px;
  }
  .fn {
    display: inline-block;
    background: rgba(74,143,212,0.12);
    color: #6aa0cc;
    border: 1px solid rgba(74,143,212,0.25);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    margin-top: 4px;
  }
  .tag-warn {
    display: inline-block;
    background: rgba(200,136,42,0.12);
    color: #d49040;
    border: 1px solid rgba(200,136,42,0.3);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    margin-left: 4px;
  }
  .tag-ok {
    display: inline-block;
    background: rgba(26,158,110,0.12);
    color: #1a9e6e;
    border: 1px solid rgba(26,158,110,0.3);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    margin-left: 4px;
  }
  .divider {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.05);
    margin: 10px 0;
  }
  .note {
    font-size: 10px;
    color: #6b6a65;
    margin-top: 6px;
    line-height: 1.5;
  }
</style>
</head>
<body>
<h1>🔧 HAKSAI メンテナンスマニュアル</h1>

<div class="section">
  <div class="section-title">🛒 ① 売上タブに商品が表示されない</div>
  <div class="step">
    <div class="step-num">STEP 1</div>
    <div class="step-desc">未登録商品をproduct_lifecycleに追加する</div>
    <div class="fn">registerUnregisteredAsins()</div>
    <div class="note">transaction_historyに売上があるのにproduct_lifecycleに行がない商品を一括登録します。</div>
  </div>
</div>

<div class="section">
  <div class="section-title">💰 ② 粗利が計算できていない商品がある</div>
  <div class="step">
    <div class="step-num">STEP 1 — 原因を特定する</div>
    <div class="step-desc">粗利計算できていない商品を抽出してシートに出力する</div>
    <div class="fn">exportUncalculatedProducts()</div>
    <div class="note">uncalculatedシートに出力されます。「理由」列で原因を確認してください。</div>
  </div>
  <hr class="divider">
  <div class="step">
    <div class="step-num">STEP 2 — 理由が「原価未登録」の場合</div>
    <div class="step-desc">uncalculatedシートのJ列（着地原価）に手入力 → 実行</div>
    <div class="fn">importFromUncalculated()</div>
  </div>
  <hr class="divider">
  <div class="step">
    <div class="step-num">STEP 2 — 理由が「商品未登録」の場合</div>
    <div class="step-desc">product_lifecycleに行がない → 先にSTEP①を実行</div>
    <div class="fn">registerUnregisteredAsins()</div>
  </div>
  <hr class="divider">
  <div class="step">
    <div class="step-num">STEP 2 — 理由が「ASIN変換不可」の場合</div>
    <div class="step-desc">sku_masterにSKUが未登録 → FBA在庫レポートを同期するか手動でsku_masterに追加</div>
    <div class="note">在庫レポートを同期すると自動補完されます。</div>
  </div>
</div>

<div class="section">
  <div class="section-title">📋 ③ SKUマスターに空欄がある</div>
  <div class="step">
    <div class="step-num">STEP 1 — inventory-reportシートがある場合</div>
    <div class="step-desc">inventory-reportシートのデータでSKUマスターを補完する</div>
    <div class="fn">fillMissingSkusFromInventoryReport()</div>
    <div class="note">セラーセントラル → 在庫管理 → 在庫をダウンロード → inventory-reportシートに貼り付け後に実行。</div>
  </div>
  <hr class="divider">
  <div class="step">
    <div class="step-num">STEP 2 — missing_skusがある場合</div>
    <div class="step-desc">missing_skusシートの内容でSKUマスターを補完する</div>
    <div class="fn">fillSkuMasterFromMissingSkus()</div>
  </div>
</div>

<div class="section">
  <div class="section-title">🔄 ④ トランザクションを全部やり直したい</div>
  <div class="step">
    <div class="step-num">STEP 1 — シートをクリア <span class="tag-warn">データ削除</span></div>
    <div class="step-desc">transaction_history・period_costsを空にする</div>
    <div class="fn">setupTransactionSheets()</div>
  </div>
  <hr class="divider">
  <div class="step">
    <div class="step-num">STEP 2</div>
    <div class="step-desc">売上タブからCSVを再取込する <span class="tag-ok">アプリ側で操作</span></div>
    <div class="note">reorder_historyに原価が入っていれば、再取込時に自動で粗利が計算されます。</div>
  </div>
</div>

<div class="section">
  <div class="section-title">📦 ⑤ 着地原価を別ツールから同期したい</div>
  <div class="step">
    <div class="step-num">別ツール（仕入一覧表）のGASから実行</div>
    <div class="step-desc">仕入一覧表の依頼書データをreorder_historyに同期する</div>
    <div class="fn">syncToReorderHistory()</div>
    <div class="note">重複チェック済み。同じ依頼書番号は2重登録されません。</div>
  </div>
</div>

</body>
</html>`;
}

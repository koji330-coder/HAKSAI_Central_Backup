/**
 * HAKSAI 改修 Step 3：新規シート作成 & ヘッダ設定
 * 
 * 実行方法：
 * 1. GAS エディタを開く（Sheets で 拡張機能 → Apps Script）
 * 2. このコードをコピー & 貼り付け
 * 3. createNewSheets() 関数を実行
 * 4. スプレッドシートをリロード
 * 
 * 結果：
 * - product_lifecycle シート（ヘッダ行 37 列）
 * - reorder_history シート（ヘッダ行 12 列）
 * がそれぞれ新規作成される
 */


// ========================================
// product_lifecycle のヘッダ定義
// ========================================
const PRODUCT_LIFECYCLE_HEADERS = [
  "id",
  "status",
  "category",
  "title",
  "summary",
  "price",
  "monthly_sales",
  "reviews",
  "emoji",
  "tags",
  "supplier_keywords",
  "weakness",
  "created_at",
  "updated_at",
  "audit",
  "produce",
  "scores",
  "checks",
  "image_drive_ids",
  "image_drive_id",
  "urls",
  "supplier_keywords_json",
  "profit",
  "cost_simulation",
  "page_draft",
  "asin",
  "gtin",
  "amazon_url",
  "amazon_published_date",
  "supplier_1688_url",
  "rakumart_linkage_status",
  "barcode_option",
  "current_landed_cost",
  "actual_result",
  "is_deleted",
  "is_launched",
  "source"
];

// ========================================
// reorder_history のヘッダ定義
// ========================================
const REORDER_HISTORY_HEADERS = [
  "id",
  "product_id",
  "order_date",
  "quantity",
  "unit_price_1688",
  "landed_cost_actual",
  "lead_time_days",
  "expected_arrival_date",
  "fba_fee_at_order",
  "selling_price_at_order",
  "notes",
  "created_at"
];

// ========================================
// メイン関数：新規シート作成 & ヘッダ設定
// ========================================
function createNewSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  Logger.log("🔄 Starting sheet creation process...");
  
  try {
    // Step 1: product_lifecycle シート作成
    Logger.log("📝 Creating product_lifecycle sheet...");
    const lifecycleSheet = createSheetWithHeaders(
      ss,
      "product_lifecycle",
      PRODUCT_LIFECYCLE_HEADERS
    );
    Logger.log("✅ product_lifecycle created with " + PRODUCT_LIFECYCLE_HEADERS.length + " columns");
    
    // Step 2: reorder_history シート作成
    Logger.log("📝 Creating reorder_history sheet...");
    const reorderSheet = createSheetWithHeaders(
      ss,
      "reorder_history",
      REORDER_HISTORY_HEADERS
    );
    Logger.log("✅ reorder_history created with " + REORDER_HISTORY_HEADERS.length + " columns");
    
    // Step 3: シートの並び替え（タブの表示順を整理）
    Logger.log("🔀 Reordering sheet tabs...");
    reorderSheetTabs(ss);
    Logger.log("✅ Sheet tabs reordered");
    
    // Step 4: フォーマット設定（見出しの装飾）
    Logger.log("🎨 Formatting headers...");
    formatHeaderRows(lifecycleSheet, PRODUCT_LIFECYCLE_HEADERS.length);
    formatHeaderRows(reorderSheet, REORDER_HISTORY_HEADERS.length);
    Logger.log("✅ Headers formatted");
    
    Logger.log("\n🎉 All sheets created successfully!");
    Logger.log("Next step: Run migrateCardsAndPageProjects() to migrate data");
    
  } catch (error) {
    Logger.log("❌ Error: " + error.message);
    throw error;
  }
}

// ========================================
// Helper 関数 1：シート作成 & ヘッダ設定
// ========================================
function createSheetWithHeaders(ss, sheetName, headers) {
  // 同名シートが既に存在しないかチェック
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    Logger.log("⚠️  Sheet '" + sheetName + "' already exists. Skipping creation.");
    return sheet;
  }
  
  // 新規シート作成
  sheet = ss.insertSheet(sheetName);
  
  // ヘッダ行を A1 から入力
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  
  return sheet;
}

// ========================================
// Helper 関数 2：シートタブの並び替え
// ========================================
function reorderSheetTabs(ss) {
  /**
   * 目的のタブ順序：
   * 1. product_lifecycle
   * 2. reorder_history
   * 3. cards
   * 4. page_projects
   * 5. cards_backup_2026-05-16
   * 6. page_projects_backup_2026-05-16
   */
  
  const desiredOrder = [
    "product_lifecycle",
    "reorder_history",
    "cards",
    "page_projects",
    "cards_backup_2026-05-16",
    "page_projects_backup_2026-05-16"
  ];
  
  const allSheets = ss.getSheets();
  
  // 目的のタブ順序で、各シートを移動
  let targetPosition = 0;
  for (let i = 0; i < desiredOrder.length; i++) {
    const sheetName = desiredOrder[i];
    const sheet = ss.getSheetByName(sheetName);
    
    if (sheet) {
      ss.moveSheet(sheet, targetPosition + 1);
      targetPosition++;
    }
  }
}

// ========================================
// Helper 関数 3：ヘッダ行のフォーマット設定
// ========================================
function formatHeaderRows(sheet, columnCount) {
  const headerRange = sheet.getRange(1, 1, 1, columnCount);
  
  // 背景色：濃いグレー
  headerRange.setBackground("#3f3f3f");
  
  // フォント色：白
  headerRange.setFontColor("#ffffff");
  
  // フォント：太字
  headerRange.setFontWeight("bold");
  
  // テキスト配置：中央
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  
  // セルの高さを調整
  sheet.setRowHeight(1, 25);
  
  // 列幅を自動調整（最小 80px）
  for (let col = 1; col <= columnCount; col++) {
    sheet.autoResizeColumn(col);
    const currentWidth = sheet.getColumnWidth(col);
    if (currentWidth < 80) {
      sheet.setColumnWidth(col, 80);
    }
  }
}

// ========================================
// 検証関数：シート作成状況を確認
// ========================================
function verifyNewSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  Logger.log("📋 Sheet verification report:");
  Logger.log("================================");
  
  const lifecycleSheet = ss.getSheetByName("product_lifecycle");
  const reorderSheet = ss.getSheetByName("reorder_history");
  
  if (!lifecycleSheet) {
    Logger.log("❌ product_lifecycle sheet not found");
  } else {
    const lastCol = lifecycleSheet.getLastColumn();
    const lastRow = lifecycleSheet.getLastRow();
    Logger.log("✅ product_lifecycle: " + lastCol + " columns, " + lastRow + " rows");
  }
  
  if (!reorderSheet) {
    Logger.log("❌ reorder_history sheet not found");
  } else {
    const lastCol = reorderSheet.getLastColumn();
    const lastRow = reorderSheet.getLastRow();
    Logger.log("✅ reorder_history: " + lastCol + " columns, " + lastRow + " rows");
  }
  
  Logger.log("================================");
  Logger.log("All sheet tabs:");
  ss.getSheets().forEach((sheet, index) => {
    Logger.log((index + 1) + ". " + sheet.getName());
  });
}

// ========================================
// クリーンアップ関数：シート削除（テスト用）
// ========================================
function deleteNewSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const sheetNamesToDelete = ["product_lifecycle", "reorder_history"];
  
  sheetNamesToDelete.forEach((sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      ss.deleteSheet(sheet);
      Logger.log("🗑️  Deleted sheet: " + sheetName);
    }
  });
  
  Logger.log("Cleanup completed");
}

/**
 * HAKSAI 改修 Step 4-5：データ移行スクリプト
 * 
 * 実行方法：
 * 1. GAS エディタで migrateCardsAndPageProjects() 関数を実行
 * 2. 実行ログで結果を確認
 * 3. Sheets で product_lifecycle にデータが追記されたことを確認
 * 
 * 処理内容：
 * - cards シートから全データを読込
 * - page_projects シートから全データを読込
 * - source_card_id で結合
 * - product_lifecycle に統合された形式で追記
 */


// ========================================
// メイン移行関数
// ========================================
function migrateCardsAndPageProjects() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  Logger.log("🔄 Starting data migration...");
  Logger.log("================================");
  
  try {
    // Step 1: 既存データを読込
    Logger.log("📖 Reading cards sheet...");
    const cardsData = readSheetData(ss, "cards");
    Logger.log("✅ Found " + cardsData.rows.length + " cards");
    
    Logger.log("📖 Reading page_projects sheet...");
    const projectsData = readSheetData(ss, "page_projects");
    Logger.log("✅ Found " + projectsData.rows.length + " page_projects");
    
    // Step 2: product_lifecycle シートを取得
    const lifecycleSheet = ss.getSheetByName("product_lifecycle");
    if (!lifecycleSheet) {
      throw new Error("product_lifecycle sheet not found");
    }
    
    // Step 3: カード ごとにループして統合
    Logger.log("\n🔗 Merging cards and page_projects...");
    let migratedCount = 0;
    
    for (let i = 0; i < cardsData.rows.length; i++) {
      const card = cardsData.rows[i];
      const cardId = card.id;
      
      // 対応する page_project を探す
      const matchingProject = projectsData.rows.find(p => p.source_card_id === cardId);
      
      // product_lifecycle 用の行を構築
      const rowData = buildProductLifecycleRow(card, matchingProject);
      
      // product_lifecycle に追記
      lifecycleSheet.appendRow(rowData);
      
      migratedCount++;
      
      // 進捗表示（100 件ごと）
      if (migratedCount % 100 === 0) {
        Logger.log("  ... " + migratedCount + " rows migrated");
      }
    }
    
    Logger.log("✅ All data merged");
    
    // Step 4: 検証
    Logger.log("\n🔍 Verification:");
    const lastRow = lifecycleSheet.getLastRow();
    Logger.log("  product_lifecycle now has " + (lastRow - 1) + " data rows (excluding header)");
    
    Logger.log("\n================================");
    Logger.log("🎉 Migration completed successfully!");
    Logger.log("Next steps:");
    Logger.log("  1. Open Sheets and verify product_lifecycle has data");
    Logger.log("  2. Check 3-5 sample rows for correctness");
    Logger.log("  3. Run verifyMigration() to see detailed summary");
    Logger.log("  4. Then proceed to Step 6 (GAS API Implementation)");
    
  } catch (error) {
    Logger.log("\n❌ Migration failed: " + error.message);
    Logger.log(error.stack);
    throw error;
  }
}

// ========================================
// Helper 関数 1：シートデータを読込（ヘッダとデータ行を分離）
// ========================================
function readSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet '" + sheetName + "' not found");
  }
  
  const data = sheet.getDataRange().getValues();
  
  if (data.length === 0) {
    return { headers: [], rows: [] };
  }
  
  const headers = data[0];  // 1 行目がヘッダ
  const rows = [];
  
  // 2 行目以降をオブジェクト化
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] || null;
    }
    
    rows.push(obj);
  }
  
  return { headers: headers, rows: rows };
}

// ========================================
// Helper 関数 2：product_lifecycle 用の行データを構築
// ========================================
function buildProductLifecycleRow(card, matchingProject) {
  /**
   * product_lifecycle のヘッダ順：
   * id, status, category, title, summary, price, monthly_sales, reviews, emoji, tags,
   * supplier_keywords, weakness, created_at, updated_at, audit, produce, scores, checks,
   * image_drive_ids, image_drive_id, urls, supplier_keywords_json, profit, cost_simulation,
   * page_draft, asin, gtin, amazon_url, amazon_published_date, supplier_1688_url,
   * rakumart_linkage_status, barcode_option, current_landed_cost, actual_result,
   * is_deleted, is_launched, source
   */
  
  // page_draft を構築（matchingProject がある場合はそこから、なければ空オブジェクト）
  const pageDraft = matchingProject ? {
    concept: matchingProject.concept || null,
    title_draft: matchingProject.title_draft || null,
    bullet_points: tryParseJSON(matchingProject.bullet_points) || [],
    description: matchingProject.description || null,
    image_plan: tryParseJSON(matchingProject.image_plan) || [],
    backend_keywords: matchingProject.backend_keywords || null
  } : {};
  
  const rowData = [
    card.id || "",                                      // id
    card.status || "research",                          // status
    card.category || "",                                // category
    card.title || "",                                   // title
    card.summary || "",                                 // summary
    card.price || 0,                                    // price
    card.monthly_sales || 0,                            // monthly_sales
    card.reviews || 0,                                  // reviews
    card.emoji || "",                                   // emoji
    tryParseJSON(card.tags) || [],                      // tags → JSON
    card.supplier_keywords || "",                       // supplier_keywords
    card.weakness || "",                                // weakness
    card.created_at || new Date().toISOString(),        // created_at
    new Date().toISOString(),                           // updated_at
    tryParseJSON(card.audit) || {},                     // audit → JSON
    tryParseJSON(card.produce) || {},                   // produce → JSON
    tryParseJSON(card.scores) || {},                    // scores → JSON
    tryParseJSON(card.checks) || {},                    // checks → JSON
    tryParseJSON(card.image_drive_ids) || [],           // image_drive_ids → JSON
    card.image_drive_id || "",                          // image_drive_id
    tryParseJSON(card.urls) || {},                      // urls → JSON
    card.supplier_keywords || "",                       // supplier_keywords_json
    tryParseJSON(card.profit) || {},                    // profit → JSON
    tryParseJSON(card.cost_simulation) || {},           // cost_simulation → JSON
    pageDraft,                                          // page_draft → 統合したオブジェクト
    matchingProject?.asin || null,                      // asin（新規フィールド）
    matchingProject?.gtin || null,                      // gtin（新規フィールド）
    matchingProject?.amazon_url || null,                // amazon_url（新規フィールド）
    matchingProject?.amazon_published_date || null,     // amazon_published_date（新規フィールド）
    matchingProject?.supplier_1688_url || null,         // supplier_1688_url（新規フィールド）
    matchingProject?.rakumart_linkage_status || null,   // rakumart_linkage_status（新規フィールド）
    matchingProject?.barcode_option || null,            // barcode_option（新規フィールド）
    null,                                               // current_landed_cost（発注後に入力）
    tryParseJSON(card.actual_result) || {},             // actual_result → JSON
    card.is_deleted || false,                           // is_deleted
    card.is_launched || false,                          // is_launched
    card.source || ""                                   // source
  ];
  
  return rowData;
}

// ========================================
// Helper 関数 3：JSON パース（エラーハンドリング付き）
// ========================================
function tryParseJSON(value) {
  if (!value) return null;
  
  // すでにオブジェクト or 配列の場合
  if (typeof value === "object") {
    return value;
  }
  
  // 文字列の場合はパースを試みる
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      Logger.log("⚠️  Failed to parse JSON: " + value.substring(0, 50));
      return null;
    }
  }
  
  return null;
}

// ========================================
// 検証関数：移行結果を詳細表示
// ========================================
function verifyMigration() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  Logger.log("\n📋 Migration Verification Report");
  Logger.log("================================");
  
  // product_lifecycle の確認
  const lifecycleSheet = ss.getSheetByName("product_lifecycle");
  if (!lifecycleSheet) {
    Logger.log("❌ product_lifecycle not found");
    return;
  }
  
  const lifecycleData = lifecycleSheet.getDataRange().getValues();
  const lifecycleCount = lifecycleData.length - 1;  // ヘッダを除く
  
  Logger.log("\n✅ product_lifecycle:");
  Logger.log("  Rows (excluding header): " + lifecycleCount);
  Logger.log("  Columns: " + lifecycleData[0].length);
  
  // サンプル行の確認（最初の 3 行）
  Logger.log("\n📊 Sample data (first 3 rows):");
  for (let i = 1; i <= Math.min(3, lifecycleData.length - 1); i++) {
    const row = lifecycleData[i];
    Logger.log("  Row " + i + ":");
    Logger.log("    - id: " + row[0]);
    Logger.log("    - title: " + row[3]);
    Logger.log("    - status: " + row[1]);
    Logger.log("    - page_draft (Y col): " + (typeof row[24] === "object" ? "✅ JSON" : "❌ Not JSON"));
  }
  
  // cards, page_projects の確認
  const cardsSheet = ss.getSheetByName("cards");
  const cardsCount = cardsSheet ? cardsSheet.getLastRow() - 1 : 0;
  Logger.log("\n📝 Original sheets:");
  Logger.log("  cards: " + cardsCount + " rows");
  
  const projectsSheet = ss.getSheetByName("page_projects");
  const projectsCount = projectsSheet ? projectsSheet.getLastRow() - 1 : 0;
  Logger.log("  page_projects: " + projectsCount + " rows");
  
  Logger.log("\n✅ Verification complete!");
  
  if (lifecycleCount === cardsCount) {
    Logger.log("✅ Row count matches! (product_lifecycle = cards)");
  } else {
    Logger.log("⚠️  Row count mismatch: product_lifecycle=" + lifecycleCount + ", cards=" + cardsCount);
  }
}

// ========================================
// ロールバック関数：product_lifecycle のデータを削除（テスト用）
// ========================================
function rollbackMigration() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lifecycleSheet = ss.getSheetByName("product_lifecycle");
  
  if (!lifecycleSheet) {
    Logger.log("product_lifecycle not found");
    return;
  }
  
  const lastRow = lifecycleSheet.getLastRow();
  
  if (lastRow <= 1) {
    Logger.log("No data to delete (only header exists)");
    return;
  }
  
  // 2 行目以降をすべて削除
  lifecycleSheet.deleteRows(2, lastRow - 1);
  
  Logger.log("🗑️  Deleted " + (lastRow - 1) + " rows from product_lifecycle");
  Logger.log("Rollback completed. product_lifecycle is now empty (header only)");
}

function fixUrlsColumn() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('product_lifecycle');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const urlsIdx = headers.indexOf('urls');

  if (urlsIdx === -1) {
    Logger.log('urls column not found');
    return;
  }

  let fixed = 0;
  for (let i = 1; i < data.length; i++) {
    const val = data[i][urlsIdx];
    // 正常な JSON 文字列かチェック
    let isValid = false;
    if (typeof val === 'string' && val.trim() !== '') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) isValid = true;
      } catch(e) {
        isValid = false;
      }
    }
    // 正常でない場合は [] で上書き
    if (!isValid) {
      sheet.getRange(i + 1, urlsIdx + 1).setValue('[]');
      fixed++;
    }
  }

  Logger.log('Fixed ' + fixed + ' rows');
}

/**
 * HAKSAI - import_csv シート作成スクリプト
 * 
 * 実行方法：
 * 1. GAS エディタにこのコードを貼り付け
 * 2. createImportCsvSheet() を実行
 * 3. スプレッドシートをリロードして import_csv シートを確認
 */

function createImportCsvSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 既存シートがあれば削除して作り直す
  const existing = ss.getSheetByName('import_csv');
  if (existing) {
    ss.deleteSheet(existing);
    Logger.log('既存の import_csv シートを削除しました');
  }

  // 新規シート作成
  const sheet = ss.insertSheet('import_csv');
  Logger.log('import_csv シートを作成しました');

  // ── ヘッダ行 ──
  const headers = [
    'title',
    'asin',
    'gtin',
    'current_landed_cost',
    'supplier_1688_url',
    'amazon_url',
    'price',
    'monthly_sales',
    'category',
    'emoji',
    'summary',
    'memo'
  ];

  // ── サンプルデータ 1 件 ──
  const sampleRow = [
    '卓上ベル ChimePro',           // title         ★必須
    'B0XXXXXXXXX',                  // asin
    '0000000000000',                // gtin
    377,                            // current_landed_cost（着地原価）
    'https://detail.1688.com/offer/xxxxxxxxx.html',  // supplier_1688_url
    'https://www.amazon.co.jp/dp/B0XXXXXXXXX',       // amazon_url
    748,                            // price（販売価格）
    120,                            // monthly_sales（月販数）
    '卓上ベル',                     // category
    '🔔',                          // emoji
    '受付・店舗・介護施設向け呼び鈴', // summary
    'ラクマート経由で仕入れ。混載注意' // memo
  ];

  // ── シートに書き込み ──
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, 1, sampleRow.length).setValues([sampleRow]);

  // ── ヘッダ行の装飾 ──
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#3f3f3f');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');

  // ── title 列を強調（必須） ──
  sheet.getRange(1, 1).setBackground('#c8882a').setFontColor('#ffffff');
  sheet.getRange(1, 1).setNote('★ 必須項目。空欄の行はインポートされません。');

  // ── 列幅を自動調整 ──
  headers.forEach((_, idx) => {
    sheet.autoResizeColumn(idx + 1);
    const w = sheet.getColumnWidth(idx + 1);
    if (w < 120) sheet.setColumnWidth(idx + 1, 120);
  });

  // ── 使い方コメントを A4 に追記 ──
  sheet.getRange('A4').setValue('【使い方】');
  sheet.getRange('A5').setValue('1. 2行目以降にデータを貼り付ける（サンプル行は削除してOK）');
  sheet.getRange('A6').setValue('2. title列（A列）は必須。他は空欄OK');
  sheet.getRange('A7').setValue('3. GASで importSellingProductsFromCSV() を実行');
  sheet.getRange('A8').setValue('4. product_lifecycle にデータが追記される（is_launched = TRUE で登録）');
  sheet.getRange('A4:A8').setFontColor('#6b6a65').setFontStyle('italic');

  Logger.log('================================');
  Logger.log('✅ import_csv シート作成完了');
  Logger.log('  ヘッダ: ' + headers.length + '列');
  Logger.log('  サンプルデータ: 1件');
  Logger.log('  次のステップ: データを貼り付けて importSellingProductsFromCSV() を実行');
}

function debugLifecycleHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('product_lifecycle');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // 全ヘッダーと列番号を出力
  headers.forEach((h, i) => {
    Logger.log(`${i + 1}列目: "${h}"`);
  });
  
  // fba系フィールドが存在するか確認
  const fbaFields = ['fba_stock', 'fba_inbound', 'fba_daily_t7', 'fba_days_remain', 'fba_alert', 'fba_synced_at'];
  Logger.log('--- fbaフィールド確認 ---');
  fbaFields.forEach(f => {
    const idx = headers.indexOf(f);
    Logger.log(`${f}: ${idx >= 0 ? (idx + 1) + '列目' : '★存在しない'}`);
  });
  
  // 実際にデータが入っているか確認（2行目）
  if (sheet.getLastRow() >= 2) {
    const row2 = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
    Logger.log('--- 2行目のfba値確認 ---');
    fbaFields.forEach(f => {
      const idx = headers.indexOf(f);
      Logger.log(`${f}: "${idx >= 0 ? row2[idx] : 'N/A'}"`);
    });
  }
}

function debugSyncInventory() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('product_lifecycle');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const asinIdx = headers.indexOf('asin');
  
  Logger.log('--- product_lifecycleのASIN一覧 ---');
  for (let i = 1; i < data.length; i++) {
    const asin = data[i][asinIdx];
    if (asin) Logger.log(`行${i + 1}: "${asin}"`);
  }
}

function debugWriteInventory() {
  // エアコンブラシのASINでテスト書き込み
  const testData = [{
    asin: 'B0G1LMSDTB',
    available: 20,
    inbound: 301,
    dailyT7: 17,
    dailyT30: 8.1,
    daysRemain: 18,
    alert: '🔴 テスト書き込み',
    syncedAt: new Date().toLocaleString('ja-JP')
  }];

  try {
    const result = syncInventoryFromReport(testData);
    Logger.log('結果: ' + JSON.stringify(result));
  } catch(e) {
    Logger.log('エラー: ' + e.message);
    Logger.log(e.stack);
  }
}

function debugCheckHeaders() {
  Logger.log(JSON.stringify(REQUIRED_HEADERS_LIFECYCLE));
}

function debugGetCards() {
  const cards = getAllCards_ProductLifecycle();
  // ASINがある最初のカードを探す
  const card = cards.find(c => c.asin === 'B0G1LMSDTB');
  if (!card) { Logger.log('エアコンブラシが見つかりません'); return; }
  
  Logger.log('asin: ' + card.asin);
  Logger.log('current_landed_cost: ' + card.current_landed_cost);
  Logger.log('fba_stock: ' + card.fba_stock);
  Logger.log('fba_alert: ' + card.fba_alert);
  Logger.log('fba_synced_at: ' + card.fba_synced_at);
  
  // fba系の全フィールドをチェック
  ['fba_stock','fba_inbound','fba_daily_t7','fba_days_remain','fba_alert','fba_synced_at'].forEach(f => {
    Logger.log(f + ': "' + card[f] + '" (type: ' + typeof card[f] + ')');
  });
}

function debugIsLaunched() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('product_lifecycle');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const isLaunchedIdx = headers.indexOf('is_launched');
  const sourceIdx = headers.indexOf('source');
  
  data.slice(1).forEach((row, i) => {
    if (row[sourceIdx] === 'inventory_import') {
      Logger.log(`行${i+2}: is_launched="${row[isLaunchedIdx]}" (${typeof row[isLaunchedIdx]})`);
    }
  });
}

// ============================================
// filter_buttons シート初期セットアップ
// 一度だけ実行してください
// ============================================

function setupFilterButtons() {
  const ss = getSpreadsheet_();
  
  // シートが既にあれば確認
  let sheet = ss.getSheetByName('filter_buttons');
  if (sheet) {
    const ui = SpreadsheetApp.getUi();
    const res = ui.alert(
      'filter_buttons シートが既に存在します',
      '上書きしますか？（現在の内容は削除されます）',
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) {
      Logger.log('セットアップをキャンセルしました。');
      return;
    }
    sheet.clearContents();
  } else {
    sheet = ss.insertSheet('filter_buttons');
  }

  // ヘッダー
  sheet.getRange(1, 1, 1, 2).setValues([['label', 'keyword']]);

  // 初期ボタン設定
  const initialButtons = [
    ['HAKSAI',       'HAKSAI'],
    ['LAGERFEUER',   'LAGERFEUER'],
    ['バイクカバー',  'バイクカバー'],
    ['ガス缶カバー',  'ガス缶'],
    ['パジャマ',      'パジャマ'],
    ['ベルト',        'ベルト'],
    ['卓上ベル',      '卓上ベル'],
    ['エアコン',      'エアコン'],
    ['ハンドベル',    'ハンドベル'],
    ['🚨 要対応',    '🚨'],
  ];

  sheet.getRange(2, 1, initialButtons.length, 2).setValues(initialButtons);

  // 見やすくする
  sheet.getRange(1, 1, 1, 2)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');

  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 200);
  sheet.setFrozenRows(1);

  Logger.log(`✅ filter_buttons シートを作成しました（${initialButtons.length}件）`);
  SpreadsheetApp.getUi().alert(
    `✅ filter_buttons シートを作成しました。\n${initialButtons.length}件のボタンを登録しました。\n\nラベルとキーワードを自由に編集・追加・削除できます。`
  );
}

function fixPeriodKeyFormat() {
  const ss = getSpreadsheet_();
  
  // transaction_history の period_key 列（N列=14列目）をテキスト書式に
  const th = ss.getSheetByName('transaction_history');
  if (th) {
    const headers = th.getRange(1, 1, 1, th.getLastColumn()).getValues()[0];
    const pidx = headers.indexOf('period_key');
    if (pidx >= 0) {
      th.getRange(2, pidx + 1, th.getLastRow(), 1).setNumberFormat('@STRING@');
      Logger.log('transaction_history: period_key 列をテキスト書式に変更しました。列番号: ' + (pidx + 1));
    }
  }
  
  // period_costs の period_key 列も同様に
  const pc = ss.getSheetByName('period_costs');
  if (pc) {
    const headers = pc.getRange(1, 1, 1, pc.getLastColumn()).getValues()[0];
    const pidx = headers.indexOf('period_key');
    if (pidx >= 0) {
      pc.getRange(2, pidx + 1, pc.getLastRow(), 1).setNumberFormat('@STRING@');
      Logger.log('period_costs: period_key 列をテキスト書式に変更しました。列番号: ' + (pidx + 1));
    }
  }
  
  Logger.log('✅ 完了。既存データを再度取り込み直してください。');
}

function debugSyncTransactions() {
  const ss = getSpreadsheet_();
  
  // 1. sku_master の中身確認
  const skuSheet = ss.getSheetByName('sku_master');
  if (!skuSheet) {
    Logger.log('❌ sku_master シートが存在しない');
  } else {
    const skuData = skuSheet.getDataRange().getValues();
    Logger.log('sku_master 行数: ' + skuData.length);
    Logger.log('sku_master 先頭3行: ' + JSON.stringify(skuData.slice(0, 3)));
  }

  // 2. transaction_history の中身確認
  const txSheet = ss.getSheetByName('transaction_history');
  if (!txSheet) {
    Logger.log('❌ transaction_history シートが存在しない');
  } else {
    const txData = txSheet.getDataRange().getValues();
    Logger.log('transaction_history 行数: ' + txData.length);
    Logger.log('ヘッダー: ' + JSON.stringify(txData[0]));
    if (txData.length > 1) {
      Logger.log('2行目: ' + JSON.stringify(txData[1]));
      // period_key の型を確認
      const headers = txData[0];
      const pidx = headers.indexOf('period_key');
      const val = txData[1][pidx];
      Logger.log('period_key の値: ' + val);
      Logger.log('period_key の型: ' + typeof val);
      Logger.log('period_key instanceof Date: ' + (val instanceof Date));
    }
  }

  // 3. product_lifecycle の sales_actual 確認
  const lcSheet = ss.getSheetByName('product_lifecycle');
  if (lcSheet) {
    const lcData = lcSheet.getDataRange().getValues();
    const lcHeaders = lcData[0];
    const saIdx = lcHeaders.indexOf('sales_actual');
    const asinIdx = lcHeaders.indexOf('asin');
    Logger.log('sales_actual 列インデックス: ' + saIdx);
    // 最初の5行のsales_actualを確認
    for (let i = 1; i <= Math.min(5, lcData.length - 1); i++) {
      const asin = lcData[i][asinIdx];
      const sa = lcData[i][saIdx];
      Logger.log(`行${i} ASIN:${asin} sales_actual: ${String(sa).slice(0, 100)}`);
    }
  }

  // 4. buildSkuToAsinMap の結果確認
  const skuMap = buildSkuToAsinMap_();
  Logger.log('SKU→ASINマップ件数: ' + Object.keys(skuMap).length);
  Logger.log('マップ先頭3件: ' + JSON.stringify(Object.entries(skuMap).slice(0, 3)));

  // 5. getAvailablePeriods の結果確認
  const periods = getAvailablePeriods();
  Logger.log('利用可能な期間: ' + JSON.stringify(periods));

  // 6. period_costs 確認
  const pcSheet = ss.getSheetByName('period_costs');
  if (pcSheet) {
    const pcData = pcSheet.getDataRange().getValues();
    Logger.log('period_costs 行数: ' + pcData.length);
    if (pcData.length > 1) {
      const pidx = pcData[0].indexOf('period_key');
      const val = pcData[1][pidx];
      Logger.log('period_costs period_key 値: ' + val + ' 型: ' + typeof val);
    }
  }
}

function debugLifecycleAsins() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('product_lifecycle');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const asinIdx = headers.indexOf('asin');
  const titleIdx = headers.indexOf('title');
  const launchedIdx = headers.indexOf('is_launched');
  
  Logger.log('総行数: ' + (data.length - 1));
  for (let i = 1; i <= Math.min(10, data.length - 1); i++) {
    Logger.log(`行${i}: title=${data[i][titleIdx]} asin=${data[i][asinIdx]} is_launched=${data[i][launchedIdx]}`);
  }
}

function debugSkuMasterUpdate() {
  // syncInventoryFromReport を小さいダミーデータでテスト
  const testData = [{
    asin: 'TEST_ASIN_001',
    title: 'テスト商品',
    available: 10,
    inbound: 0,
    dailyT7: 1,
    dailyT30: 1,
    daysRemain: 10,
    alert: '✅ テスト',
    syncedAt: new Date().toISOString(),
    skus: [
      { sku: 'TEST-SKU-001', fnsku: 'TEST-FNSKU-001' },
      { sku: 'TEST-SKU-002', fnsku: 'TEST-FNSKU-002' },
    ]
  }];

  Logger.log('テストデータ: ' + JSON.stringify(testData));
  
  // updateSkuMaster_ を直接呼ぶ
  updateSkuMaster_(testData);
  
  // 結果確認
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('sku_master');
  const data = sheet.getDataRange().getValues();
  Logger.log('sku_master 行数: ' + data.length);
  Logger.log('sku_master 内容: ' + JSON.stringify(data));
}

function debugLiveInventorySync() {
  // 直近の syncInventory 呼び出しで何が来たか確認できないので
  // syncInventoryFromReport の冒頭にログを仕込んでテスト
  const sheet = getSpreadsheet_().getSheetByName('sku_master');
  const data = sheet.getDataRange().getValues();
  Logger.log('現在のsku_master行数: ' + data.length);
  Logger.log('現在の内容: ' + JSON.stringify(data.slice(0, 5)));
}

function debugAfterSync() {
  const sheet = getSpreadsheet_().getSheetByName('sku_master');
  const data = sheet.getDataRange().getValues();
  Logger.log('同期後のsku_master行数: ' + data.length);
  Logger.log('同期後の内容（先頭5件）: ' + JSON.stringify(data.slice(0, 5)));
}

function debugSalesActual() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('product_lifecycle');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const saIdx = headers.indexOf('sales_actual');
  const asinIdx = headers.indexOf('asin');
  const launchedIdx = headers.indexOf('is_launched');
  
  Logger.log('sales_actual列インデックス: ' + saIdx);
  
  let found = 0;
  for (let i = 1; i < data.length; i++) {
    const sa = data[i][saIdx];
    const asin = data[i][asinIdx];
    const launched = data[i][launchedIdx];
    if (launched && sa) {
      Logger.log(`行${i} ASIN:${asin} sales_actual:${String(sa).slice(0,80)}`);
      found++;
    }
  }
  Logger.log(`sales_actualが入っている販売中商品: ${found}件`);
}

function debugGetCards() {
  const cards = getAllCards_ProductLifecycle();
  const launched = cards.filter(c => c.is_launched);
  Logger.log('販売中カード数: ' + launched.length);
  
  const first = launched[0];
  if (first) {
    Logger.log('最初のカードASIN: ' + first.asin);
    Logger.log('sales_actualの型: ' + typeof first.sales_actual);
    Logger.log('sales_actualはArray: ' + Array.isArray(first.sales_actual));
    Logger.log('sales_actualの値: ' + JSON.stringify(first.sales_actual).slice(0, 200));
  }
}

function debugJsonCols() {
  Logger.log('JSON_COLS_LIFECYCLE: ' + JSON.stringify(JSON_COLS_LIFECYCLE));
  Logger.log('sales_actualが含まれるか: ' + JSON_COLS_LIFECYCLE.includes('sales_actual'));
}

function debugRequiredHeaders() {
  Logger.log('REQUIRED_HEADERS_LIFECYCLEにsales_actualあるか: ' + REQUIRED_HEADERS_LIFECYCLE.includes('sales_actual'));
  Logger.log('末尾5件: ' + JSON.stringify(REQUIRED_HEADERS_LIFECYCLE.slice(-5)));
}

function debugSheetHeaders() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  Logger.log('シートの実際のヘッダー数: ' + headers.length);
  Logger.log('sales_actualのインデックス: ' + headers.indexOf('sales_actual'));
  Logger.log('末尾5件: ' + JSON.stringify(headers.slice(-5)));
  
  // 1行目のデータも確認
  const data = sheet.getDataRange().getValues();
  Logger.log('データ行数: ' + (data.length - 1));
  const saIdx = headers.indexOf('sales_actual');
  if (saIdx >= 0 && data.length > 1) {
    Logger.log('行1のsales_actual値: ' + String(data[1][saIdx]).slice(0, 100));
  }
}

function debugRowToObject() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  // sales_actualがある行を探す
  const saIdx = headers.indexOf('sales_actual');
  Logger.log('saIdx: ' + saIdx);
  
  // 行21を直接確認（debugSalesActualで確認できた行）
  const row21 = data[21]; // 0始まりなので行22
  Logger.log('row21のsales_actual生値: ' + String(row21[saIdx]).slice(0, 100));
  
  // rowToObject_で変換
  const obj = rowToObject_(headers, row21, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
  Logger.log('変換後sales_actualの型: ' + typeof obj.sales_actual);
  Logger.log('変換後sales_actualはArray: ' + Array.isArray(obj.sales_actual));
  Logger.log('変換後sales_actual: ' + JSON.stringify(obj.sales_actual).slice(0, 100));
}

function debugGetAllCards() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  Logger.log('headers長さ: ' + headers.length);
  Logger.log('data[0]長さ（シートヘッダー行）: ' + data[0].length);
  
  // 行21をrowToObject_で変換
  const obj = rowToObject_(headers, data[21], JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
  Logger.log('直接変換: sales_actualはArray: ' + Array.isArray(obj.sales_actual));
  
  // getAllCards経由で取得
  const cards = getAllCards_ProductLifecycle();
  const card = cards.find(c => c.asin === obj.asin);
  if (card) {
    Logger.log('getAllCards経由: sales_actualの型: ' + typeof card.sales_actual);
    Logger.log('getAllCards経由: sales_actualはArray: ' + Array.isArray(card.sales_actual));
  } else {
    Logger.log('カードが見つかりません ASIN: ' + obj.asin);
  }
}

function debugVersion() {
  // JSON_COLS_LIFECYCLEの内容をgetAllCards内から確認
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  Logger.log('getAllCards内のJSON_COLS_LIFECYCLE: ' + JSON.stringify(JSON_COLS_LIFECYCLE));
  Logger.log('sales_actualが含まれるか: ' + JSON_COLS_LIFECYCLE.includes('sales_actual'));
  
  const obj = rowToObject_(headers, data[21], JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
  Logger.log('sales_actualはArray: ' + Array.isArray(obj.sales_actual));
}

function debugIsLaunched() {
  const cards = getAllCards_ProductLifecycle();
  const launched = cards.filter(c => c.is_launched === true);
  const withSales = cards.filter(c => c.is_launched === true && Array.isArray(c.sales_actual) && c.sales_actual.length > 0);
  Logger.log('全カード数: ' + cards.length);
  Logger.log('is_launched===true: ' + launched.length);
  Logger.log('sales_actualあり: ' + withSales.length);
  
  // 最初の販売中カードのsales_actualを確認
  if (launched.length > 0) {
    const first = launched[0];
    Logger.log('最初の販売中ASIN: ' + first.asin);
    Logger.log('sales_actualの型: ' + typeof first.sales_actual);
    Logger.log('sales_actualはArray: ' + Array.isArray(first.sales_actual));
  }
}

function debugCompare() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  Logger.log('headers長さ: ' + headers.length);
  Logger.log('data[1]長さ: ' + data[1].length);
  
  // getAllCards内と同じ処理
  const obj = rowToObject_(headers, data[1], JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
  Logger.log('data[1]のsales_actual: ' + typeof obj.sales_actual);
  
  // sales_actualがある行を直接確認
  const saIdx = headers.indexOf('sales_actual');
  for (let i = 1; i < Math.min(data.length, 30); i++) {
    if (data[i][saIdx]) {
      Logger.log(`行${i}: saIdx=${saIdx} 値=${String(data[i][saIdx]).slice(0,50)}`);
      const o = rowToObject_(headers, data[i], JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
      Logger.log(`行${i}: rowToObject後 sales_actualはArray: ${Array.isArray(o.sales_actual)}`);
      break;
    }
  }
}

function debugLandedCostLookup() {
  // reorder_history を読み込んでSKUキーマップを作成
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rPidIdx  = reorderHdrs.indexOf('product_id');
  const rDateIdx = reorderHdrs.indexOf('order_date');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  Logger.log('reorder_history 行数: ' + (reorderData.length - 1));
  Logger.log('sku列インデックス: ' + rSkuIdx);
  Logger.log('landed_cost列インデックス: ' + rCostIdx);

  const reorderByKey = {};
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx]  || '').trim();
    const pid  = String(reorderData[i][rPidIdx]  || '').trim();
    const date = reorderData[i][rDateIdx];
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (!cost) continue;
    const key = sku ? sku : ('pid:' + pid);
    if (!reorderByKey[key]) reorderByKey[key] = [];
    reorderByKey[key].push({ order_date: date, landed_cost_actual: cost });
  }

  Logger.log('原価マップのキー数: ' + Object.keys(reorderByKey).length);
  Logger.log('キー一覧（先頭10件）: ' + JSON.stringify(Object.keys(reorderByKey).slice(0, 10)));

  // sku_master を読んで transaction_history のSKUと照合
  const skuToAsin = buildSkuToAsinMap_();
  const txSheet   = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData    = txSheet.getDataRange().getValues();
  const txHdrs    = txData[0];
  const tSku      = txHdrs.indexOf('sku');
  const tDate     = txHdrs.indexOf('date');
  const tType     = txHdrs.indexOf('transaction_type');

  // 原価が取れないSKUを抽出（注文のみ・先頭20件）
  let noMatchCount = 0;
  const noMatchSkus = new Set();
  for (let i = 1; i < txData.length; i++) {
    const type = String(txData[i][tType] || '');
    if (type !== '注文') continue;
    const sku  = String(txData[i][tSku]  || '').trim();
    const date = txData[i][tDate];
    if (!sku) continue;
    const cost = getLandedCostAtDate_(sku, date, reorderByKey);
    if (!cost) {
      noMatchSkus.add(sku);
      noMatchCount++;
    }
  }

  Logger.log('原価が取れない注文件数: ' + noMatchCount);
  Logger.log('原価が取れないSKU一覧: ' + JSON.stringify([...noMatchSkus]));

  // 原価が取れないSKUのreorder_historyをチェック
  Logger.log('\n=== 原価が取れないSKUの詳細 ===');
  [...noMatchSkus].slice(0, 5).forEach(sku => {
    const inMap = reorderByKey[sku];
    Logger.log(`SKU: ${sku} → reorderByKeyに存在: ${!!inMap} / ASIN: ${skuToAsin[sku] || '未登録'}`);
    if (inMap) Logger.log(`  発注データ: ${JSON.stringify(inMap)}`);
  });
}

function debugReorderSkuCoverage() {
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const data  = sheet.getDataRange().getValues();
  const hdrs  = data[0];
  const skuIdx  = hdrs.indexOf('sku');
  const costIdx = hdrs.indexOf('landed_cost_actual');

  let withSku = 0, withoutSku = 0;
  const withoutSkuRows = [];

  for (let i = 1; i < data.length; i++) {
    const sku  = String(data[i][skuIdx]  || '').trim();
    const cost = Number(data[i][costIdx]) || 0;
    if (!cost) continue;
    if (sku) {
      withSku++;
    } else {
      withoutSku++;
      withoutSkuRows.push(`行${i+1}: product_id=${data[i][1]}`);
    }
  }

  Logger.log(`SKUあり: ${withSku}件`);
  Logger.log(`SKUなし: ${withoutSku}件`);
  Logger.log(`SKUなし行: ${JSON.stringify(withoutSkuRows.slice(0, 10))}`);
}

function debugSkuMismatch() {
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  // reorder_historyのSKUセット
  const reorderSkus = new Set();
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx] || '').trim();
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (sku && cost) reorderSkus.add(sku);
  }
  Logger.log('reorder_historyのSKU数: ' + reorderSkus.size);

  // transaction_historyの注文SKUセット
  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tType   = txHdrs.indexOf('transaction_type');

  const txSkus = new Set();
  for (let i = 1; i < txData.length; i++) {
    if (String(txData[i][tType]) !== '注文') continue;
    const sku = String(txData[i][tSku] || '').trim();
    if (sku) txSkus.add(sku);
  }
  Logger.log('transaction_historyの注文SKU数: ' + txSkus.size);

  // 両方に存在するSKU（マッチ）
  const matched = [...txSkus].filter(s => reorderSkus.has(s));
  Logger.log('マッチしたSKU数: ' + matched.length);

  // txにあってreorderにないSKU（原価が取れない）
  const onlyTx = [...txSkus].filter(s => !reorderSkus.has(s));
  Logger.log('txにあってreorderにないSKU数: ' + onlyTx.length);
  Logger.log('例（先頭10件）: ' + JSON.stringify(onlyTx.slice(0, 10)));

  // reorderにあってtxにないSKU（未販売または別SKU）
  const onlyReorder = [...reorderSkus].filter(s => !txSkus.has(s));
  Logger.log('reorderにあってtxにないSKU数: ' + onlyReorder.length);
  Logger.log('例（先頭10件）: ' + JSON.stringify(onlyReorder.slice(0, 10)));
}

function exportMissingSkus() {
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  const reorderSkus = new Set();
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx] || '').trim();
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (sku && cost) reorderSkus.add(sku);
  }

  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tType   = txHdrs.indexOf('transaction_type');
  const tAsin   = txHdrs.indexOf('asin');

  const skuToAsin = buildSkuToAsinMap_();

  // 未登録SKUをスプレッドシートに出力
  const ss = getSpreadsheet_();
  let outSheet = ss.getSheetByName('missing_skus');
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet('missing_skus');
  outSheet.getRange(1, 1, 1, 3).setValues([['sku', 'asin', '件数']]);

  const missing = {};
  for (let i = 1; i < txData.length; i++) {
    if (String(txData[i][tType]) !== '注文') continue;
    const sku  = String(txData[i][tSku]  || '').trim();
    const asin = String(txData[i][tAsin] || '').trim() || skuToAsin[sku] || '';
    if (!sku || reorderSkus.has(sku)) continue;
    if (!missing[sku]) missing[sku] = { asin, count: 0 };
    missing[sku].count++;
  }

  const rows = Object.entries(missing)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([sku, d]) => [sku, d.asin, d.count]);

  if (rows.length) {
    outSheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  Logger.log(`missing_skus シートに${rows.length}件出力しました`);
}

function debugSpecificSku() {
  const targetSku = 'Z1-OEHV-SMGO';
  
  // 1. reorder_historyに存在するか
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rDateIdx = reorderHdrs.indexOf('order_date');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  Logger.log('=== reorder_history ===');
  for (let i = 1; i < reorderData.length; i++) {
    const sku = String(reorderData[i][rSkuIdx] || '').trim();
    if (sku === targetSku) {
      Logger.log(`行${i+1}: date=${reorderData[i][rDateIdx]} cost=${reorderData[i][rCostIdx]}`);
      Logger.log(`  date型: ${typeof reorderData[i][rDateIdx]}`);
      Logger.log(`  dateのJSON: ${JSON.stringify(reorderData[i][rDateIdx])}`);
    }
  }

  // 2. transaction_historyに存在するか
  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tDate   = txHdrs.indexOf('date');
  const tType   = txHdrs.indexOf('transaction_type');

  Logger.log('=== transaction_history（先頭3件）===');
  let txCount = 0;
  for (let i = 1; i < txData.length; i++) {
    const sku  = String(txData[i][tSku]  || '').trim();
    const type = String(txData[i][tType] || '').trim();
    if (sku === targetSku && type === '注文') {
      Logger.log(`行${i+1}: date=${txData[i][tDate]} type=${type}`);
      Logger.log(`  date型: ${typeof txData[i][tDate]}`);
      Logger.log(`  dateのJSON: ${JSON.stringify(txData[i][tDate])}`);
      if (++txCount >= 3) break;
    }
  }

  // 3. getLandedCostAtDate_ で実際に逆引きできるか
  const reorderByKey = {};
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx]  || '').trim();
    const pid  = String(reorderData[i][1] || '').trim();
    const date = reorderData[i][rDateIdx];
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (!cost) continue;
    const key = sku ? sku : ('pid:' + pid);
    if (!reorderByKey[key]) reorderByKey[key] = [];
    reorderByKey[key].push({ order_date: date, landed_cost_actual: cost });
  }

  Logger.log('=== getLandedCostAtDate_ テスト ===');
  Logger.log('reorderByKey[targetSku]: ' + JSON.stringify(reorderByKey[targetSku]));

  // txの最初の注文日で逆引き
  for (let i = 1; i < txData.length; i++) {
    const sku  = String(txData[i][tSku]  || '').trim();
    const type = String(txData[i][tType] || '').trim();
    if (sku === targetSku && type === '注文') {
      const orderDate = txData[i][tDate];
      const result = getLandedCostAtDate_(targetSku, orderDate, reorderByKey);
      Logger.log(`注文日=${orderDate} → 逆引き結果: ${result}`);
      break;
    }
  }
}

function debugSalesActualForSku() {
  const targetSku = 'Z1-OEHV-SMGO';
  const skuToAsin = buildSkuToAsinMap_();
  const asin = skuToAsin[targetSku];
  Logger.log('ASIN: ' + asin);

  if (!asin) { Logger.log('sku_masterにASINがない'); return; }

  const lcSheet  = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData   = lcSheet.getDataRange().getValues();
  const lcHdrs   = lcData[0];
  const asinIdx  = lcHdrs.indexOf('asin');
  const saIdx    = lcHdrs.indexOf('sales_actual');
  const launchIdx = lcHdrs.indexOf('is_launched');

  for (let i = 1; i < lcData.length; i++) {
    if (String(lcData[i][asinIdx]).trim() !== asin) continue;
    Logger.log('is_launched: ' + lcData[i][launchIdx]);
    const saRaw = lcData[i][saIdx];
    Logger.log('sales_actual生値: ' + String(saRaw).slice(0, 200));
    if (saRaw) {
      const sa = JSON.parse(saRaw);
      sa.forEach(e => {
        Logger.log(`  period=${e.period} qty=${e.qty} net=${e.net} gross_profit=${e.gross_profit} cost_covered_qty=${e.cost_covered_qty}`);
      });
    }
    break;
  }
}

function debugPeriodSummaryForSku() {
  const targetSku  = 'Z1-OEHV-SMGO';
  const periodKey  = '2026-04';
  const skuToAsin  = buildSkuToAsinMap_();
  const asin       = skuToAsin[targetSku];
  Logger.log('ASIN: ' + asin);

  // reorderByKeyを構築
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rPidIdx  = reorderHdrs.indexOf('product_id');
  const rDateIdx = reorderHdrs.indexOf('order_date');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  const reorderByKey = {};
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx] || '').trim();
    const pid  = String(reorderData[i][rPidIdx] || '').trim();
    const date = reorderData[i][rDateIdx];
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (!cost) continue;
    const key = sku ? sku : ('pid:' + pid);
    if (!reorderByKey[key]) reorderByKey[key] = [];
    reorderByKey[key].push({ order_date: date, landed_cost_actual: cost });
  }

  // transaction_historyからこのSKUの注文を集計
  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tDate   = txHdrs.indexOf('date');
  const tType   = txHdrs.indexOf('transaction_type');
  const tNet    = txHdrs.indexOf('net');
  const tPeriod = txHdrs.indexOf('period_key');
  const tQty    = txHdrs.indexOf('qty');

  let totalQty = 0, totalNet = 0, totalCost = 0, coveredQty = 0;
  for (let i = 1; i < txData.length; i++) {
    const sku    = String(txData[i][tSku]    || '').trim();
    const type   = String(txData[i][tType]   || '').trim();
    const period = String(txData[i][tPeriod] || '').trim();
    if (sku !== targetSku || type !== '注文' || period !== periodKey) continue;

    const date = txData[i][tDate];
    const qty  = Number(txData[i][tQty]) || 0;
    const net  = Number(txData[i][tNet]) || 0;
    const cost = getLandedCostAtDate_(targetSku, date, reorderByKey);

    totalQty += qty;
    totalNet += net;
    if (cost > 0) {
      totalCost  += cost * qty;
      coveredQty += qty;
    }
    Logger.log(`  date=${date} qty=${qty} net=${net} cost=${cost}`);
  }

  Logger.log(`合計: qty=${totalQty} net=${totalNet} coveredQty=${coveredQty} totalCost=${totalCost}`);
  const grossProfit = coveredQty > 0
    ? Math.round(totalNet * (coveredQty / totalQty) - totalCost) : null;
  Logger.log(`粗利計算結果: ${grossProfit}`);
  Logger.log(`asinSummaryに含まれるか: ASIN=${asin}`);
}

function debugPeriodSummaryResult() {
  const periodKey = '2026-04';
  const result = getPeriodSummary(periodKey);
  
  // Z1-OEHV-SMGO のASIN = B0FS7PH1XN を探す
  const target = result.products.find(p => p.asin === 'B0FS7PH1XN');
  if (target) {
    Logger.log('found: ' + JSON.stringify(target));
  } else {
    Logger.log('B0FS7PH1XN が products に存在しない');
    Logger.log('products数: ' + result.products.length);
    Logger.log('先頭3件のASIN: ' + result.products.slice(0,3).map(p=>p.asin).join(', '));
  }
}

function debugCostAfterFill() {
  // reorder_historyのSKUキー数を確認
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

  const reorderByKey = {};
  for (let i = 1; i < reorderData.length; i++) {
    const sku  = String(reorderData[i][rSkuIdx] || '').trim();
    const cost = Number(reorderData[i][rCostIdx]) || 0;
    if (sku && cost) reorderByKey[sku] = cost;
  }
  Logger.log('reorder_historyのSKUキー数: ' + Object.keys(reorderByKey).length);

  // transaction_historyで原価が取れるSKU数を確認
  const txSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData  = txSheet.getDataRange().getValues();
  const txHdrs  = txData[0];
  const tSku    = txHdrs.indexOf('sku');
  const tType   = txHdrs.indexOf('transaction_type');

  const txSkus = new Set();
  const matched = new Set();
  for (let i = 1; i < txData.length; i++) {
    if (String(txData[i][tType]) !== '注文') continue;
    const sku = String(txData[i][tSku] || '').trim();
    if (!sku) continue;
    txSkus.add(sku);
    if (reorderByKey[sku]) matched.add(sku);
  }

  Logger.log('取引SKU数: ' + txSkus.size);
  Logger.log('原価マッチ数: ' + matched.size);
  Logger.log('未マッチSKU例: ' + JSON.stringify([...txSkus].filter(s => !reorderByKey[s]).slice(0, 5)));
}

function debugReorderHeaders() {
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('実際のヘッダー数: ' + headers.length);
  Logger.log('ヘッダー: ' + JSON.stringify(headers));
  Logger.log('REQUIRED_HEADERS_REORDER数: ' + REQUIRED_HEADERS_REORDER.length);
  Logger.log('REQUIRED: ' + JSON.stringify(REQUIRED_HEADERS_REORDER));
}

function initializeBoxData() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_BOXES);
  if (!sheet) {
    Logger.log('home_inventory_boxes シートが見つかりません。setupBoxSheets() を先に実行してください。');
    return;
  }

  const now = new Date().toISOString();
  const rows = [];

  // 自宅 HOME-001 〜 HOME-030
  for (let i = 1; i <= 30; i++) {
    rows.push([
      `HOME-${String(i).padStart(3, '0')}`,
      '自宅',
      '',
      now
    ]);
  }

  // 加瀬トランクルーム KASE-001 〜 KASE-010
  for (let i = 1; i <= 10; i++) {
    rows.push([
      `KASE-${String(i).padStart(3, '0')}`,
      '加瀬トランクルーム',
      '',
      now
    ]);
  }

  // ハローコンテナ HELLO-001 〜 HELLO-010
  for (let i = 1; i <= 10; i++) {
    rows.push([
      `HELLO-${String(i).padStart(3, '0')}`,
      'ハローコンテナ',
      '',
      now
    ]);
  }

  sheet.getRange(2, 1, rows.length, 4).setValues(rows);

  Logger.log(`初期データ登録完了: ${rows.length}件`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `HOME 30個・KASE 10個・HELLO 10個、合計${rows.length}個の折コンを登録しました。`,
    '✅ 完了', 5
  );
}

function addVariantColumns() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  if (!sheet) { Logger.log('product_lifecycle シートが見つかりません'); return; }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const toAdd = [];
  if (!headers.includes('subtitle'))    toAdd.push('subtitle');
  if (!headers.includes('parent_asin')) toAdd.push('parent_asin');

  if (!toAdd.length) {
    Logger.log('列は既に存在します。');
    SpreadsheetApp.getActiveSpreadsheet().toast('subtitle・parent_asin列は既に存在します。', '確認', 3);
    return;
  }

  const lastCol = sheet.getLastColumn();
  toAdd.forEach((col, i) => {
    sheet.getRange(1, lastCol + i + 1).setValue(col)
      .setBackground('#1c1c21').setFontColor('#e8d5a3').setFontWeight('bold');
  });

  Logger.log(`追加しました: ${toAdd.join(', ')}`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${toAdd.join('・')}列を追加しました。`,
    '✅ 完了', 5
  );
}

function debugGetBoxItems() {
  const result = getBoxItems('HOME-002');
  Logger.log(JSON.stringify(result));
}

function resetBoxItemsHeaders() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_BOX_ITEMS);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(SHEET_BOX_ITEMS);

  const headers = [
    'id', 'box_id', 'fnsku', 'asin', 'free_label',
    'product_name', 'qty', 'updated_at'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  // REQUIRED_HEADERS_BOX_ITEMS も更新が必要
  Logger.log('home_inventory_items を再作成しました。');
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'home_inventory_items を再作成しました。',
    '✅ 完了', 5
  );
}

function debugLastPost() {
  // doPostのbody解析をテスト
  const testBody = {
    action: 'recordBoxMovement',
    boxId: 'HOME-001',
    identifier: { fnsku: '', asin: 'B0FS7PH1XN', free_label: '', product_name: 'テスト' },
    type: 'inbound',
    qty: 1,
    memo: ''
  };
  
  // recordBoxMovementを直接呼ぶ
  const result = recordBoxMovement(
    testBody.boxId,
    testBody.identifier,
    testBody.type,
    testBody.qty,
    testBody.memo
  );
  Logger.log(JSON.stringify(result));
}

function debugPeriodSummaryQuick() {
  const result = getPeriodSummary('2026-05');
  Logger.log('products数: ' + result.products.length);
  Logger.log('totalNet: ' + result.summary.totalNet);
  if (result.products.length > 0) {
    Logger.log('先頭商品: ' + JSON.stringify(result.products[0]));
  }
}

function debugApiKey() {
  const key = getApiKey_();
  Logger.log('API_KEY長さ: ' + key.length);
  Logger.log('API_KEY先頭3文字: ' + key.slice(0, 3));
}

function debugApiKeyFull() {
  const key = getApiKey_();
  Logger.log('API_KEY全文: ' + key);
}

function addKeepaDataColumn() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName('product_lifecycle');
  if (!sheet) { Logger.log('シートが見つかりません'); return; }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  if (headers.includes('keepa_data')) {
    Logger.log('keepa_data列は既に存在します');
    return;
  }

  const newCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, newCol).setValue('keepa_data');
  Logger.log('keepa_data列を追加しました: ' + newCol + '列目');
}
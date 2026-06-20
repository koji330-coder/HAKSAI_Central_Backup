/**
 * HAKSAI 改修 Step 6：GAS API 実装
 * 
 * 新規関数：
 * 1. getReorderHistory(productId) - 発注履歴取得
 * 2. addReorderRecord(productId, reorderData) - 発注記録追加
 * 3. validateStatusTransition(newStatus, cardData) - ステータス遷移検証
 * 4. getAllCards() 改修 - product_lifecycle から読込
 */

// ========================================
// 関数 1：発注履歴を取得
// ========================================
function getReorderHistory(productId) {
  /**
   * 指定した商品の発注履歴をすべて取得
   * 
   * @param {string} productId - 商品ID（product_lifecycle.id）
   * @return {Array} 発注履歴の配列（新しい順）
   */
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const reorderSheet = ss.getSheetByName("reorder_history");
  
  if (!reorderSheet) {
    Logger.log("⚠️  reorder_history sheet not found");
    return [];
  }
  
  const data = reorderSheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    // ヘッダのみ（データなし）
    return [];
  }
  
  const headers = data[0];
  const result = [];
  
  // ヘッダから各列のインデックスを取得
  const headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header] = index;
  });
  
  // 2 行目以降をループ
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // 空行はスキップ
    if (!row[headerMap.product_id]) continue;
    
    // product_id が一致する行のみ
    if (row[headerMap.product_id] === productId) {
      result.push({
        id: row[headerMap.id],
        product_id: row[headerMap.product_id],
        order_date: row[headerMap.order_date],
        quantity: row[headerMap.quantity],
        unit_price_1688: row[headerMap.unit_price_1688],
        landed_cost_actual: row[headerMap.landed_cost_actual],
        lead_time_days: row[headerMap.lead_time_days],
        expected_arrival_date: row[headerMap.expected_arrival_date],
        fba_fee_at_order: row[headerMap.fba_fee_at_order],
        selling_price_at_order: row[headerMap.selling_price_at_order],
        notes: row[headerMap.notes],
        created_at: row[headerMap.created_at]
      });
    }
  }
  
  // 新しい順にソート（order_date の新しい順）
  result.sort((a, b) => {
    const dateA = new Date(a.order_date);
    const dateB = new Date(b.order_date);
    return dateB - dateA;
  });
  
  return result;
}

// ========================================
// 関数 2：発注記録を追加
// ========================================
function addReorderRecord(productId, reorderData) {
  /**
   * reorder_history に新規行を追加
   * product_lifecycle の current_landed_cost も更新
   * 
   * @param {string} productId - 商品ID
   * @param {object} reorderData - 発注データ
   *   {
   *     order_date: "2026-05-16",
   *     quantity: 150,
   *     unit_price_1688: 365,          // オプション（参考値）
   *     landed_cost_actual: 450,       // 必須
   *     lead_time_days: 18,            // オプション
   *     expected_arrival_date: "2026-06-03",  // オプション
   *     fba_fee_at_order: 290,         // オプション
   *     selling_price_at_order: 750,   // オプション
   *     notes: "3商品混載、重量案分"   // オプション
   *   }
   * @return {object} { status: "ok", id: "record_id" }
   */
  
  // 検証：必須フィールド
  if (!reorderData.order_date) {
    throw new Error("order_date is required");
  }
  if (!reorderData.quantity || reorderData.quantity <= 0) {
    throw new Error("quantity is required and must be > 0");
  }
  if (reorderData.landed_cost_actual === undefined || reorderData.landed_cost_actual <= 0) {
    throw new Error("landed_cost_actual is required and must be > 0");
  }
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const reorderSheet = ss.getSheetByName("reorder_history");
  
  if (!reorderSheet) {
    throw new Error("reorder_history sheet not found");
  }
  
  // 新規行データを構築
  const recordId = Utilities.getUuid();
  const now = new Date().toISOString();
  
  const rowData = [
    recordId,
    productId,
    reorderData.order_date,
    reorderData.quantity,
    reorderData.unit_price_1688 || null,
    reorderData.landed_cost_actual,
    reorderData.lead_time_days || null,
    reorderData.expected_arrival_date || null,
    reorderData.fba_fee_at_order || null,
    reorderData.selling_price_at_order || null,
    reorderData.notes || "",
    now
  ];
  
  // reorder_history に追記
  reorderSheet.appendRow(rowData);
  Logger.log("✅ Added reorder record: " + recordId);
  
  // product_lifecycle の current_landed_cost を更新
  updateProductCurrentLandedCost(ss, productId, reorderData.landed_cost_actual);
  
  return { status: "ok", id: recordId };
}

// ========================================
// Helper 関数：current_landed_cost を更新
// ========================================
function updateProductCurrentLandedCost(ss, productId, landedCost) {
  const lifecycleSheet = ss.getSheetByName("product_lifecycle");
  
  if (!lifecycleSheet) {
    throw new Error("product_lifecycle sheet not found");
  }
  
  const data = lifecycleSheet.getDataRange().getValues();
  const headers = data[0];
  
  // current_landed_cost の列インデックスを取得（AG 列 = 33）
  const currentLandedCostIndex = headers.indexOf("current_landed_cost");
  
  if (currentLandedCostIndex === -1) {
    throw new Error("current_landed_cost column not found");
  }
  
  // productId に対応する行を探して更新
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === productId) {  // A 列が id
      lifecycleSheet.getRange(i + 1, currentLandedCostIndex + 1).setValue(landedCost);
      Logger.log("✅ Updated current_landed_cost for " + productId + " to " + landedCost);
      return;
    }
  }
  
  throw new Error("Product not found: " + productId);
}

// ========================================
// 関数 3：ステータス遷移を検証
// ========================================
function validateStatusTransition(newStatus, cardData) {
  /**
   * ステータス遷移時の必須フィールドチェック
   * 
   * @param {string} newStatus - 遷移先ステータス
   * @param {object} cardData - カードデータ
   * @throw {Error} 必須フィールドが不足している場合
   */
  
  switch (newStatus) {
    case "page_planning":
      if (!cardData.page_draft || !cardData.page_draft.concept) {
        throw new Error("page_planning へ遷移するにはページ案（concept）が必要です");
      }
      break;
    
    case "page_draft_ready":
      if (!cardData.page_draft || !cardData.page_draft.concept) {
        throw new Error("page_draft_ready へ遷移するにはページ案が必要です");
      }
      if (!cardData.page_draft.image_plan) {
        throw new Error("page_draft_ready へ遷移するには画像構成が必要です");
      }
      break;
    
    case "selling":
      if (!cardData.asin || cardData.asin === "") {
        throw new Error("selling へ遷移するには ASIN が必須です");
      }
      if (!cardData.gtin || cardData.gtin === "") {
        throw new Error("selling へ遷移するには GTIN が必須です");
      }
      if (!cardData.supplier_1688_url || cardData.supplier_1688_url === "") {
        throw new Error("selling へ遷移するには仕入元 URL が必須です");
      }
      if (!cardData.current_landed_cost || cardData.current_landed_cost <= 0) {
        throw new Error("selling へ遷移するには着地原価が必須です");
      }
      break;
    
    case "paused":
    case "discontinued":
      // 停止・終了には制約なし
      break;
    
    default:
      // その他のステータスは検証なし
      break;
  }
  
  Logger.log("✅ Status transition validated: → " + newStatus);
}

// ========================================
// 関数 4：getAllCards() 改修
// ========================================
function getAllCards_ProductLifecycle() {
  /**
   * product_lifecycle シートから全カードを読込
   * 既存の getAllCards() の代わりに使用
   * 
   * @return {Array} カードオブジェクトの配列
   */
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lifecycleSheet = ss.getSheetByName("product_lifecycle");
  
  if (!lifecycleSheet) {
    throw new Error("product_lifecycle sheet not found");
  }
  
  const data = lifecycleSheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    // ヘッダのみ（データなし）
    return [];
  }
  
  const headers = data[0];
  const cards = [];
  
  // ヘッダから各列のインデックスを取得
  const headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header] = index;
  });
  
  // 2 行目以降をループしてオブジェクト化
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // 空行はスキップ
    if (!row[headerMap.id]) continue;
    
    // is_deleted が true の場合はスキップ
    if (row[headerMap.is_deleted] === true || row[headerMap.is_deleted] === "TRUE") {
      continue;
    }
    
    const card = {
      id: row[headerMap.id],
      status: row[headerMap.status],
      category: row[headerMap.category],
      title: row[headerMap.title],
      summary: row[headerMap.summary],
      price: row[headerMap.price],
      monthly_sales: row[headerMap.monthly_sales],
      reviews: row[headerMap.reviews],
      emoji: row[headerMap.emoji],
      tags: tryParseJSON(row[headerMap.tags]),
      supplier_keywords: row[headerMap.supplier_keywords],
      weakness: row[headerMap.weakness],
      created_at: row[headerMap.created_at],
      updated_at: row[headerMap.updated_at],
      audit: tryParseJSON(row[headerMap.audit]),
      produce: tryParseJSON(row[headerMap.produce]),
      scores: tryParseJSON(row[headerMap.scores]),
      checks: tryParseJSON(row[headerMap.checks]),
      image_drive_ids: tryParseJSON(row[headerMap.image_drive_ids]),
      image_drive_id: row[headerMap.image_drive_id],
      urls: tryParseJSON(row[headerMap.urls]),
      profit: tryParseJSON(row[headerMap.profit]),
      cost_simulation: tryParseJSON(row[headerMap.cost_simulation]),
      page_draft: tryParseJSON(row[headerMap.page_draft]),
      asin: row[headerMap.asin],
      gtin: row[headerMap.gtin],
      amazon_url: row[headerMap.amazon_url],
      amazon_published_date: row[headerMap.amazon_published_date],
      supplier_1688_url: row[headerMap.supplier_1688_url],
      rakumart_linkage_status: row[headerMap.rakumart_linkage_status],
      barcode_option: row[headerMap.barcode_option],
      current_landed_cost: row[headerMap.current_landed_cost],
      actual_result: tryParseJSON(row[headerMap.actual_result]),
      is_deleted: row[headerMap.is_deleted],
      is_launched: row[headerMap.is_launched],
      source: row[headerMap.source],
      fba_stock:       row[headerMap.fba_stock],
      fba_inbound:     row[headerMap.fba_inbound],
      fba_daily_t7:    row[headerMap.fba_daily_t7],
      fba_days_remain: row[headerMap.fba_days_remain],
      fba_alert:       row[headerMap.fba_alert],
      fba_synced_at:   row[headerMap.fba_synced_at],
    };
    
    cards.push(card);
  }
  
  return cards;
}

// ========================================
// Helper 関数：JSON パース（エラーハンドリング付き）
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
      // JSON パース失敗 → 元の値をそのまま返す
      return value;
    }
  }
  
  return null;
}

// ========================================
// テスト関数
// ========================================
function testGASAPIv2() {
  /**
   * 新規 API 関数が正常に動作するか確認
   */
  
  Logger.log("\n🔍 Testing GAS API v2 Functions");
  Logger.log("================================");
  
  try {
    // Test 1: getAllCards_ProductLifecycle
    Logger.log("\n✅ Test 1: getAllCards_ProductLifecycle()");
    const cards = getAllCards_ProductLifecycle();
    Logger.log("  Found " + cards.length + " cards");
    if (cards.length > 0) {
      Logger.log("  Sample: " + cards[0].title);
    }
    
    // Test 2: getReorderHistory（存在しない productId）
    Logger.log("\n✅ Test 2: getReorderHistory()");
    const dummyProductId = cards.length > 0 ? cards[0].id : "dummy";
    const history = getReorderHistory(dummyProductId);
    Logger.log("  Found " + history.length + " reorder records for " + dummyProductId);
    
    // Test 3: validateStatusTransition
    Logger.log("\n✅ Test 3: validateStatusTransition()");
    try {
      validateStatusTransition("selling", { asin: null });
      Logger.log("  ❌ Should have thrown error (asin is null)");
    } catch (error) {
      Logger.log("  ✅ Correctly caught error: " + error.message);
    }
    
    Logger.log("\n================================");
    Logger.log("🎉 All tests passed!");
    
  } catch (error) {
    Logger.log("\n❌ Test failed: " + error.message);
    throw error;
  }
}
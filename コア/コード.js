// ============================================
// HAKSAI Research Deck - バックエンドAPI (v6)
// product_lifecycle をメインテーブルとして運用
// https://koji330-coder.github.io/HAKSAI-Reserch-3/
// ============================================

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
}

const PROPS = PropertiesService.getScriptProperties();
const GEMINI_API_KEY = PROPS.getProperty('GEMINI_API_KEY');
const DRIVE_FOLDER_ID = PROPS.getProperty('DRIVE_FOLDER_ID');
const SPREADSHEET_ID = PROPS.getProperty('SPREADSHEET_ID');
const GEMINI_MODEL = PROPS.getProperty('GEMINI_MODEL') || 'gemini-3.1-flash-lite';

const SHEET_CARDS = 'cards';
const SHEET_PAGE_PROJECTS = 'page_projects';

// 新規シート（v6）
const SHEET_PRODUCT_LIFECYCLE = 'product_lifecycle';
const SHEET_REORDER_HISTORY = 'reorder_history';

// 変更後
const REQUIRED_HEADERS_LIFECYCLE = [
  'id', 'status', 'category', 'title', 'subtitle', 'parent_asin', 'summary', 'price', 'monthly_sales', 'reviews', 'emoji', 'tags',
  'supplier_keywords', 'weakness', 'created_at', 'updated_at',
  'audit', 'produce', 'scores', 'checks', 'image_drive_ids', 'image_drive_id', 'urls',
  'supplier_keywords_json', 'profit', 'cost_simulation', 'page_draft',
  'asin', 'gtin', 'amazon_url', 'amazon_published_date',
  'supplier_1688_url', 'rakumart_linkage_status', 'barcode_option',
  'current_landed_cost', 'actual_result', 'is_deleted', 'is_launched', 'source',
  'fba_stock', 'fba_inbound', 'fba_daily_t7', 'fba_days_remain', 'fba_alert', 'fba_synced_at', 'sales_actual',
  'idea_tags_json', 'idea_tags_updated_at', 'idea_tags_source' , 'keepa_data' // ← 追加
];

const JSON_COLS_LIFECYCLE = [
  'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
  'image_drive_ids', 'profit', 'cost_simulation', 'page_draft', 'actual_result', 'sales_actual',
  'idea_tags_json' , 'keepa_data' // ← 追加
];

const OBJECT_JSON_COLS_LIFECYCLE = [
  'audit', 'produce', 'scores', 'checks', 'profit', 'cost_simulation', 'page_draft', 'actual_result'
];

const BOOLEAN_COLS_LIFECYCLE = ['is_deleted', 'is_launched'];

const REQUIRED_HEADERS_REORDER = [
  'id', 'product_id', 'sku', 'order_date', 'quantity',
  'unit_price_1688', 'landed_cost_actual',
  'lead_time_days', 'expected_arrival_date',
  'fba_fee_at_order', 'selling_price_at_order',
  'notes', 'created_at'
];

const JSON_COLS_CARDS = [
  'tags', 'urls', 'checks', 'profit', 'audit', 'produce',
  'supplier_keywords', 'actual_result', 'scores', 'score_breakdown',
  'research_tasks', 'competitor_data', 'cost_simulation',
  'amazon_page_plan', 'image_drive_ids'
];

const OBJECT_JSON_COLS_CARDS = [
  'profit', 'audit', 'produce', 'actual_result', 'scores', 'score_breakdown',
  'competitor_data', 'cost_simulation', 'amazon_page_plan'
];

const BOOLEAN_COLS_CARDS = ['is_deleted', 'is_launched'];

const REQUIRED_HEADERS_CARDS = [
  'id', 'status', 'category', 'title', 'summary', 'price', 'monthly_sales', 'reviews',
  'emoji', 'tags', 'supplier_keywords', 'weakness', 'audit', 'produce', 'checks',
  'urls', 'profit', 'scores', 'research_tasks', 'competitor_data', 'cost_simulation',
  'amazon_page_plan', 'image_drive_ids', 'image_drive_id', 'source', 'is_deleted',
  'is_launched', 'actual_result', 'created_at', 'updated_at'
];

const JSON_COLS_PAGE = [
  'tags', 'supplier_keywords', 'image_drive_ids', 'urls', 'extra_image_ids',
  'extra_texts', 'page_draft', 'import_decision'
];

const OBJECT_JSON_COLS_PAGE = ['extra_texts', 'page_draft', 'import_decision'];
const BOOLEAN_COLS_PAGE = [];

const REQUIRED_HEADERS_PAGE = [
  'id', 'source_card_id', 'status', 'title', 'category', 'summary', 'price', 'monthly_sales', 'reviews',
  'tags', 'supplier_keywords', 'weakness', 'diff', 'image_drive_ids', 'urls',
  'extra_image_ids', 'extra_texts', 'page_draft', 'memo', 'import_decision', 'initial_order_qty', 'created_at', 'updated_at'
];

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function getSpreadsheet_() {
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID が未設定です。');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheetByName_(sheetName, requiredHeaders) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
  }
  return sheet;
}

function getHeaders_(sheet, requiredHeaders) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].filter(String);
  if (headers.length === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return requiredHeaders.slice();
  }
  return headers;
}

function defaultJsonValue_(header, objectCols) {
  return objectCols.includes(header) ? {} : [];
}

function normalizeBool_(val) {
  return val === true || val === 'TRUE' || val === 'true' || val === 1 || val === '1';
}

function buildRowFromHeaders_(headers, data, jsonCols, objectCols, boolCols) {
  const obj = data || {};
  return headers.map(h => {
    const val = obj[h];
    if (jsonCols.includes(h)) return JSON.stringify(val !== undefined && val !== null ? val : defaultJsonValue_(h, objectCols));
    if (boolCols.includes(h)) return !!val;
    return val !== undefined && val !== null ? val : '';
  });
}

function rowToObject_(headers, row, jsonCols, objectCols, boolCols) {
  const obj = {};
  headers.forEach((h, idx) => {
    const val = row[idx];
    if (jsonCols.includes(h)) {
      try {
        obj[h] = val ? JSON.parse(val) : defaultJsonValue_(h, objectCols);
      } catch (e) {
        obj[h] = defaultJsonValue_(h, objectCols);
      }
    } else if (boolCols.includes(h)) {
      obj[h] = normalizeBool_(val);
    } else {
      obj[h] = val;
    }
  });
  return obj;
}

function ensureHeaders_(sheetName, requiredHeaders) {
  const sheet = getSheetByName_(sheetName, requiredHeaders);
  const headers = getHeaders_(sheet, requiredHeaders);
  let added = 0;
  requiredHeaders.forEach(h => {
    if (!headers.includes(h)) {
      sheet.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
      added++;
    }
  });
  return added;
}

function migrateDatabase() {
  const addedCards = ensureHeaders_(SHEET_CARDS, REQUIRED_HEADERS_CARDS);
  const addedPages = ensureHeaders_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  Logger.log(`cards: ${addedCards}列追加 / page_projects: ${addedPages}列追加`);
}

// ============================================
// GET
// ============================================
function doGet(e) {
  const body = parseBody_(e);  // ← parseBodyを先に呼ぶ
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action === 'getCards') return jsonResponse({ status: 'ok', cards: getAllCards_ProductLifecycle() });
    if (action === 'getPageProjects') return jsonResponse({ status: 'ok', pageProjects: getAllPageProjects() });
    if (action === 'getFilterButtons') {
      return jsonResponse({ status: 'ok', buttons: getFilterButtons() });
    }
    if (action === 'getPeriodSummary') {
      const periodKey = e.parameter.periodKey || '';
      return jsonResponse({ status: 'ok', data: getPeriodSummary(periodKey) });
    }

    if (action === 'getAvailablePeriods') {
      return jsonResponse({ status: 'ok', periods: getAvailablePeriods() });
    }

    if (action === 'getInventoryAlerts') {
      return jsonResponse({ status: 'ok', data: getInventoryAlerts() });
    }

    if (action === 'debugLastInventory') {
      const ss = getSpreadsheet_();
      const sheet = ss.getSheetByName('sku_master');
      const data = sheet.getDataRange().getValues();
      return jsonResponse({ 
        status: 'ok', 
        skuMasterRows: data.length,
        skuMasterSample: data.slice(0, 3)
      });
    }

    if (action === 'getBoxItems') {
      const boxId = e.parameter.boxId || '';
      return jsonResponse({ status: 'ok', items: getBoxItems(boxId) });
    }

    if (action === 'getBoxList') {
      const sheet = getSheetByName_(SHEET_BOXES, REQUIRED_HEADERS_BOXES);
      const data  = sheet.getDataRange().getValues();
      const hdrs  = data[0];
      const boxes = data.slice(1)
        .filter(row => row[0])
        .map(row => ({
          box_id:   row[hdrs.indexOf('box_id')],
          location: row[hdrs.indexOf('location')],
          memo:     row[hdrs.indexOf('memo')],
        }));
      return jsonResponse({ status: 'ok', boxes });
    }

    if (action === 'getAsinToFnskuMap') {
      return jsonResponse({ status: 'ok', map: getAsinToFnskuMap() });
    }

    if (action === 'getRecentTransactionsByAsin') {
      const asin = e.parameter.asin || '';
      const days = e.parameter.days || 30;
      if (!asin) return jsonResponse({ status: 'error', message: 'asin required' });
      const result = getRecentTransactionsByAsin(asin, days);
      return jsonResponse({ status: 'ok', rows: result.rows, landedCost: result.landedCost, totalQty: result.totalQty, days: result.days });
    }

    // doGet内に追加
    if (action === 'getCategories' || action === 'getSchedule') {
      return jsonResponse(doGetKeepa(action, e.parameter));
    }

    if (action === 'getKeepaCategories') {
      const keyword = e.parameter.keyword || '';
      return jsonResponse({ status: 'ok', data: getKeepaCategories(keyword) });
    }
    if (action === 'getKeepaSchedule') {
      return jsonResponse({ status: 'ok', data: getKeepaSchedule() });
    }

    if (action === 'getImportStatus') {
      return jsonResponse({ status:'ok', data: getImportStatus() });
    }

    return jsonResponse({ status: 'ok', message: 'HAKSAI API v6 is running.' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message, stack: err.stack });
  }
}

// ============================================
// POST
// ============================================
function doPost(e) {
   const body = JSON.parse(e.postData.contents);
    try {
    const action = body.action;

    if (action === 'saveKeepaSchedule') {
      return jsonResponse(saveKeepaSchedule(body.subAction, body.data));
    }

    if (action === 'getReorderHistory') {
      const history = getReorderHistory(body.productId);
      return jsonResponse({ status: 'ok', data: history });
    }

    if (action === 'addReorderRecord') {
      const result = addReorderRecord(body.productId, body.reorderData);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'validateStatusTransition') {
      try {
        validateStatusTransition(body.newStatus, body.cardData);
        return jsonResponse({ status: 'ok' });
      } catch (err) {
        return jsonResponse({ status: 'error', message: err.message });
      }
    }

    if (action === 'analyze') {
      const result = analyzeWithGemini(body.images, body.memo, body.asin || '');
      return jsonResponse({ status: 'ok', data: result });
    }

    // ✅ v6: product_lifecycle に直接保存
    if (action === 'saveCard') {
      saveCardToLifecycle(body.cardData);
      return jsonResponse({ status: 'ok' });
    }

    // ✅ v6: product_lifecycle を直接更新
    if (action === 'updateCard') {
      const ok = updateCardInLifecycle(body.cardData);
      if (!ok) return jsonResponse({ status: 'error', message: '更新対象のカードが見つかりません。' });
      return jsonResponse({ status: 'ok' });
    }

    // ✅ v6: product_lifecycle から削除
    if (action === 'deleteCard') {
      const ok = deleteCardFromLifecycle(body.id);
      if (!ok) return jsonResponse({ status: 'error', message: '削除対象のカードが見つかりません。' });
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'createPageProject') {
      const project = createPageProjectFromCard(body.cardData || {});
      savePageProjectToSheet(project);
      return jsonResponse({ status: 'ok', data: project });
    }

    if (action === 'updatePageProject') {
      const projectData = body.projectData || {};
      const extraImages = body.extraImages || [];
      if (extraImages.length) {
        const newIds = saveImagesToDrive_(extraImages, projectData.id, 'page');
        projectData.extra_image_ids = (Array.isArray(projectData.extra_image_ids) ? projectData.extra_image_ids : []).concat(newIds);
      }
      const ok = updatePageProjectInSheet(projectData);
      if (!ok) return jsonResponse({ status: 'error', message: '更新対象のページ制作案件が見つかりません。' });
      return jsonResponse({ status: 'ok', data: projectData });
    }

    if (action === 'generatePageDraft') {
      const projectData = body.projectData || {};
      const extraImages = body.extraImages || [];
      const draft = generatePageDraft_(projectData, extraImages);
      projectData.page_draft = draft;
      projectData.updated_at = new Date().toISOString();
      if (extraImages.length) {
        const newIds = saveImagesToDrive_(extraImages, projectData.id, 'page');
        projectData.extra_image_ids = (Array.isArray(projectData.extra_image_ids) ? projectData.extra_image_ids : []).concat(newIds);
      }
      updatePageProjectInSheet(projectData);
      return jsonResponse({ status: 'ok', data: projectData });
    }

      if (action === 'syncInventory') {
    const result = syncInventoryFromReport(body.inventoryData || [], body.snapshotDate || '')
    return jsonResponse({ status: 'ok', data: result });
    }

      // doPost内に追加
    if (action === 'updateReorderRecord') {
      const result = updateReorderRecord(body.recordId, body.reorderData);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'bulkRegisterSellingProducts') {
      const result = bulkRegisterSellingProducts(body.products || []);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'syncTransactions') {
      const result = syncTransactions(body.transactions || [], body.periodCosts || [], body.periodKey || '');
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'saveComparisonReport') {
      const result = saveComparisonReport_(body.filename, body.content);
      return jsonResponse({ status: 'ok', data: result });
    }

    // 新しい形式
    if (body.action === 'recordBoxMovement') {
      return jsonResponse(recordBoxMovement(
        body.boxId, body.identifier, body.type, body.qty, body.memo
      ));
    }

    if (action === 'syncAdProductReport') {
          return jsonResponse({ status:'ok', data: syncAdProductReport(body.rows||[], body.rawBase64||'', body.filename||'') });
    }

    if (action === 'syncBusinessReport') {
          return jsonResponse({ status:'ok', data: syncBusinessReport(body.rows||[], body.dateFrom||'', body.dateTo||'', body.rawBase64||'', body.filename||'') });
    }

    if (action === 'setAlertSnooze') {
      const result = setAlertSnooze(body.asin, body.state, body.note || '');
      return jsonResponse({ status: 'ok', data: result });
    }

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message, stack: err.stack });
  }
}

// ============================================
// v6: product_lifecycle CRUD
// ============================================


function getAllCards_ProductLifecycle() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);

  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual', 'keepa_data'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result'
  ];
  const boolCols = ['is_deleted', 'is_launched'];

  // 一覧表示に不要な重いフィールドを除外
  const excludeCols = new Set([
    'keepa_data', 'audit', 'produce', 'checks',
    'page_draft', 'actual_result', 'image_drive_ids', 'description'
  ]);

  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const card = rowToObject_(headers, data[i], jsonCols, objectCols, boolCols);
    // 重いフィールドを削除
    excludeCols.forEach(col => delete card[col]);
    list.push(card);
  }
  return list;
}

function saveCardToLifecycle(cardData) {
  if (!cardData || !cardData.id) throw new Error('cardData.id がありません。');
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const now = new Date().toISOString();
  cardData.created_at = cardData.created_at || now;
  cardData.updated_at = cardData.updated_at || now;
  cardData.status = cardData.status || 'research';
  cardData.page_draft = cardData.page_draft || {};
  cardData.actual_result = cardData.actual_result || {};
  sheet.appendRow(buildRowFromHeaders_(headers, cardData, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE));
}

function updateCardInLifecycle(cardData) {
  if (!cardData || !cardData.id) throw new Error('cardData.id がありません。');
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  cardData.updated_at = new Date().toISOString();
  // page_draft など lifecycle 固有フィールドが未定義の場合は既存値を保持
  const row = buildRowFromHeaders_(headers, cardData, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(cardData.id)) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return true;
    }
  }
  return false;
}

function deleteCardFromLifecycle(id) {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ============================================
// v6: reorder_history
// ============================================
function getReorderHistory(productId) {
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_REORDER);
  const pidIdx = headers.indexOf('product_id');
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[pidIdx]) continue;
    if (String(row[pidIdx]) !== String(productId)) continue;
    result.push({
      id: row[headers.indexOf('id')],
      product_id: row[headers.indexOf('product_id')],
      order_date: row[headers.indexOf('order_date')],
      quantity: row[headers.indexOf('quantity')],
      unit_price_1688: row[headers.indexOf('unit_price_1688')],
      landed_cost_actual: row[headers.indexOf('landed_cost_actual')],
      lead_time_days: row[headers.indexOf('lead_time_days')],
      expected_arrival_date: row[headers.indexOf('expected_arrival_date')],
      fba_fee_at_order: row[headers.indexOf('fba_fee_at_order')],
      selling_price_at_order: row[headers.indexOf('selling_price_at_order')],
      notes: row[headers.indexOf('notes')],
      created_at: row[headers.indexOf('created_at')]
    });
  }

  result.sort((a, b) => new Date(b.order_date) - new Date(a.order_date));
  return result;
}

function addReorderRecord(productId, reorderData) {
  if (!reorderData.order_date) throw new Error('order_date is required');
  if (!reorderData.quantity || reorderData.quantity <= 0) throw new Error('quantity is required and must be > 0');
  if (!reorderData.landed_cost_actual || reorderData.landed_cost_actual <= 0) {
    throw new Error('landed_cost_actual is required and must be > 0');
  }

  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const recordId = Utilities.getUuid();
  const now = new Date().toISOString();

  sheet.appendRow([
    recordId,
    productId,
    reorderData.sku || '',  // ← 追加
    reorderData.order_date,
    reorderData.quantity,
    reorderData.unit_price_1688 || null,
    reorderData.landed_cost_actual,
    reorderData.lead_time_days || null,
    reorderData.expected_arrival_date || null,
    reorderData.fba_fee_at_order || null,
    reorderData.selling_price_at_order || null,
    reorderData.notes || '',
    now
  ]);

  updateProductCurrentLandedCost(productId, reorderData.landed_cost_actual);

  return { status: 'ok', id: recordId };
}

function updateProductCurrentLandedCost(productId, landedCost) {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const costIdx = headers.indexOf('current_landed_cost');
  if (costIdx === -1) throw new Error('current_landed_cost column not found');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(productId)) {
      sheet.getRange(i + 1, costIdx + 1).setValue(landedCost);
      return;
    }
  }
  throw new Error('Product not found: ' + productId);
}

function validateStatusTransition(newStatus, cardData) {
  switch (newStatus) {
    case 'page_planning':
      if (!cardData.page_draft || !cardData.page_draft.concept) {
        throw new Error('page_planning へ遷移するにはページ案（concept）が必要です');
      }
      break;
    case 'page_draft_ready':
      if (!cardData.page_draft || !cardData.page_draft.concept) {
        throw new Error('page_draft_ready へ遷移するにはページ案が必要です');
      }
      if (!cardData.page_draft.image_plan) {
        throw new Error('page_draft_ready へ遷移するには画像構成が必要です');
      }
      break;
    case 'selling':
      if (!cardData.asin) throw new Error('selling へ遷移するには ASIN が必須です');
      if (!cardData.gtin) throw new Error('selling へ遷移するには GTIN が必須です');
      if (!cardData.supplier_1688_url) throw new Error('selling へ遷移するには仕入元 URL が必須です');
      if (!cardData.current_landed_cost || cardData.current_landed_cost <= 0) {
        throw new Error('selling へ遷移するには着地原価が必須です');
      }
      break;
    default:
      break;
  }
}

// ============================================
// page_projects（v5 互換性保持）
// ============================================
function getAllPageProjects() {
  const sheet = getSheetByName_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_PAGE);
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    list.push(rowToObject_(headers, data[i], JSON_COLS_PAGE, OBJECT_JSON_COLS_PAGE, BOOLEAN_COLS_PAGE));
  }
  return list;
}

function savePageProjectToSheet(projectData) {
  if (!projectData || !projectData.id) throw new Error('projectData.id がありません。');
  const sheet = getSheetByName_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_PAGE);
  const now = new Date().toISOString();
  projectData.created_at = projectData.created_at || now;
  projectData.updated_at = projectData.updated_at || now;
  sheet.appendRow(buildRowFromHeaders_(headers, projectData, JSON_COLS_PAGE, OBJECT_JSON_COLS_PAGE, BOOLEAN_COLS_PAGE));
}

function updatePageProjectInSheet(projectData) {
  if (!projectData || !projectData.id) throw new Error('projectData.id がありません。');
  const sheet = getSheetByName_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_PAGE);
  projectData.updated_at = new Date().toISOString();
  const row = buildRowFromHeaders_(headers, projectData, JSON_COLS_PAGE, OBJECT_JSON_COLS_PAGE, BOOLEAN_COLS_PAGE);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(projectData.id)) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      // product_lifecycle の page_draft も同期更新
      if (projectData.source_card_id) {
        syncPageDraftToLifecycle(projectData.source_card_id, projectData.page_draft);
      }
      return true;
    }
  }
  return false;
}

function syncPageDraftToLifecycle(cardId, pageDraft) {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const pageDraftIndex = headers.indexOf('page_draft');
  if (pageDraftIndex === -1) return;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(cardId)) {
      sheet.getRange(i + 1, pageDraftIndex + 1).setValue(JSON.stringify(pageDraft || {}));
      Logger.log('✅ Synced page_draft to product_lifecycle for card: ' + cardId);
      return;
    }
  }
}

function createPageProjectFromCard(cardData) {
  if (!cardData || !cardData.id) throw new Error('元カード情報がありません。');
  const now = new Date().toISOString();
  return {
    id: Utilities.getUuid(),
    source_card_id: cardData.id,
    status: '構成前',
    title: cardData.title || '無題',
    category: cardData.category || '',
    summary: cardData.summary || '',
    price: cardData.price || '',
    monthly_sales: cardData.monthly_sales || '',
    reviews: cardData.reviews || '',
    tags: Array.isArray(cardData.tags) ? cardData.tags : [],
    supplier_keywords: Array.isArray(cardData.supplier_keywords) ? cardData.supplier_keywords : [],
    weakness: cardData.weakness || '',
    diff: cardData.produce && cardData.produce.diff ? cardData.produce.diff : (cardData.diff || ''),
    image_drive_ids: Array.isArray(cardData.image_drive_ids) ? cardData.image_drive_ids : [],
    urls: Array.isArray(cardData.urls) ? cardData.urls : [],
    extra_image_ids: [],
    extra_texts: {
      competitor_reviews: '',
      supplier_info: '',
      target_notes: '',
      free_memo: ''
    },
    page_draft: {
      concept: '',
      title_candidates: [],
      bullets: [],
      description: '',
      image_plan: [],
      backend_keywords: ''
    },
    memo: '',
    import_decision: {
      page_score: '',
      decision: '',
      reason: ''
    },
    initial_order_qty: '50',
    created_at: now,
    updated_at: now
  };
}

// ============================================
// Drive
// ============================================
function saveImagesToDrive_(images, baseId, prefix) {
  if (!DRIVE_FOLDER_ID || !images || images.length === 0) return [];
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    return images.map((img, idx) => {
      if (!img || !img.base64) return '';
      const bytes = Utilities.base64Decode(img.base64);
      const mimeType = img.mimeType || 'image/jpeg';
      const ext = mimeType.includes('png') ? 'png' : 'jpg';
      const safeName = (img.originalName || `image_${idx + 1}`).replace(/[\\/:*?"<>|]/g, '_');
      const blob = Utilities.newBlob(bytes, mimeType, `${prefix || 'img'}_${baseId}_${idx + 1}_${safeName}.${ext}`);
      const file = folder.createFile(blob);
      return file.getId();
    }).filter(Boolean);
  } catch (e) {
    Logger.log('Drive画像保存エラー: ' + e.message);
    return [];
  }
}

// ============================================
// Gemini 共通
// ============================================
function callGeminiWithRetry(payload) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY が未設定です。');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const MAX_RETRY = 4;
  const WAIT_MS = 5000;
  const RETRYABLE_CODES = [429, 500, 502, 503, 504];
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const text = response.getContentText();
    if (code === 200) return text;
    if (!RETRYABLE_CODES.includes(code)) throw new Error(`Gemini APIエラー(${code}): ${text}`);
    if (attempt === MAX_RETRY) throw new Error(`Gemini APIエラー(${code}): ${text}`);
    Utilities.sleep(WAIT_MS);
  }
  throw new Error('Gemini API呼び出しに失敗しました。');
}

function extractJson_(generatedText) {
  const raw = String(generatedText || '').trim();
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // ← ここでログを出す
    Logger.log('JSON parse failed. Length: ' + cleaned.length);
    Logger.log('First 500 chars: ' + cleaned.slice(0, 500));
    Logger.log('Last 500 chars: ' + cleaned.slice(-500));
    Logger.log('Around position 2287: ' + cleaned.slice(2200, 2400));

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('JSON抽出エラー: ' + cleaned.slice(0, 300));
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch(e2) {
      Logger.log('Second parse also failed: ' + e2.message);
      throw new Error('JSON抽出エラー: ' + cleaned.slice(0, 300));
    }
  }
}

// ============================================
// リサーチ分析
// ============================================
function analyzeWithGemini(images, memo, asin) {  // asinを追加
  const memoObj = typeof memo === 'string' ? { note: memo } : (memo || {});

  // Keepaデータ取得（失敗してもスキップ）
  const keepaData = asin ? tryGetKeepaData_(asin) : null;
  const keepaSection = keepaData ? `
【Keepaから取得した競合データ（ASIN: ${asin}）】
- 月販数: ${keepaData.monthlySold ?? '不明'}件/月
- 画像枚数: ${keepaData.imageCount}枚
- A+コンテンツ: ${keepaData.hasAplus ? 'あり' : 'なし'}
- ブランド: ${keepaData.brand ?? '不明'}
- bullet points（競合の訴求軸）:
${keepaData.features.length > 0
  ? keepaData.features.map((f, i) => `  ${i+1}. ${f}`).join('\n')
  : '  （取得できませんでした）'}
` : '';

  const memoText = `
【ユーザーの事前観察】
- 中国品っぽい: ${memoObj.china || '不明'}
- 最近のレビューあり: ${memoObj.recentReview || '未確認'}
- 広告競合の数: ${memoObj.adCompetitor || '未確認'}
- 月販数の目安: ${memoObj.monthlySales || '未確認'}
${memoObj.note ? `- メモ: ${memoObj.note}` : '- メモ: なし'}
${keepaSection}
`;

  const prompt = `あなたは、HAKSAIという「編集・図解」を強みとするAmazon物販ブランドの専属リサーチチームです。

${memoText}

以下の二人格で画像を分析し、JSON形式でのみ回答してください。

■ 人格1：【冷静な仕入れ審査官】
- 役割：データの裏付けとリスクの抽出。
- 思考：需要、競合の強さ、参入障壁、法的・規約リスクをシビアに判定。
- HAKSAI基準：月100個以上の需要があるか、競合レビューが強すぎないか、ノーブランド中で勝てるかを重視。

■ 人格2：【編集型ブランド・プロデューサー】
- 役割：勝てる見せ方の設計。
- 思考：説明すると強い、図解が効く、使い方や不満解消を見せられる商品かを評価。
- HAKSAI基準：画像とA+で差別化できる未充足ニーズを見つける。

出力JSONは必ず以下のキーを含めてください。読み取れない情報は「要調査」と記載してください。

{
  "category": "カテゴリ",
  "title": "商品名20字以内",
  "summary": "一言サマリー",
  "price": "競合価格または要調査",
  "monthly_sales": "月販数または要調査",
  "reviews": "レビュー件数または要調査",
  "emoji": "絵文字1つ",
  "tags": ["タグ1", "タグ2"],
  "supplier_keywords": ["1688検索用中国語KW1", "KW2"],
  "weakness": "競合の弱点または顧客の不満",
  "scores": {
    "market": 0,
    "profit": 0,
    "diff": 0,
    "risk": 0,
    "supply": 0,
    "fit": 0
  },
  "research_tasks": [
    {"task":"次に確認すること", "priority":"high/medium/low", "reason":"理由"}
  ],
  "cost_simulation": {
    "price": 0,
    "cost": 0,
    "rakumart": 0,
    "shipping": 0,
    "amazon": 0,
    "fba": 0,
    "ad": 0,
    "other": 0
  },
  "amazon_page_plan": {
    "main_image": "メイン画像方針",
    "scene_image": "使用シーン方針",
    "problem_solution": "課題解決画像方針",
    "how_to": "使い方画像方針",
    "benefits": ["メリット1", "メリット2", "メリット3"],
    "spec": "仕様・サイズ画像方針",
    "cross_sell": "クロスセルまたは拡張方針"
  },
  "audit": {
    "status": "go/check/wait/stop",
    "confidence": "high/medium/low",
    "commentary": "審査官の報告。市場動向、競合比較、参入リスクについて150文字以上で具体的に。",
    "checks": [
      {"text":"項目名", "icon":"◎/○/△/✗", "val":"根拠", "cls":"val-good/val-warn/val-bad"}
    ],
    "risk_flags": ["リスク1"],
    "next_actions": ["次の調査アクション1"]
  },
  // 変更後
  "produce": {
    "score": 7,
    "commentary": "プロデューサーの戦略。HAKSAIでどう見せるか、ターゲット再定義、図解すべきベネフィット、ページ構成コンセプトを200文字以上で具体的に。",
    "image_angles": ["具体的な画像構成案1", "案2", "案3"],
    "diff": "具体的差別化ポイント",
    "verdict": "判定結論"
  },
  "idea_tags_json": {
    "category": [],
    "use_scene": [],
    "customer": [],
    "season": [],
    "product_form": [],
    "price_band": "",
    "related_keywords": [],
    "risk_tags": [],
    "notes": ""
  }
}

この商品アイデアについて idea_tags_json も必ず出力してください。
ルール：
- 各配列は0〜5件程度
- 日本語で簡潔に
- 不明なものは無理に埋めすぎない
- season は "春夏", "秋冬", "通年" など
- price_band は "¥750優遇", "低単価", "通常FBA", "高単価" など
- notes は人間が確認するときの一言メモ（既存商品との関連があれば言及）
`;

  const parts = [];
  (images || []).forEach((img, idx) => {
    if (!img || !img.base64) return;
    parts.push({ text: `【参考画像${idx + 1}】` });
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.base64 } });
  });
  parts.push({ text: prompt });

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  };

  const text = callGeminiWithRetry(payload);
  const apiResponse = JSON.parse(text);
  if (!apiResponse.candidates || !apiResponse.candidates.length) throw new Error('Geminiの回答が空です。');
  const generatedText = apiResponse.candidates[0].content.parts[0].text;
  const cardData = extractJson_(generatedText);

  const now = new Date().toISOString();
  cardData.id = Utilities.getUuid();
  cardData.status = cardData.audit && cardData.audit.status ? cardData.audit.status : 'wait';
  cardData.source = 'Amazon';
  cardData.urls = cardData.urls || [];
  cardData.created_at = now;
  cardData.updated_at = now;
  cardData.is_deleted = false;
  cardData.is_launched = false;
  cardData.actual_result = {};
  cardData.checks = cardData.audit && cardData.audit.checks ? cardData.audit.checks : [];
  cardData.profit = cardData.cost_simulation || cardData.profit || {};
  cardData.diff = cardData.produce && cardData.produce.diff ? cardData.produce.diff : '';
  const imageIds = saveImagesToDrive_(images, cardData.id, 'card');
  // 変更後
  cardData.image_drive_ids = imageIds;
  cardData.image_drive_id = imageIds[0] || '';

  // idea_tags_json の後処理
  // Gemini出力失敗でもカード保存は止めない
  if (cardData.idea_tags_json && typeof cardData.idea_tags_json === 'object') {
    cardData.idea_tags_json = sanitizeIdeaTagsObject_(cardData.idea_tags_json);
    cardData.idea_tags_updated_at = now;
    cardData.idea_tags_source = 'research_gemini';
  } else {
    cardData.idea_tags_json = {};
    cardData.idea_tags_updated_at = '';
    cardData.idea_tags_source = '';
  }

  // Keepaデータをカードに保存
  if (keepaData) {
    cardData.keepa_data = {
      asin:        asin,
      monthlySold: keepaData.monthlySold,
      imageCount:  keepaData.imageCount,
      hasAplus:    keepaData.hasAplus,
      brand:       keepaData.brand,
      features:    keepaData.features,
    };
  } else {
    cardData.keepa_data = null;
  }

  return cardData;
}

// ============================================
// ページ制作AI生成
// ============================================
function generatePageDraft_(projectData, extraImages) {
  const p = projectData || {};
  const extraTexts = p.extra_texts || {};

  const prompt = `あなたはAmazon.co.jp向けの商品ページ制作に強いECコピーライター兼クリエイティブディレクターです。
HAKSAIは、ノーブランド中で勝つために「実用性重視」「画像で理解させる」「説明すると強い」商品ページを作ります。
過剰表現は避け、わかりやすさ・購入判断のしやすさを重視してください。

【最重要ルール：事実ベースで作成すること】
- 以下の入力情報に書かれていない仕様・機能・加工・品質向上は、勝手に追加しないこと。
- 未確認の内容は、断定せずに控えめな表現にするか、触れないこと。
- 特に以下は、入力情報に明記されていない限り書かないこと。
  - ブランドロゴ刻印
  - OEM・オリジナル加工
  - 高耐久素材・補強設計
  - 音量の強さ、遠くまで響く等の性能表現
  - 高級感、高品質、プロ仕様などの印象表現
  - 防水、防錆、抗菌、消臭などの機能
  - 付属品、セット内容の追加
- 商品説明・箇条書き・画像構成では、「確認できている情報」と「訴求上の見せ方」を分けて考えること。
- 魅力を伝えるために表現を工夫するのはよいが、実物未確認の仕様を捏造してはいけない。
- 不明な点は、無理に埋めず、一般的で安全な表現に留めること。

【表現ルール】
- Amazon商品ページ向けに、誇張しすぎず、自然で売り場になじむ日本語にすること。
- 効果効能を断定しないこと。
- 音・耐久性・素材・サイズなど、数値や性能を連想させる表現は、根拠がある場合のみ使うこと。
- タイトル案ではSEOを意識しつつ、不明な仕様を盛り込まないこと。
- 画像7枚構成では、現物で確認できる見た目・使い方・ベネフィットを中心に設計すること。
- 画像指示書では、存在しない付属品や加工を描かないよう注意点を明記すること。

【ベース商品情報】
- 商品名: ${p.title || ''}
- カテゴリ: ${p.category || ''}
- 一言サマリー: ${p.summary || ''}
- 競合価格: ${p.price || ''}
- 月販目安: ${p.monthly_sales || ''}
- レビュー件数: ${p.reviews || ''}
- 競合の弱点/不満: ${p.weakness || ''}
- 差別化軸: ${p.diff || ''}
- タグ: ${(p.tags || []).join(' / ')}
- 1688検索キーワード: ${(p.supplier_keywords || []).join(' / ')}

【追加テキスト素材】
- 競合レビュー抜粋: ${extraTexts.competitor_reviews || 'なし'}
- 仕入元情報: ${extraTexts.supplier_info || 'なし'}
- 狙いたい訴求/ターゲットメモ: ${extraTexts.target_notes || 'なし'}
- 自由メモ: ${extraTexts.free_memo || p.memo || 'なし'}

以下のJSON形式でのみ出力してください。

{
  "concept": "商品コンセプト（200文字前後）",
  "title_candidates": ["Amazonタイトル案1", "タイトル案2", "タイトル案3"],
  "bullets": ["箇条書き1", "箇条書き2", "箇条書き3", "箇条書き4", "箇条書き5"],
  "description": "商品説明（300〜500文字）",
  "image_plan": [
    {
      "no": 1,
      "name": "メイン画像",
      "goal": "この画像の目的",
      "buyer_psychology": "狙う購入心理",
      "composition": "構図の説明",
      "text": "画像内に入れるテキスト。メイン画像は基本なし",
      "materials": "使う素材や参考画像",
      "gpt_prompt": "GPTや画像生成AI向けの制作指示書",
      "notes": "注意点。未確認仕様を描かない、存在しない付属品を追加しない等もここで明記する",
      "jp_instruction": "日本語での制作指示"
    }
  ],
  "backend_keywords": "バックエンドキーワード候補を半角スペース区切りで出力"
}

image_plan は必ず 1〜7 の7件を返してください。構成は以下です。
1. メイン画像
2. 使用シーン
3. 課題→解決
4. 使い方
5. メリット訴求
6. 仕様・サイズ
7. 使用拡張 or クロスセル`;

  const parts = [];
  (extraImages || []).forEach((img, idx) => {
    if (!img || !img.base64) return;
    parts.push({ text: `【追加画像${idx + 1}】` });
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.base64 } });
  });
  parts.push({ text: prompt });

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  };

  const text = callGeminiWithRetry(payload);
  const apiResponse = JSON.parse(text);
  if (!apiResponse.candidates || !apiResponse.candidates.length) throw new Error('Geminiの回答が空です。');
  const generatedText = apiResponse.candidates[0].content.parts[0].text;
  const result = extractJson_(generatedText);

  result.title_candidates = Array.isArray(result.title_candidates) ? result.title_candidates : [];
  result.bullets = Array.isArray(result.bullets) ? result.bullets : [];
  result.image_plan = Array.isArray(result.image_plan) ? result.image_plan : [];
  return result;
}

// ============================================
// 在庫同期機能（Research Deck v6 追加分）
// 既存の Code.gs に追記してください
// ============================================

// ── REQUIRED_HEADERS_LIFECYCLE に以下6フィールドを追加 ──
// 既存の REQUIRED_HEADERS_LIFECYCLE 配列の末尾（'source' の後）に追加：
//
//   'fba_stock', 'fba_inbound', 'fba_daily_t7', 'fba_days_remain', 'fba_alert', 'fba_synced_at'
//
// 変更前：
//   ...'is_deleted', 'is_launched', 'source'
// 変更後：
//   ...'is_deleted', 'is_launched', 'source',
//   'fba_stock', 'fba_inbound', 'fba_daily_t7', 'fba_days_remain', 'fba_alert', 'fba_synced_at'
// ============================================

// ── doPost に以下のアクションを追加 ──
// 既存の doPost 内、最後の return jsonResponse の前に追記：
//
//   if (action === 'syncInventory') {
//     const result = syncInventoryFromReport(body.inventoryData || []);
//     return jsonResponse({ status: 'ok', data: result });
//   }
// ============================================

/**
 * フロントから送られた在庫データ（ASIN別集計済み）を
 * product_lifecycle の各行に書き込む
 *
 * @param {Array} inventoryData - [{ asin, available, inbound, dailyT7, daysRemain, alert, syncedAt }, ...]
 * @return {{ updated: number, skipped: number }}
 */
// ============================================
// Step 2: syncInventoryFromReport() 修正版
// sku_master の自動更新を追加
// ============================================
function syncInventoryFromReport(inventoryData, snapshotDate) {

  // ★ 先頭に追加
  const target = inventoryData.find(d => d.asin === 'B0FSZKJWP9');
  if (target) {
    Logger.log('=== B0FSZKJWP9 受信データ 全キー ===');
    Logger.log(JSON.stringify(target, null, 2));
    Logger.log('キー一覧: ' + Object.keys(target).join(', '));
  }

  if (!inventoryData || !inventoryData.length) {
    throw new Error('inventoryData が空です。');
  }

  // ★ デバッグ：最初の1件のskusを確認
  const first = inventoryData[0];
  Logger.log('最初のASIN: ' + first.asin);
  Logger.log('skusの有無: ' + (first.skus ? 'あり (' + first.skus.length + '件)' : 'なし'));
  Logger.log('最初の1件全体: ' + JSON.stringify(first));

  const sheet   = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data    = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);

  function getOrAddColIdx(header) {
    let idx = headers.indexOf(header);
    if (idx === -1) {
      idx = headers.length;
      sheet.getRange(1, idx + 1).setValue(header);
      headers.push(header);
    }
    return idx;
  }

  const COL = {
    ASIN:        headers.indexOf('asin'),
    TITLE:       headers.indexOf('title'),
    FBA_STOCK:   getOrAddColIdx('fba_stock'),
    FBA_INBOUND: getOrAddColIdx('fba_inbound'),
    DAILY_T7:    getOrAddColIdx('fba_daily_t7'),
    DAYS_REMAIN: getOrAddColIdx('fba_days_remain'),
    ALERT:       getOrAddColIdx('fba_alert'),
    SYNCED_AT:   getOrAddColIdx('fba_synced_at'),
  };

  if (COL.ASIN === -1) throw new Error('product_lifecycle に asin 列が見つかりません。');

  const invMap = {};
  inventoryData.forEach(d => { if (d.asin) invMap[d.asin] = d; });

  let updated = 0;
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const rowAsin = String(data[i][COL.ASIN] || '').trim();
    if (!rowAsin) { skipped++; continue; }

    const inv = invMap[rowAsin];
    if (!inv) { skipped++; continue; }

    const rowNum = i + 1;
    if (inv.title && COL.TITLE >= 0) {
      sheet.getRange(rowNum, COL.TITLE + 1).setValue(inv.title);
    }
    sheet.getRange(rowNum, COL.FBA_STOCK   + 1).setValue(inv.available  ?? '');
    sheet.getRange(rowNum, COL.FBA_INBOUND + 1).setValue(inv.inbound    ?? '');
    
    // null が来たら既存値を上書きしない
    if (inv.alertDaily !== null || inv.dailyT7 !== null) {
      sheet.getRange(rowNum, COL.DAILY_T7 + 1).setValue(inv.alertDaily ?? inv.dailyT7 ?? '');
    }
    if (inv.daysRemain !== null) {
      sheet.getRange(rowNum, COL.DAYS_REMAIN + 1).setValue(inv.daysRemain ?? '');
    }

    sheet.getRange(rowNum, COL.ALERT       + 1).setValue(inv.alert      ?? '');
    sheet.getRange(rowNum, COL.SYNCED_AT   + 1).setValue(inv.syncedAt   ?? '');
    updated++;
  }

  // ★ sku_master を自動更新
  updateSkuMaster_(inventoryData);

  // ★★ 在庫スナップショット記録（追記・非破壊：上のループ＆上書き保存には触れない）
  try {
    const snapDate = (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate))
      ? snapshotDate
      : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const snapRows = inventoryData
      .filter(d => d && d.asin)
      .map(d => ({
        snapshot_date: snapDate,
        asin:        String(d.asin).trim(),
        available:   d.available  ?? '',
        inbound:     d.inbound    ?? '',
        daily_t7:    d.alertDaily ?? d.dailyT7 ?? '',
        days_remain: d.daysRemain ?? '',
        alert:       d.alert      ?? '',
        synced_at:   d.syncedAt   ?? ''
      }));
    const snapRes = appendInventorySnapshot_(snapRows);
    Logger.log(`在庫スナップショット: ${snapDate} / ${snapRows.length}件 (added=${snapRes.added}, replaced=${snapRes.replaced})`);
  } catch (e) {
    Logger.log('在庫スナップショット skip: ' + e.message);  // 失敗しても同期は止めない
  }

  Logger.log(`在庫同期完了: updated=${updated}, skipped=${skipped}`);
  return { updated, skipped };
}

// sku_master upsert（内部関数）
function updateSkuMaster_(inventoryData) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SKU_MASTER);
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS_SKU_MASTER.length)
      .setValues([REQUIRED_HEADERS_SKU_MASTER]);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const skuIdx   = headers.indexOf('sku');
  const asinIdx  = headers.indexOf('asin');
  const fnskuIdx = headers.indexOf('fnsku');
  const nameIdx  = headers.indexOf('product_name');
  const dateIdx  = headers.indexOf('updated_at');

  // 既存SKUのマップ（sku → 行番号）
  const existingSkuRow = {};
  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][skuIdx] || '').trim();
    if (sku) existingSkuRow[sku] = i + 1;
  }

  const now = new Date().toISOString();
  const newRows = [];

  inventoryData.forEach(d => {
    if (!d.skus || !d.skus.length) return;
    d.skus.forEach(s => {
      if (!s.sku) return;
      const sku = s.sku.trim();
      if (existingSkuRow[sku]) {
      const rowNum = existingSkuRow[sku];
      sheet.getRange(rowNum, asinIdx + 1).setValue(d.asin || '');
      // ★ 空の場合は上書きしない
      if (s.fnsku) sheet.getRange(rowNum, fnskuIdx + 1).setValue(s.fnsku);
      if (d.title) sheet.getRange(rowNum, nameIdx  + 1).setValue(d.title);
      sheet.getRange(rowNum, dateIdx  + 1).setValue(now);
    } else {
        // 新規行
        newRows.push([sku, d.asin || '', s.fnsku || '', d.title || '', now]);
        existingSkuRow[sku] = -1; // 重複防止
      }
    });
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  }

  Logger.log(`sku_master 更新: ${newRows.length}件追加`);
}

function updateReorderRecord(recordId, reorderData) {
  if (!recordId) throw new Error('recordId is required');
  
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const data  = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_REORDER);
  const idIdx = headers.indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) !== String(recordId)) continue;

    const rowNum = i + 1;
    const setValue = (col, val) => {
      const idx = headers.indexOf(col);
      if (idx >= 0) sheet.getRange(rowNum, idx + 1).setValue(val ?? '');
    };

    setValue('order_date',            reorderData.order_date);
    setValue('quantity',              reorderData.quantity);
    setValue('unit_price_1688',       reorderData.unit_price_1688 || '');
    setValue('landed_cost_actual',    reorderData.landed_cost_actual);
    setValue('lead_time_days',        reorderData.lead_time_days || '');
    setValue('expected_arrival_date', reorderData.expected_arrival_date || '');
    setValue('fba_fee_at_order',      reorderData.fba_fee_at_order || '');
    setValue('selling_price_at_order',reorderData.selling_price_at_order || '');
    setValue('notes',                 reorderData.notes || '');

    // current_landed_cost も更新
    updateProductCurrentLandedCost(reorderData.product_id, reorderData.landed_cost_actual);

    return { status: 'ok', recordId };
  }
  throw new Error('Record not found: ' + recordId);
}

function bulkRegisterSellingProducts(products) {
  if (!products || !products.length) throw new Error('productsが空です');

  const sheet  = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data   = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);

  // 既存ASINを収集
  const asinIdx = headers.indexOf('asin');
  const existingAsins = new Set(
    data.slice(1).map(row => String(row[asinIdx] || '').trim()).filter(Boolean)
  );

  const now = new Date().toISOString();
  let registered = 0;

  products.forEach(p => {
    if (!p.asin || existingAsins.has(p.asin)) return;

    const cardData = {
      id:                 Utilities.getUuid(),
      status:             'go',
      title:              p.title || p.asin,
      asin:               p.asin,
      is_launched:        true,
      is_deleted:         false,
      emoji:              p.emoji || '📦',
      fba_stock:          p.fba_stock ?? '',
      fba_inbound:        p.fba_inbound ?? '',
      fba_daily_t7:       p.fba_daily_t7 ?? '',
      fba_days_remain:    p.fba_days_remain ?? '',
      fba_alert:          p.fba_alert ?? '',
      fba_synced_at:      p.fba_synced_at ?? '',
      created_at:         now,
      updated_at:         now,
      // 残りは空
      category: '', summary: '', price: '', monthly_sales: '', reviews: '',
      tags: [], supplier_keywords: '', weakness: '', urls: [],
      audit: {}, produce: {}, scores: {}, checks: [], image_drive_ids: [],
      image_drive_id: '', profit: {}, cost_simulation: {}, page_draft: {},
      gtin: '', amazon_url: '', amazon_published_date: '',
      supplier_1688_url: '', rakumart_linkage_status: '', barcode_option: '',
      current_landed_cost: '', actual_result: {}, source: 'inventory_import',
      supplier_keywords_json: '',
    };

    sheet.appendRow(
      buildRowFromHeaders_(headers, cardData, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE)
    );
    existingAsins.add(p.asin);
    registered++;
  });

  Logger.log(`bulkRegister: ${registered}件登録`);
  return { registered };
}

const SHEET_FILTER_BUTTONS = 'filter_buttons';

function getFilterButtons() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_FILTER_BUTTONS);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(row => row[0] && row[1])
    .map(row => ({ label: String(row[0]), keyword: String(row[1]) }));
}

// ============================================
// Step 1: sku_master シート初期化
// ============================================
const SHEET_SKU_MASTER = 'sku_master';

const REQUIRED_HEADERS_SKU_MASTER = [
  'sku', 'asin', 'fnsku', 'product_name', 'updated_at'
];

function setupSkuMaster() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_SKU_MASTER);

  if (sheet) {
    Logger.log('sku_master シートが既に存在します。内容をクリアして再作成します。');
    sheet.clearContents();
  } else {
    sheet = ss.insertSheet(SHEET_SKU_MASTER);
    Logger.log('sku_master シートを新規作成しました。');
  }

  sheet.getRange(1, 1, 1, REQUIRED_HEADERS_SKU_MASTER.length)
    .setValues([REQUIRED_HEADERS_SKU_MASTER]);
  sheet.getRange(1, 1, 1, REQUIRED_HEADERS_SKU_MASTER.length)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');
  sheet.setColumnWidths(1, REQUIRED_HEADERS_SKU_MASTER.length, 180);
  sheet.setFrozenRows(1);

  Logger.log('✅ sku_master シートを作成しました。在庫レポートを同期すると自動でデータが入ります。');
}

// ============================================
// Step 3: transaction_history・period_costs シート初期化
// ============================================
const SHEET_TRANSACTION_HISTORY = 'transaction_history';
const SHEET_PERIOD_COSTS        = 'period_costs';

const REQUIRED_HEADERS_TRANSACTION = [
  'id', 'order_id', 'sku', 'asin', 'date',
  'transaction_type', 'qty',
  'sales_taxin', 'fee', 'fba_fee',
  'discount', 'points', 'net',
  'period_key', 'imported_at'
];

const REQUIRED_HEADERS_PERIOD_COSTS = [
  'id', 'period_key', 'cost_type', 'description', 'amount', 'imported_at'
];

function setupTransactionSheets() {
  const ss = getSpreadsheet_();

  [
    { name: SHEET_TRANSACTION_HISTORY, headers: REQUIRED_HEADERS_TRANSACTION },
    { name: SHEET_PERIOD_COSTS,        headers: REQUIRED_HEADERS_PERIOD_COSTS },
  ].forEach(({ name, headers }) => {
    let sheet = ss.getSheetByName(name);
    if (sheet) {
      Logger.log(`${name} シートをクリアして再作成します。`);
      sheet.clearContents();
    } else {
      sheet = ss.insertSheet(name);
    }

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1c1c21')
      .setFontColor('#e8d5a3')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);

    // ★ period_key列を「書式なしテキスト」に設定
    const periodIdx = headers.indexOf('period_key');
    if (periodIdx >= 0) {
      sheet.getRange(2, periodIdx + 1, 1000, 1)
        .setNumberFormat('@STRING@');
    }
  });

  Logger.log('✅ transaction_history・period_costs シートを作成しました。');
}

// ============================================
// Step 4: syncTransactions() - トランザクション取り込み
// ============================================

function syncTransactions(transactions, periodCosts, periodKey) {
  if (!periodKey) throw new Error('periodKey が必要です。');

  // ── reorder_history を SKU/product_id 別にキャッシュ ──
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rPidIdx  = reorderHdrs.indexOf('product_id');
  const rDateIdx = reorderHdrs.indexOf('order_date');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

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

  // ── sku_master から {sku: asin} マップ ──
  const skuToAsin = buildSkuToAsinMap_();

  // ── product_lifecycle から {asin: {rowNum, productId, salesActual}} マップ ──
  // 全列読み込みをやめて必要な3列だけ読む（keepa_dataなど大きなJSONを読まないための最適化）
  const lcSheet   = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcHeaders = getHeaders_(lcSheet, REQUIRED_HEADERS_LIFECYCLE);
  const asinColIdx     = lcHeaders.indexOf('asin');
  const idColIdx       = lcHeaders.indexOf('id');
  const salesActualIdx = getOrAddLifecycleCol_(lcSheet, lcHeaders, 'sales_actual');

  const lastLcRow = lcSheet.getLastRow();
  const asinVals        = lastLcRow > 1 ? lcSheet.getRange(2, asinColIdx + 1,      lastLcRow - 1, 1).getValues() : [];
  const idVals          = lastLcRow > 1 ? lcSheet.getRange(2, idColIdx + 1,        lastLcRow - 1, 1).getValues() : [];
  const salesActualVals = lastLcRow > 1 ? lcSheet.getRange(2, salesActualIdx + 1,  lastLcRow - 1, 1).getValues() : [];

  const asinToLifecycle = {};
  for (let i = 0; i < asinVals.length; i++) {
    const asin = String(asinVals[i][0] || '').trim();
    if (!asin) continue;
    let salesActual = [];
    try {
      const raw = salesActualVals[i][0];
      salesActual = raw ? JSON.parse(raw) : [];
    } catch(e) { salesActual = []; }
    asinToLifecycle[asin] = {
      rowNum:    i + 2,
      productId: String(idVals[i][0] || '').trim(),
      salesActual: Array.isArray(salesActual) ? salesActual : [],
    };
  }

  // ── 既存の重複キーを取得 ──
  const existingKeys = getExistingTransactionKeys_(periodKey);

  // ── トランザクション集計 ──
  const asinSummary  = {};
  const newHistoryRows = [];
  let importedCount  = 0;
  let duplicateCount = 0;
  let noSkuCount     = 0;

  transactions.forEach(tx => {
    const dupKey = `${tx.orderId}__${tx.sku}`;
    if (!tx.sku) { noSkuCount++; return; }
    if (existingKeys.has(dupKey)) { duplicateCount++; return; }

    const asin = skuToAsin[tx.sku] || '';
    const id   = Utilities.getUuid();
    const now  = new Date().toISOString();

    // ── 原価逆引き（SKU優先、なければproduct_idで） ──
    let landedCost = 0;
    if (tx.type === '注文') {
      landedCost = getLandedCostAtDate_(tx.sku, tx.date, reorderByKey);
      if (!landedCost && asin && asinToLifecycle[asin]) {
        const pid = asinToLifecycle[asin].productId;
        landedCost = getLandedCostAtDate_('pid:' + pid, tx.date, reorderByKey);
      }
    }

    newHistoryRows.push([
      id, tx.orderId, tx.sku, asin, tx.date,
      tx.type, tx.qty,
      tx.salesTaxin, tx.fee, tx.fbaFee,
      tx.discount, tx.points, tx.net,
      String(periodKey), now
    ]);

    if (asin) {
      if (!asinSummary[asin]) {
        asinSummary[asin] = {
          qty:0, salesTaxin:0, fee:0, fbaFee:0,
          discount:0, points:0, net:0,
          returnQty:0, returnAmount:0,
          costLines: []
        };
      }
      const s = asinSummary[asin];
      if (tx.type === '注文') {
        s.qty        += tx.qty || 0;
        s.salesTaxin += tx.salesTaxin || 0;
        s.fee        += tx.fee || 0;
        s.fbaFee     += tx.fbaFee || 0;
        s.discount   += tx.discount || 0;
        s.points     += tx.points || 0;
        s.net        += tx.net || 0;
        if (landedCost > 0) {
          s.costLines.push({ cost: landedCost, qty: tx.qty || 0 });
        }
      } else if (tx.type === '返金') {
        s.returnQty    += Math.abs(tx.qty || 0);
        s.returnAmount += tx.net || 0;
      }
    }

    importedCount++;
  });

  // ── transaction_history に書き込み ──
  if (newHistoryRows.length) {
    const histSheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
    const startRow  = histSheet.getLastRow() + 1;
    const periodIdx = REQUIRED_HEADERS_TRANSACTION.indexOf('period_key');
    histSheet.getRange(startRow, periodIdx + 1, newHistoryRows.length, 1)
      .setNumberFormat('@STRING@');
    histSheet.getRange(startRow, 1, newHistoryRows.length, REQUIRED_HEADERS_TRANSACTION.length)
      .setValues(newHistoryRows);
  }

  // ── period_costs に書き込み ──
  if (periodCosts && periodCosts.length) {
    upsertPeriodCosts_(periodCosts, periodKey);
  }

  // ── product_lifecycle の sales_actual を更新 ──
  const now = new Date().toISOString();
  Object.entries(asinSummary).forEach(([asin, s]) => {
    const lc = asinToLifecycle[asin];
    if (!lc) return;

    const costQty   = s.costLines.reduce((sum, l) => sum + l.qty, 0);
    const costTotal = s.costLines.reduce((sum, l) => sum + l.cost * l.qty, 0);

    const coveredNet  = costQty > 0 && s.qty > 0
      ? s.net * (costQty / s.qty) : 0;
    const grossProfit = costQty > 0
      ? Math.round(coveredNet - costTotal) : null;
    const perUnit     = grossProfit !== null && costQty > 0
      ? Math.round(grossProfit / costQty) : null;

    const avgLandedCost = costQty > 0 ? Math.round(costTotal / costQty) : 0;

    const newEntry = {
      period:                periodKey,
      qty:                   s.qty,
      sales_taxin:           Math.round(s.salesTaxin),
      fee:                   Math.round(s.fee),
      fba_fee:               Math.round(s.fbaFee),
      discount:              Math.round(s.discount),
      points:                Math.round(s.points),
      net:                   Math.round(s.net),
      landed_cost_used:      avgLandedCost,
      cost_covered_qty:      costQty,
      gross_profit:          grossProfit,
      gross_profit_per_unit: perUnit,
      return_qty:            s.returnQty,
      return_amount:         Math.round(s.returnAmount),
      imported_at:           now
    };

    const existing = lc.salesActual.filter(e => e.period !== periodKey);
    existing.push(newEntry);
    lcSheet.getRange(lc.rowNum, salesActualIdx + 1)
      .setValue(JSON.stringify(existing));
  });

  Logger.log(`syncTransactions: imported=${importedCount}, duplicate=${duplicateCount}, noSku=${noSkuCount}`);
  return { imported: importedCount, skipped_duplicate: duplicateCount, skipped_no_sku: noSkuCount };
}


// ── sku_master から {sku: asin} マップを生成 ──
function buildSkuToAsinMap_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};
  const headers = data[0];
  const skuIdx  = headers.indexOf('sku');
  const asinIdx = headers.indexOf('asin');
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const sku  = String(data[i][skuIdx]  || '').trim();
    const asin = String(data[i][asinIdx] || '').trim();
    if (sku && asin) map[sku] = asin;
  }
  return map;
}

// ── transaction_history から既存の重複キーを取得 ──
function getExistingTransactionKeys_(periodKey) {
  const sheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return new Set();
  const headers   = data[0];
  const orderIdx  = headers.indexOf('order_id');
  const skuIdx    = headers.indexOf('sku');
  const periodIdx = headers.indexOf('period_key');
  const keys = new Set();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][periodIdx]) !== periodKey) continue;
    keys.add(`${data[i][orderIdx]}__${data[i][skuIdx]}`);
  }
  return keys;
}

// ── period_costs upsert ──
function upsertPeriodCosts_(periodCosts, periodKey) {
  const sheet = getSheetByName_(SHEET_PERIOD_COSTS, REQUIRED_HEADERS_PERIOD_COSTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const periodIdx = headers.indexOf('period_key');
  const typeIdx   = headers.indexOf('cost_type');
  const descIdx   = headers.indexOf('description');
  const amtIdx    = headers.indexOf('amount');

  // 既存の重複キーセットを作成
  const existingKeys = new Set();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][periodIdx]) !== periodKey) continue;
    const key = [
      String(data[i][typeIdx]  || ''),
      String(data[i][descIdx]  || ''),
      String(data[i][amtIdx]   || ''),
    ].join('__');
    existingKeys.add(key);
  }

  // 重複しない行だけ追記
  const now = new Date().toISOString();
  const newRows = periodCosts
    .filter(c => {
      const key = [c.costType, c.description, String(c.amount)].join('__');
      return !existingKeys.has(key);
    })
    .map(c => [
      Utilities.getUuid(), String(periodKey), c.costType, c.description, c.amount, now
    ]);

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
  }
}

// ── lifecycle に sales_actual 列を追加（なければ） ──
function getOrAddLifecycleCol_(sheet, headers, colName) {
  let idx = headers.indexOf(colName);
  if (idx === -1) {
    idx = headers.length;
    sheet.getRange(1, idx + 1).setValue(colName);
    headers.push(colName);
  }
  return idx;
}

// ============================================
// Step 5: getPeriodSummary() - 売上タブ用集計
// ============================================
function getPeriodSummary(periodKey) {
  if (!periodKey) throw new Error('periodKey が必要です。');

  // ── reorder_history を SKU/product_id 別にキャッシュ ──
  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderData  = reorderSheet.getDataRange().getValues();
  const reorderHdrs  = reorderData[0];
  const rSkuIdx  = reorderHdrs.indexOf('sku');
  const rPidIdx  = reorderHdrs.indexOf('product_id');
  const rDateIdx = reorderHdrs.indexOf('order_date');
  const rCostIdx = reorderHdrs.indexOf('landed_cost_actual');

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

  // ── sku_master から {sku: asin} マップ ──
  const skuToAsin = buildSkuToAsinMap_();

  // ── product_lifecycle から {asin: {title, emoji, subtitle, productId}} マップ ──
  // 全列読み込みをやめて必要な5列だけ読む（keepa_dataなど大きなJSONを読まないための最適化）
  const lcSheet    = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcHdrs     = getHeaders_(lcSheet, REQUIRED_HEADERS_LIFECYCLE);
  const lcAsinIdx  = lcHdrs.indexOf('asin');
  const lcTitleIdx = lcHdrs.indexOf('title');
  const lcEmojiIdx = lcHdrs.indexOf('emoji');
  const lcIdIdx    = lcHdrs.indexOf('id');
  const lcSubIdx   = lcHdrs.indexOf('subtitle');

  const lastLcRow  = lcSheet.getLastRow();
  const lcAsinVals  = lastLcRow > 1 ? lcSheet.getRange(2, lcAsinIdx  + 1, lastLcRow - 1, 1).getValues() : [];
  const lcTitleVals = lastLcRow > 1 ? lcSheet.getRange(2, lcTitleIdx + 1, lastLcRow - 1, 1).getValues() : [];
  const lcEmojiVals = lastLcRow > 1 ? lcSheet.getRange(2, lcEmojiIdx + 1, lastLcRow - 1, 1).getValues() : [];
  const lcIdVals    = lastLcRow > 1 ? lcSheet.getRange(2, lcIdIdx    + 1, lastLcRow - 1, 1).getValues() : [];
  const lcSubVals   = lastLcRow > 1 && lcSubIdx >= 0 ? lcSheet.getRange(2, lcSubIdx + 1, lastLcRow - 1, 1).getValues() : [];

  const asinMeta = {};
  for (let i = 0; i < lcAsinVals.length; i++) {
    const asin = String(lcAsinVals[i][0] || '').trim();
    if (!asin) continue;
    asinMeta[asin] = {
      title:     String(lcTitleVals[i]?.[0] || '').trim() || asin,
      emoji:     String(lcEmojiVals[i]?.[0] || '').trim() || '📦',
      subtitle:  String(lcSubVals[i]?.[0]   || '').trim(),
      productId: String(lcIdVals[i]?.[0]    || '').trim(),
    };
  }

  // ── transaction_history を直接集計 ──
  const txSheet  = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const txData   = txSheet.getDataRange().getValues();
  const txHdrs   = txData[0];
  const tPeriod  = txHdrs.indexOf('period_key');
  const tSku     = txHdrs.indexOf('sku');
  const tAsin    = txHdrs.indexOf('asin');
  const tType    = txHdrs.indexOf('transaction_type');
  const tDate    = txHdrs.indexOf('date');
  const tTaxin   = txHdrs.indexOf('sales_taxin');
  const tFee     = txHdrs.indexOf('fee');
  const tFba     = txHdrs.indexOf('fba_fee');
  const tDisc    = txHdrs.indexOf('discount');
  const tPts     = txHdrs.indexOf('points');
  const tNet     = txHdrs.indexOf('net');
  const tQty     = txHdrs.indexOf('qty');

  // ASIN別集計
  const asinSummary = {};
  // 未紐付き集計
  const unlinked = {
    qty:0, salesTaxin:0, fee:0, fbaFee:0, net:0,
    returnQty:0, returnAmount:0, skus: new Set()
  };
  // サマリー直接集計
  let totalSalesTaxin = 0, totalNet = 0;
  let totalReturnAmt  = 0, totalReturnQty = 0, totalQty = 0;

  for (let i = 1; i < txData.length; i++) {
    const row = txData[i];
    if (String(row[tPeriod]) !== periodKey) continue;
    const type = String(row[tType] || '');
    if (type !== '注文' && type !== '返金') continue;

    const sku    = String(row[tSku]  || '').trim();
    const asin   = String(row[tAsin] || '').trim() || skuToAsin[sku] || '';
    const date   = row[tDate];
    const taxin  = Number(row[tTaxin]) || 0;
    const fee    = Number(row[tFee])   || 0;
    const fba    = Number(row[tFba])   || 0;
    const disc   = Number(row[tDisc])  || 0;
    const pts    = Number(row[tPts])   || 0;
    const net    = Number(row[tNet])   || 0;
    const qty    = Number(row[tQty])   || 0;

    // サマリー集計（全件）
    if (type === '注文') {
      totalSalesTaxin += taxin;
      totalNet        += net;
      totalQty        += qty;
    } else {
      totalReturnAmt += net;
      totalReturnQty += qty;
    }

    // 原価逆引き（注文のみ）
    let landedCost = 0;
    if (type === '注文' && sku) {
      landedCost = getLandedCostAtDate_(sku, date, reorderByKey);
      if (!landedCost && asin && asinMeta[asin]) {
        const pid = asinMeta[asin].productId;
        if (pid) landedCost = getLandedCostAtDate_('pid:' + pid, date, reorderByKey);
      }
    }

    if (asin) {
      if (!asinSummary[asin]) {
        asinSummary[asin] = {
          qty:0, salesTaxin:0, fee:0, fbaFee:0,
          disc:0, pts:0, net:0,
          returnQty:0, returnAmount:0,
          costLines:[]
        };
      }
      const s = asinSummary[asin];
      if (type === '注文') {
        s.qty        += qty;
        s.salesTaxin += taxin;
        s.fee        += fee;
        s.fbaFee     += fba;
        s.disc       += disc;
        s.pts        += pts;
        s.net        += net;
        if (landedCost > 0) s.costLines.push({ cost: landedCost, qty });
      } else {
        s.returnQty    += qty;
        s.returnAmount += net;
      }
    } else {
      if (type === '注文') {
        unlinked.qty        += qty;
        unlinked.salesTaxin += taxin;
        unlinked.fee        += fee;
        unlinked.fbaFee     += fba;
        unlinked.net        += net;
        if (sku) unlinked.skus.add(sku);
      } else {
        unlinked.returnQty    += qty;
        unlinked.returnAmount += net;
      }
    }
  }

  // ── 商品別配列を生成 ──
  let costSetCount = 0, uncostCount = 0, uncostNet = 0;

  const products = Object.entries(asinSummary).map(([asin, s]) => {
    const meta = asinMeta[asin] || { title: asin, emoji: '📦' };

    const costQty   = s.costLines.reduce((sum, l) => sum + l.qty,       0);
    const costTotal = s.costLines.reduce((sum, l) => sum + l.cost*l.qty, 0);

    let grossProfit = null, grossProfitUnit = null;
    if (costQty > 0) {
      const coveredNet = s.qty > 0 ? s.net * (costQty / s.qty) : 0;
      grossProfit      = Math.round(coveredNet - costTotal);
      grossProfitUnit  = Math.round(grossProfit / costQty);
      costSetCount++;
    } else {
      uncostCount++;
      uncostNet += s.net;
    }

    return {
      asin,
      title:                 meta.title,
      subtitle:              meta.subtitle || '',
      emoji:                 meta.emoji,
      current_landed_cost:   costQty > 0 ? Math.round(costTotal / costQty) : 0,
      qty:                   s.qty,
      sales_taxin:           Math.round(s.salesTaxin),
      fee:                   Math.round(s.fee),
      fba_fee:               Math.round(s.fbaFee),
      net:                   Math.round(s.net),
      gross_profit:          grossProfit,
      gross_profit_per_unit: grossProfitUnit,
      return_qty:            s.returnQty,
      return_amount:         Math.round(s.returnAmount),
    };
  }).sort((a, b) => b.sales_taxin - a.sales_taxin);

  // 未紐付きを末尾に追加
  if (unlinked.salesTaxin !== 0 || unlinked.qty > 0) {
    uncostCount++;
    uncostNet += unlinked.net;
    products.push({
      asin:                  '',
      title:                 `未紐付き（${unlinked.skus.size}SKU）`,
      emoji:                 '⚠️',
      current_landed_cost:   0,
      qty:                   unlinked.qty,
      sales_taxin:           Math.round(unlinked.salesTaxin),
      fee:                   Math.round(unlinked.fee),
      fba_fee:               Math.round(unlinked.fbaFee),
      net:                   Math.round(unlinked.net),
      gross_profit:          null,
      gross_profit_per_unit: null,
      return_qty:            unlinked.returnQty,
      return_amount:         Math.round(unlinked.returnAmount),
      isUnlinked:            true,
    });
  }

  attachAdBusinessToProducts_(products, periodKey);

  // ── 期間固定費（件数付き・costTypeで集約） ──
  const costsSheet = getSheetByName_(SHEET_PERIOD_COSTS, REQUIRED_HEADERS_PERIOD_COSTS);
  const costsData  = costsSheet.getDataRange().getValues();
  const costsHdrs  = costsData[0];
  const cPeriod    = costsHdrs.indexOf('period_key');
  const cType      = costsHdrs.indexOf('cost_type');
  const cDesc      = costsHdrs.indexOf('description');
  const cAmount    = costsHdrs.indexOf('amount');

  const costMap = {};
  for (let i = 1; i < costsData.length; i++) {
    if (String(costsData[i][cPeriod]) !== periodKey) continue;
    const ct   = String(costsData[i][cType]   || '');
    const desc = String(costsData[i][cDesc]   || '');
    const amt  = Number(costsData[i][cAmount]) || 0;
    if (!costMap[ct]) costMap[ct] = { costType: ct, description: desc, amount: 0, count: 0 };
    costMap[ct].amount += amt;
    costMap[ct].count  += 1;
  }
  const periodCosts = Object.values(costMap);

  // ── サマリー ──
  const totalGrossProfit = products
    .filter(p => p.gross_profit !== null)
    .reduce((s, p) => s + p.gross_profit, 0);
  const totalFixedCosts  = periodCosts.reduce((s, c) => s + c.amount, 0);
  const operatingProfit  = totalGrossProfit + totalFixedCosts;
  const dailySales       = getDailySales_(periodKey);

  return {
    periodKey,
    summary: {
      totalSalesTaxin:   Math.round(totalSalesTaxin),
      totalNet:          Math.round(totalNet),
      totalGrossProfit,
      totalFixedCosts:   Math.round(totalFixedCosts),
      operatingProfit,
      totalReturnAmount: Math.round(totalReturnAmt),
      totalReturnQty,
      totalQty,
      returnRate:   totalQty > 0 ? Math.round(totalReturnQty/totalQty*1000)/10 : 0,
      costSetCount,
      uncostCount,
      uncostNet: Math.round(uncostNet),
    },
    products,
    periodCosts,
    dailySales,
  };
}

// 取り込み済み期間一覧
function getAvailablePeriods() {
  const sheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers   = data[0];
  const periodIdx = headers.indexOf('period_key');
  const periods   = new Set();
  for (let i = 1; i < data.length; i++) {
    const p = String(data[i][periodIdx] || '').trim();
    if (p) periods.add(p);
  }
  return Array.from(periods).sort().reverse(); // 新しい順
}

// 日別売上集計（transaction_history から）
function getDailySales_(periodKey) {
  const sheet   = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const periodIdx = headers.indexOf('period_key');
  const dateIdx   = headers.indexOf('date');
  const netIdx    = headers.indexOf('net');
  const typeIdx   = headers.indexOf('transaction_type');

  const dailyMap = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][periodIdx]) !== periodKey) continue;
    if (String(data[i][typeIdx]) !== '注文') continue;
    const day = String(data[i][dateIdx] || '').slice(0, 10);
    if (!day) continue;
    dailyMap[day] = (dailyMap[day] || 0) + (Number(data[i][netIdx]) || 0);
  }

  return Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, net]) => ({ date, net: Math.round(net) }));
}

function getLandedCostAtDate_(key, orderDate, reorderByKey) {
  const records = reorderByKey[key];
  if (!records || !records.length) return 0;

  const orderTime = new Date(orderDate).getTime();

  // 注文日以前で最新の発注
  const before = records
    .filter(r => new Date(r.order_date).getTime() <= orderTime)
    .sort((a, b) => new Date(b.order_date) - new Date(a.order_date));
  if (before.length) return Number(before[0].landed_cost_actual) || 0;

  // 注文日より前の発注がない場合は最古を使う
  const sorted = [...records].sort((a, b) => new Date(a.order_date) - new Date(b.order_date));
  return Number(sorted[0].landed_cost_actual) || 0;
}

function getAsinToFnskuMap() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!sheet) return {};
  const data  = sheet.getDataRange().getValues();
  const hdrs  = data[0];
  const asinIdx  = hdrs.indexOf('asin');
  const fnskuIdx = hdrs.indexOf('fnsku');
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const asin  = String(data[i][asinIdx]  || '').trim();
    const fnsku = String(data[i][fnskuIdx] || '').trim();
    if (!asin || !fnsku) continue;
    if (!map[asin]) map[asin] = [];
    if (!map[asin].includes(fnsku)) map[asin].push(fnsku);
  }
  return map;
}

// ============================================
// 直近トランザクション（売上タブ商品ドリルダウン用）
// ============================================
function getRecentTransactionsByAsin(asin, days) {
  days = Number(days) || 30;

  // product_lifecycleから着地原価を取得
  const lcSheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData  = lcSheet.getDataRange().getValues();
  const lcHdrs  = lcData[0];
  const lcAsinIdx = lcHdrs.indexOf('asin');
  const lcCostIdx = lcHdrs.indexOf('current_landed_cost');
  let landedCost = 0;
  for (let i = 1; i < lcData.length; i++) {
    if (String(lcData[i][lcAsinIdx] || '').trim() === asin) {
      landedCost = Number(lcData[i][lcCostIdx]) || 0;
      break;
    }
  }

  // transaction_historyから直近N日分を取得
  const sheet   = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  const iAsin  = headers.indexOf('asin');
  const iDate  = headers.indexOf('date');
  const iType  = headers.indexOf('transaction_type');
  const iQty   = headers.indexOf('qty');
  const iNet   = headers.indexOf('net');
  const iSales = headers.indexOf('sales_taxin');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // 日別に集約
  const dayMap = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iAsin] || '').trim() !== asin) continue;
    const dateStr = String(data[i][iDate] || '').slice(0, 10);
    if (!dateStr || new Date(dateStr) < cutoff) continue;

    if (!dayMap[dateStr]) dayMap[dateStr] = { qty: 0, net: 0, sales: 0, returnQty: 0 };
    const type = String(data[i][iType] || '');
    if (type === '注文') {
      dayMap[dateStr].qty   += Number(data[i][iQty])   || 0;
      dayMap[dateStr].net   += Number(data[i][iNet])   || 0;
      dayMap[dateStr].sales += Number(data[i][iSales]) || 0;
    } else if (type === '返金') {
      dayMap[dateStr].returnQty += Number(data[i][iQty]) || 0;
    }
  }

  const rows = Object.entries(dayMap)
    .map(([date, d]) => ({
      date,
      qty:       d.qty,
      returnQty: d.returnQty,
      avgPrice:  d.qty > 0 ? Math.round(d.sales / d.qty) : 0,
      avgProfit: d.qty > 0 ? Math.round(d.net / d.qty) - landedCost : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  return { rows, landedCost, totalQty, days };
}

// ============================================
// 期間比較レポート保存
// 既存の doGet / doPost には以下のアクションを追記してください
// ============================================

// ── doPost に追記（既存の return jsonResponse の直前に挿入）──
//
//   if (action === 'saveComparisonReport') {
//     const result = saveComparisonReport_(body.filename, body.content);
//     return jsonResponse({ status: 'ok', data: result });
//   }


// ── GASスクリプトプロパティに追加 ──
// キー名  : REPORT_FOLDER_ID
// 値      : 1d3glL9DQRCZ0qXsj15x29iwSqK80pguG
//
// 設定手順：
//   GASエディタ → 左メニュー「プロジェクトの設定」
//   → 「スクリプトのプロパティ」→「プロパティを追加」


/**
 * 比較レポートをMarkdownテキストファイルとしてDriveに保存する
 *
 * @param {string} filename  - 保存するファイル名（例: HAKSAI_比較_2025-11_vs_2024-05_20260531-1432.md）
 * @param {string} content   - Markdownテキスト本文
 * @return {{ fileId: string, fileName: string, viewUrl: string }}
 */
function saveComparisonReport_(filename, content) {
  const folderId = PropertiesService.getScriptProperties().getProperty('REPORT_FOLDER_ID');
  if (!folderId) throw new Error('REPORT_FOLDER_ID がスクリプトプロパティに設定されていません。');

  const folder = DriveApp.getFolderById(folderId);

  // .md 拡張子でテキストファイルとして保存（Googleドキュメントに変換しない）
  const blob = Utilities.newBlob(content, 'text/plain; charset=utf-8', filename);
  const file  = folder.createFile(blob);

  return {
    fileId:   file.getId(),
    fileName: file.getName(),
    viewUrl:  file.getUrl(),
  };
}
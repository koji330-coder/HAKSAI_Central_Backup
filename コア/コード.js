// ============================================
// HAKSAI Research Deck - バックエンドAPI (v6)
// product_lifecycle をメインテーブルとして運用
// https://koji330-coder.github.io/HAKSAI-Reserch-3/
// ============================================

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
}

// HAKSAI Central(React版・central-frontend)からの通信専用の共有シークレット認証。
// Cloudflare Worker(haksai-central-api)経由でのみ付与される。他ツールのactionには影響しない。
function getCentralSecret_() {
  return PropertiesService.getScriptProperties().getProperty('CENTRAL_SHARED_SECRET') || '';
}

function centralAuthOk_(providedSecret) {
  const expected = getCentralSecret_();
  return !!expected && String(providedSecret || '') === expected;
}

const CENTRAL_PROTECTED_GET_ACTIONS_ = new Set([
  'getAvailablePeriods', 'getPeriodSummary', 'diagnoseMissingCostSources', 'getInventoryAlerts',
  'getInboundPlan', 'getRecentTransactionsByAsin', 'getImportStatus', 'getReorderManagementData',
  'getProductCatalog', 'getResearchCommandCenter', 'getProductGrowthData', 'getProductActions',
  'getListingSnapshot', 'getProductMarketHistory', 'getProductMonthlyData', 'getProductConsultations',
  'getProductConsultation', 'getMasterData', 'getPurchaseNotes',
  'getSearchMarketPeriods', 'getSearchMarketSummary', 'getSearchMarketQueryDetail',
  'getSearchMarketQueryHistory', 'getSearchMarketDiagnostics', 'getSearchMarketSignals',
  'getSearchMarketNarrative', 'getAdvertisingKeywordAnalysis'
]);

const CENTRAL_PROTECTED_POST_ACTIONS_ = new Set([
  'upsertManualCostFallback', 'syncInventory', 'syncInboundPlan', 'syncTransactions',
  'previewAdProductReport', 'syncAdProductReport', 'syncBusinessReport',
  'previewSearchQueryPerformance', 'syncSearchQueryPerformance', 'createDomesticOrder',
  'previewAdvertisingKeywordAnalysis', 'runAdvertisingKeywordAnalysis',
  'attachAdvertisingActionAfterSnapshot',
  'updateDomesticOrder', 'cancelDomesticOrder', 'receiveDomesticOrder', 'saveProductAction',
  'archiveProductAction', 'refreshOwnListingSnapshot', 'refreshProductMarketHistory',
  'consultProductGrowthMaika', 'sendProductConsultationMessage', 'saveProductContextNote',
  'deleteReorderRecord', 'savePurchaseNote', 'updateReorderOrderDate'
]);
// createPageProject/updatePageProject/extractPageInputs/adoptExtractedInputAsSupplier/
// generatePageDraft/generateRakumartSearchBrief は旧GitHub Pages版(index.html)の
// ページ制作タブも同じactionを直接呼んでいる(secretなしでapiPost)ため、ここには入れない。
// 入れると centralAuthOk_ に弾かれ旧アプリのページ制作機能が壊れる。
// React側はCloudflare Pages Functionsのactions.tsホワイトリストのみで十分に絞られている。

const PROPS = PropertiesService.getScriptProperties();
const GEMINI_API_KEY = PROPS.getProperty('GEMINI_API_KEY');
const DRIVE_FOLDER_ID = PROPS.getProperty('DRIVE_FOLDER_ID');
const SPREADSHEET_ID = PROPS.getProperty('SPREADSHEET_ID');
const GEMINI_MODEL = PROPS.getProperty('GEMINI_MODEL') || 'gemini-3.1-flash-lite';
const ATLAS_API_URL = PROPS.getProperty('ATLAS_API_URL') || '';
const ATLAS_API_KEY = PROPS.getProperty('ATLAS_API_KEY') || '';
const LANDED_COST_WEBAPP_URL = PROPS.getProperty('LANDED_COST_WEBAPP_URL') || '';

const SHEET_CARDS = 'cards';
const SHEET_PAGE_PROJECTS = 'page_projects';
const SHEET_PAGE_EVENTS = 'page_project_events';
const PAGE_STALE_DAYS = 7;
const SHELF_REVIEW_INTERVAL_DAYS = 30;
const SHELF_EXTEND_NUDGE_COUNT = 2;

// 新規シート（v6）
const SHEET_PRODUCT_LIFECYCLE = 'product_lifecycle';
const SHEET_REORDER_HISTORY = 'reorder_history';
const SHEET_RESEARCH_LESSONS = 'research_lessons';
const VERIFY_OBSERVE_DAYS = 90;
const VERIFY_HIT_TOLERANCE = 0.15;
const PRICE_BAND_SIZE = 500;

// 変更後
const REQUIRED_HEADERS_LIFECYCLE = [
  'id', 'status', 'category', 'title', 'subtitle', 'parent_asin', 'nickname', 'summary', 'price', 'monthly_sales', 'reviews', 'emoji', 'tags',
  'supplier_keywords', 'weakness', 'created_at', 'updated_at',
  'audit', 'produce', 'scores', 'checks', 'image_drive_ids', 'image_drive_id', 'urls',
  'supplier_keywords_json', 'profit', 'cost_simulation', 'page_draft',
  'asin', 'gtin', 'amazon_url', 'amazon_published_date',
  'supplier_1688_url', 'rakumart_linkage_status', 'barcode_option',
  'current_landed_cost', 'actual_result', 'is_deleted', 'is_launched', 'source',
  'fba_stock', 'fba_inbound', 'fba_daily_t7', 'fba_days_remain', 'fba_alert', 'fba_synced_at', 'sales_actual',
  'idea_tags_json', 'idea_tags_updated_at', 'idea_tags_source' , 'keepa_data', 'own_listing', 'origin_type'
];

const REQUIRED_HEADERS_RESEARCH_LESSONS = [
  'lesson_id', 'card_id', 'page_project_id', 'own_asin', 'category', 'price_band',
  'entry_thesis_tags', 'verdict', 'hit_json', 'missed_json', 'lessons_json',
  'next_seeds_json', 'hypothesis_snapshot_json', 'actual_snapshot_json',
  'generated_by', 'created_at'
];

const JSON_COLS_LIFECYCLE = [
  'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
  'image_drive_ids', 'profit', 'cost_simulation', 'page_draft', 'actual_result', 'sales_actual',
  'idea_tags_json' , 'keepa_data', 'own_listing'
];

const OBJECT_JSON_COLS_LIFECYCLE = [
  'audit', 'produce', 'scores', 'checks', 'profit', 'cost_simulation', 'page_draft', 'actual_result', 'own_listing'
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
  'extra_texts', 'page_draft', 'import_decision', 'extracted_input', 'extraction_meta', 'prompt_pack_meta',
  'sourcing_brief', 'sourcing_comparison', 'supplier_selection', 'listing_handoff',
  'consultation_topics', 'own_listing', 'research_lineage'
];

const OBJECT_JSON_COLS_PAGE = ['extra_texts', 'page_draft', 'import_decision', 'extracted_input', 'extraction_meta', 'prompt_pack_meta', 'sourcing_brief', 'sourcing_comparison', 'supplier_selection', 'listing_handoff', 'own_listing', 'research_lineage'];
const BOOLEAN_COLS_PAGE = [];

const REQUIRED_HEADERS_PAGE = [
  'id', 'source_card_id', 'status', 'title', 'category', 'summary', 'price', 'monthly_sales', 'reviews',
  'tags', 'supplier_keywords', 'weakness', 'diff', 'image_drive_ids', 'urls',
  'extra_image_ids', 'extra_texts', 'page_draft', 'memo', 'import_decision', 'initial_order_qty', 'created_at', 'updated_at',
  'extracted_input', 'extraction_meta', 'prompt_pack_meta', 'sourcing_state', 'adopted_candidate_id',
  'sourcing_brief', 'sourcing_comparison', 'supplier_selection', 'listing_handoff',
  'consultation_memo', 'consultation_memo_updated_at', 'consultation_topics', 'document_role', 'document_status', 'own_listing', 'research_lineage',
  'shelf_state', 'shelved_at', 'wake_at', 'shelf_reason'
];

const REQUIRED_HEADERS_PAGE_EVENTS = [
  'event_id', 'page_project_id', 'source_card_id', 'event_type',
  'reason', 'payload_json', 'actor', 'created_at'
];

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// スクリプトプロパティ DEBUG_MODE='true' の時だけ、Unknown action応答に
// 実際にディスパッチ対象のaction一覧を含める(本番で内部構造を露出させないため既定オフ)。
function pgDebugModeOn_() {
  return PropertiesService.getScriptProperties().getProperty('DEBUG_MODE') === 'true';
}

function pgListDispatchedActions_(fn) {
  const src = fn.toString();
  const seen = {};
  const out = [];
  (src.match(/action\s*===\s*'([^']+)'/g) || []).forEach(function(m) {
    const name = m.match(/'([^']+)'/)[1];
    if (!seen[name]) { seen[name] = true; out.push(name); }
  });
  return out;
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
  const addedLifecycle = ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const addedLessons = ensureHeaders_(SHEET_RESEARCH_LESSONS, REQUIRED_HEADERS_RESEARCH_LESSONS);
  Logger.log(`cards: ${addedCards}列追加 / page_projects: ${addedPages}列追加 / lifecycle: ${addedLifecycle}列追加 / lessons: ${addedLessons}列追加`);
}

// ============================================
// GET
// ============================================
function doGet(e) {
  const body = parseBody_(e);  // ← parseBodyを先に呼ぶ
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (CENTRAL_PROTECTED_GET_ACTIONS_.has(action) && !centralAuthOk_(e && e.parameter && e.parameter.secret)) {
      return jsonResponse({ status: 'error', message: 'unauthorized' });
    }
    if (action === 'debugReadSheet') {
      const asin = e.parameter.asin || 'B0FX55ZKRB';
      const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
      const sh = ss.getSheetByName('product_lifecycle');
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      const asinIdx = headers.indexOf('asin');
      const row = data.find(r => String(r[asinIdx]).trim().toUpperCase() === asin.toUpperCase());
      if (!row) return jsonResponse({ status: 'error', message: 'ASIN not found in sheet: ' + asin });
      
      const rowObj = {};
      headers.forEach((h, i) => {
        rowObj[h] = row[i];
      });
      return jsonResponse({ status: 'ok', rowData: rowObj });
    }
    if (action === 'getMasterData') {
      const ss = getSpreadsheet_();
      const skuSheet = ss.getSheetByName('SKU_Master') || ss.getSheetByName('sku_master');
      let skuMaster = [];
      if (skuSheet) {
        const vals = skuSheet.getDataRange().getValues();
        const headers = vals[0].map(h => String(h).trim().toLowerCase());
        const skuIdx = headers.indexOf('sku');
        const asinIdx = headers.indexOf('asin');
        const titleIdx = headers.indexOf('title') !== -1 ? headers.indexOf('title') : headers.indexOf('商品名');
        const costIdx = headers.indexOf('cost') !== -1 ? headers.indexOf('cost') : headers.indexOf('仕入原価');
        const fbaIdx = headers.indexOf('fbafee') !== -1 ? headers.indexOf('fbafee') : headers.indexOf('fba手数料');
        
        for (let i = 1; i < vals.length; i++) {
          const sku = String(vals[i][skuIdx] || '').trim();
          if (!sku) continue;
          skuMaster.push({
            sku: sku,
            asin: asinIdx !== -1 ? String(vals[i][asinIdx] || '').trim() : '',
            title: titleIdx !== -1 ? String(vals[i][titleIdx] || '').trim() : '商品名未登録',
            cost: costIdx !== -1 ? Number(vals[i][costIdx]) || 0 : 0,
            fbaFee: fbaIdx !== -1 ? Number(vals[i][fbaIdx]) || 0 : 0,
            emoji: '📦'
          });
        }
      }

      const costSheet = ss.getSheetByName('Period_Costs') || ss.getSheetByName('period_costs');
      let fixedCosts = [];
      if (costSheet) {
        const vals = costSheet.getDataRange().getValues();
        const headers = vals[0].map(h => String(h).trim().toLowerCase());
        const typeIdx = headers.indexOf('cost_type');
        const descIdx = headers.indexOf('description');
        const amtIdx = headers.indexOf('amount');
        
        for (let i = 1; i < vals.length; i++) {
          const type = typeIdx !== -1 ? String(vals[i][typeIdx] || '') : 'その他';
          const amt = amtIdx !== -1 ? Number(vals[i][amtIdx]) || 0 : 0;
          if (!type && amt === 0) continue;
          fixedCosts.push({
            type: type,
            desc: descIdx !== -1 ? String(vals[i][descIdx] || '') : '',
            amount: amt
          });
        }
      }
      return jsonResponse({ status: 'ok', skuMaster, fixedCosts });
    }
    if (action === 'getCards') return jsonResponse({ status: 'ok', cards: getAllCards_ProductLifecycle() });
    if (action === 'getResearchCommandCenter') return jsonResponse({ status: 'ok', data: getResearchCommandCenterData_() });
    if (action === 'getResearchLessons') return jsonResponse({ status: 'ok', data: getResearchLessons_() });
    if (action === 'getCardDetail') {
      const id = e.parameter.id || '';
      if (!id) return jsonResponse({ status: 'error', message: 'id required' });
      const card = getCardDetail_ProductLifecycle(id);
      if (!card) return jsonResponse({ status: 'error', message: 'card not found: ' + id });
      return jsonResponse({ status: 'ok', card });
    }
    if (action === 'getPageProjects') {
      const pageProjects = attachPageProjectSourcingFlags_(getAllPageProjects());
      recordDueWakeEvents_(pageProjects);
      return jsonResponse({ status: 'ok', pageProjects: pageProjects, shelfDigest: getShelfDigestForSecretary_(pageProjects) });
    }
    if (action === 'getActivePageSkillPack') return jsonResponse({ status: 'ok', data: getActivePageSkillPackInfo_() });
    if (action === 'getRakumartSourcingBoard') return jsonResponse({ status:'ok', data:getRakumartSourcingBoard_(e.parameter.pageProjectId || '') });
    if (action === 'getFilterButtons') {
      return jsonResponse({ status: 'ok', buttons: getFilterButtons() });
    }
    if (action === 'getPeriodSummary') {
      const periodKey = e.parameter.periodKey || '';
      return jsonResponse({ status: 'ok', data: getPeriodSummary(periodKey) });
    }

    if (action === 'checkTransactionPerfectDuplicates' || action === 'checkTransactionRepeatedLines') {
      return jsonResponse({ status: 'ok', data: checkTransactionRepeatedLines() });
    }

    if (action === 'writeTransactionRepeatedLineLog') {
      return jsonResponse({ status: 'ok', data: writeTransactionRepeatedLineLog_() });
    }

    if (action === 'dryRunDeduplicateTransactionHistory') {
      return jsonResponse({
        status: 'error',
        message: 'disabled: Amazon transaction reports can contain legitimate repeated lines for multi-unit orders. Use checkTransactionRepeatedLines for inspection only.'
      });
    }

    if (action === 'dryRunSalesActualMovingAverage') {
      const applyActualFields = String(e.parameter.applyActualFields || '') === 'true';
      return jsonResponse({ status: 'ok', data: recalcSalesActualMovingAverage(true, applyActualFields) });
    }

    if (action === 'debugMovingAverageForSku') {
      return jsonResponse({ status: 'ok', data: debugMovingAverageForSku(e.parameter.sku || '') });
    }

    if (action === 'diagnoseMovingAverageCostCoverage') {
      return jsonResponse({ status: 'ok', data: diagnoseMovingAverageCostCoverage(e.parameter.periodKey || '') });
    }

    if (action === 'diagnoseMissingCostSources') {
      return jsonResponse({ status: 'ok', data: diagnoseMissingCostSources(e.parameter.periodKey || '') });
    }

    if (action === 'getManualCostFallbacks') {
      return jsonResponse({ status: 'ok', data: getManualCostFallbacks_() });
    }

    if (action === 'getAvailablePeriods') {
      return jsonResponse({ status: 'ok', periods: getAvailablePeriods() });
    }

    if (action === 'getInventoryAlerts') {
      return jsonResponse({ status: 'ok', data: getInventoryAlerts() });
    }

    if (action === 'getCrossDiagnostics') {
      const periodKey = e.parameter.periodKey || '';
      return jsonResponse({ status: 'ok', data: getCrossDiagnostics(periodKey) });
    }

    if (action === 'getSecretaryState') {
      return jsonResponse({ status:'ok', data:getSecretaryState_() });
    }

    if (action === 'getSecretaryCardDetail') {
      return jsonResponse({ status:'ok', data:getSecretaryCardDetail_(e.parameter.asin || '', e.parameter.category || '') });
    }

    if (action === 'getInboundPlan') {
      return jsonResponse({ status: 'ok', data: getInboundPlan() });
    }

    if (action === 'getReorderManagementData') {
      return jsonResponse({ status: 'ok', data: getReorderManagementData_() });
    }

    if (action === 'getPurchaseNotes') {
      return jsonResponse({ status: 'ok', data: getPurchaseNotes_(e.parameter.productId) });
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

    if (action === 'getHomeInventoryOverview') {
      return jsonResponse({ status:'ok', data:getHomeInventoryOverview_() });
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

    if (action === 'getLandedCostToolConfig') {
      return jsonResponse({ status:'ok', data: getLandedCostToolConfig_() });
    }

    if (action === 'getAsinList') {
      return jsonResponse({ status: 'ok', list: getAsinList_() });
    }

    if (action === 'getProductCatalog') {
      return jsonResponse({ status: 'ok', data: getProductCatalog_() });
    }
    if (action === 'getSearchMarketPeriods') {
      return jsonResponse({ status: 'ok', data: getSearchMarketPeriods_() });
    }
    if (action === 'getSearchMarketSummary') {
      return jsonResponse({ status: 'ok', data: getSearchMarketSummary_(
        e.parameter.asin || '',
        e.parameter.period || '',
        e.parameter.marketplace || ''
      ) });
    }
    if (action === 'getSearchMarketQueryDetail') {
      return jsonResponse({ status: 'ok', data: getSearchMarketQueryDetail_(
        e.parameter.asin || '',
        e.parameter.period || '',
        e.parameter.searchQueryRaw || '',
        e.parameter.marketplace || ''
      ) });
    }
    if (action === 'getSearchMarketQueryHistory') {
      return jsonResponse({ status: 'ok', data: getSearchMarketQueryHistory_(
        e.parameter.asin || '',
        e.parameter.searchQueryRaw || '',
        e.parameter.marketplace || ''
      ) });
    }
    if (action === 'getSearchMarketDiagnostics') {
      return jsonResponse({ status: 'ok', data: getSearchMarketDiagnostics_(
        e.parameter.asin || '',
        e.parameter.period || '',
        e.parameter.marketplace || '',
        e.parameter.lookbackMonths || '4'
      ) });
    }
    if (action === 'getSearchMarketSignals') {
      return jsonResponse({ status: 'ok', data: getSearchMarketSignals_(
        e.parameter.asin || '',
        e.parameter.period || '',
        e.parameter.marketplace || '',
        e.parameter.lookbackMonths || '4'
      ) });
    }
    if (action === 'getSearchMarketNarrative') {
      return jsonResponse({ status: 'ok', data: getSearchMarketNarrative_(
        e.parameter.asin || '',
        e.parameter.period || '',
        e.parameter.marketplace || '',
        e.parameter.lookbackMonths || '4'
      ) });
    }
    if (action === 'getAdvertisingKeywordAnalysis') {
      return jsonResponse({
        status: 'ok',
        data: getAdvertisingKeywordAnalysis_(e.parameter.sessionId || '')
      });
    }
    if (action === 'getProductGrowthData') {
      return jsonResponse({ status: 'ok', data: getProductGrowthData_(e.parameter.asin || '', e.parameter.days || '30', e.parameter.endDate || '') });
    }
    if (action === 'getProductMonthlyData') {
      return jsonResponse({ status: 'ok', data: getProductMonthlyData_(e.parameter.asin || '', e.parameter.months || '12', e.parameter.endPeriod || '') });
    }
    if (action === 'getProductActions') {
      return jsonResponse({ status: 'ok', data: getProductActions_(e.parameter.asin || '', e.parameter.includeArchived === 'true') });
    }
    if (action === 'getListingSnapshot') {
      return jsonResponse({ status: 'ok', data: getListingSnapshot_(e.parameter.asin || '') });
    }
    if (action === 'getProductMarketHistory') {
      return jsonResponse({ status: 'ok', data: getProductMarketHistory_(e.parameter.asin || '', e.parameter.days || '30', e.parameter.endDate || '') });
    }
    if (action === 'getProductConsultations') {
      return jsonResponse({ status: 'ok', data: getProductConsultations_(e.parameter.asin || '') });
    }
    if (action === 'getProductConsultation') {
      return jsonResponse({ status: 'ok', data: getProductConsultation_(e.parameter.sessionId || '') });
    }

    if (action === 'decision_pack') return packAuthOk_(e) ? doGetDecisionPack_(e) : packDeny_();
    if (action === 'audit_pack')    return packAuthOk_(e) ? doGetAuditPack_(e)    : packDeny_();
    if (action === 'pack_view')     return packAuthOk_(e) ? doGetPackView_(e)     : packDeny_();

    return jsonResponse({ status: 'ok', message: 'HAKSAI API v6 is running.' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message, stack: err.stack });
  }
}

function getLandedCostToolConfig_() {
  return {
    url: LANDED_COST_WEBAPP_URL,
    configured: !!LANDED_COST_WEBAPP_URL
  };
}

// ============================================
// POST
// ============================================
function doPost(e) {
   const body = JSON.parse(e.postData.contents);
    try {
    const action = body.action;

    if (CENTRAL_PROTECTED_POST_ACTIONS_.has(action) && !centralAuthOk_(body && body.secret)) {
      return jsonResponse({ status: 'error', message: 'unauthorized' });
    }

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

    if (action === 'fetchAtlasCardDraft') {
      return jsonResponse(fetchAtlasCardDraft_(body.asin));
    }

    if (action === 'saveAtlasCardDraft') {
      return jsonResponse(saveAtlasCardDraft_(body.cardData));
    }

    // Seller ATLASの参入候補専用。PACK_KEYで認証し、ASIN単位でUPSERTする。
    if (action === 'upsertDecisionCard') {
      if (!decisionCardAuthOk_(body)) return jsonResponse({ status: 'error', message: 'invalid key' });
      return jsonResponse(upsertDecisionCard_(body.cardData));
    }

    if (action === 'analyzeCompetitorAsin') {
      return jsonResponse(analyzeCompetitorAsin_(body));
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
      const beforeUpdate = getAllPageProjects().find(function(p) { return String(p.id) === String(projectData.id || ''); });
      const extraImages = body.extraImages || [];
      if (extraImages.length) {
        const newIds = saveImagesToDrive_(extraImages, projectData.id, 'page');
        projectData.extra_image_ids = (Array.isArray(projectData.extra_image_ids) ? projectData.extra_image_ids : []).concat(newIds);
      }
      const ok = updatePageProjectInSheet(projectData);
      if (!ok) return jsonResponse({ status: 'error', message: '更新対象のページ制作案件が見つかりません。' });
      if (beforeUpdate && beforeUpdate.status !== '撤退' && projectData.status === '撤退') {
        logPageProjectEvent_(projectData.id, projectData.source_card_id, 'retired', '', { prev_status: beforeUpdate.status || '' }, 'user');
      }
      return jsonResponse({ status: 'ok', data: projectData });
    }

    if (action === 'generatePageDraft') {
      const projectData = body.projectData || {};
      // 生成ゲートはクライアント送信値ではなく、シートの正本を使用する。
      const storedProject = getAllPageProjects().find(function(p) {
        return String(p.id) === String(projectData.id || '');
      });
      if (storedProject) {
        projectData.sourcing_state = storedProject.sourcing_state;
        projectData.listing_handoff = storedProject.listing_handoff;
        projectData.adopted_candidate_id = storedProject.adopted_candidate_id;
        projectData.sourcing_brief = storedProject.sourcing_brief;
        projectData.tags = storedProject.tags;
      }
      const extraImages = body.extraImages || [];
      const draft = generatePageDraft_(projectData, extraImages);
      projectData.page_draft = Object.assign({}, projectData.page_draft || {}, draft);
      projectData.prompt_pack_meta = getActivePageSkillPackInfo_();
      projectData.updated_at = new Date().toISOString();
      if (extraImages.length) {
        const newIds = saveImagesToDrive_(extraImages, projectData.id, 'page');
        projectData.extra_image_ids = (Array.isArray(projectData.extra_image_ids) ? projectData.extra_image_ids : []).concat(newIds);
      }
      updatePageProjectInSheet(projectData);
      return jsonResponse({ status: 'ok', data: projectData });
    }

    if (action === 'uploadPageSkillPack') {
      return jsonResponse({ status: 'ok', data: uploadPageSkillPack_(body.filename, body.base64) });
    }

    if (action === 'extractPageInputs') {
      const projectData = body.projectData || {};
      const images = body.images || [];
      projectData.extracted_input = extractPageInputsFromScreenshots_(projectData, images);
      projectData.extraction_meta = projectData.extracted_input._meta || {};
      projectData.updated_at = new Date().toISOString();
      if (images.length) {
        const newIds = saveImagesToDrive_(images, projectData.id, 'source');
        projectData.extra_image_ids = (Array.isArray(projectData.extra_image_ids) ? projectData.extra_image_ids : []).concat(newIds);
      }
      updatePageProjectInSheet(projectData);
      return jsonResponse({ status: 'ok', data: projectData });
    }

    if (action === 'generateRakumartSearchBrief') return jsonResponse({ status:'ok', data:generateRakumartSearchBrief_(body.projectData || {}) });
    if (action === 'addRakumartCandidate') return jsonResponse({ status:'ok', data:addRakumartCandidate_(body.pageProjectId, body.candidate || {}, body.images || []) });
    if (action === 'compareRakumartCandidates') return jsonResponse({ status:'ok', data:compareRakumartCandidates_(body.pageProjectId) });
    if (action === 'adoptRakumartCandidate') return jsonResponse({ status:'ok', data:adoptRakumartCandidate_(body.pageProjectId, body.candidateId) });
    if (action === 'adoptExtractedInputAsSupplier') return jsonResponse({ status:'ok', data:adoptExtractedInputAsSupplier_(body.pageProjectId, body.supplierUrl || '') });
    if (action === 'shelvePageProject') return jsonResponse({ status:'ok', data:shelvePageProject_(body.pageProjectId, body.reason, body.wakeAt) });
    if (action === 'wakePageProject') return jsonResponse({ status:'ok', data:wakePageProject_(body.pageProjectId, body.mode, body.wakeAt) });
    if (action === 'logPageProjectEvent') return jsonResponse({ status:'ok', data:logPageProjectEventOncePerDay_(body.pageProjectId, body.eventType, body.reason || '', body.payload || {}) });
    if (action === 'saveOwnListingLink') return jsonResponse({ status:'ok', data:saveOwnListingLink_(body.pageProjectId, body.ownListing || {}) });
    if (action === 'connectOwnListing') return jsonResponse({ status:'ok', data:connectOwnListing_(body.cardId, body.ownListing || {}) });
    if (action === 'setNickname') return jsonResponse({ status:'ok', data:setNickname_(body.cardId, body.nickname) });
    if (action === 'refreshProductVariationLink') return jsonResponse({ status:'ok', data:refreshProductVariationLink_(body.asin) });
    if (action === 'generateRetrospective') return jsonResponse({ status:'ok', data:generateRetrospective_(body.cardId) });
    if (action === 'getLessonsForCandidate') return jsonResponse({ status:'ok', data:getLessonsForCandidate_(body.factPack || {}) });

      if (action === 'syncInventory') {
    const result = syncInventoryFromReport(body.inventoryData || [], body.snapshotDate || '')
    return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'syncInboundPlan') {
      const result = syncInboundPlan(body.rows || [], body.snapshotDate || '');
      return jsonResponse({ status: 'ok', data: result });
    }

      // doPost内に追加
    if (action === 'updateReorderRecord') {
      const result = updateReorderRecord(body.recordId, body.reorderData);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'deleteReorderRecord') {
      return jsonResponse({ status: 'ok', data: deleteReorderRecord_(body.recordId) });
    }

    if (action === 'updateReorderOrderDate') {
      return jsonResponse({ status: 'ok', data: updateReorderOrderDate_(body.recordId, body.orderDate) });
    }

    if (action === 'savePurchaseNote') {
      return jsonResponse({ status: 'ok', data: savePurchaseNote_(body.input || {}) });
    }

    if (action === 'createDomesticOrder') {
      return jsonResponse({ status: 'ok', data: createDomesticOrder_(body.order || {}) });
    }

    if (action === 'updateDomesticOrder') {
      return jsonResponse({ status: 'ok', data: updateDomesticOrder_(body.orderId || '', body.order || {}) });
    }

    if (action === 'cancelDomesticOrder') {
      return jsonResponse({ status: 'ok', data: cancelDomesticOrder_(body.orderId || '') });
    }

    if (action === 'receiveDomesticOrder') {
      return jsonResponse({ status: 'ok', data: receiveDomesticOrder_(body.orderId || '', body.actualArrivalDate || '') });
    }

    if (action === 'bulkRegisterSellingProducts') {
      const result = bulkRegisterSellingProducts(body.products || []);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'syncTransactions') {
      const result = syncTransactions(body.transactions || [], body.periodCosts || [], body.periodKey || '', body.newSkuMappings || []);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'upsertManualCostFallback') {
      return jsonResponse({ status: 'ok', data: upsertManualCostFallback_(body.item || {}) });
    }

    if (action === 'saveProductAction') {
      return jsonResponse({
        status: 'ok',
        data: body.advertisingContext
          ? saveAdvertisingAdjustmentAction_(body.item || {}, body.images || [], body.advertisingContext)
          : saveProductAction_(body.item || {}, body.images || [])
      });
    }
    if (action === 'attachAdvertisingActionAfterSnapshot') {
      return jsonResponse({
        status: 'ok',
        data: attachAdvertisingActionAfterSnapshot_(
          body.actionId || '',
          body.analysisSessionId || ''
        )
      });
    }
    if (action === 'archiveProductAction') {
      return jsonResponse({ status: 'ok', data: archiveProductAction_(body.actionId || '') });
    }
    if (action === 'updateProductActionReview') {
      return jsonResponse({ status: 'ok', data: updateProductActionReview_(body.item || {}) });
    }
    if (action === 'refreshOwnListingSnapshot') {
      return jsonResponse({ status: 'ok', data: refreshOwnListingSnapshot_(body.asin || '') });
    }
    if (action === 'refreshProductMarketHistory') {
      return jsonResponse({ status: 'ok', data: refreshProductMarketHistory_(body.asin || '', body.days || 365) });
    }
    if (action === 'consultProductGrowthMaika') {
      return jsonResponse({ status: 'ok', data: consultProductGrowthMaika_(body.input || {}, body.images || []) });
    }
    if (action === 'sendProductConsultationMessage') {
      return jsonResponse({ status: 'ok', data: sendProductConsultationMessage_(body.input || {}, body.images || []) });
    }
    if (action === 'saveProductContextNote') {
      return jsonResponse({ status: 'ok', data: saveProductContextNote_(body.input || {}) });
    }

    if (action === 'recalcSalesActualMovingAverage') {
      const result = recalcSalesActualMovingAverage(body.dryRun !== false, body.applyActualFields === true);
      return jsonResponse({ status: 'ok', data: result });
    }

    if (action === 'deduplicateTransactionHistory') {
      return jsonResponse({
        status: 'error',
        message: 'disabled: transaction_history automatic dedupe is unsafe for Amazon multi-unit orders.'
      });
    }


    if (action === 'updateSecretaryCard') {
      return jsonResponse({ status:'ok', data:updateSecretaryCard_(body) });
    }

    if (action === 'saveSecretarySettings') {
      return jsonResponse({ status:'ok', data:secSaveSettings_(body.settings || {}) });
    }

    if (action === 'runSecretaryNow') {
      runDailyBrief({ refresh:body.refresh === true });
      return jsonResponse({ status:'ok', data:runAiPortfolioReview_({ trigger:'manual' }) });
    }

    if (action === 'secretaryProductReview') {
      return jsonResponse({ status:'ok', data:secretaryProductReview_(body) });
    }

    if (action === 'secretaryPortfolioReview') {
      return jsonResponse({ status:'ok', data:secretaryPortfolioReview_(body) });
    }

    if (action === 'secretaryPageImprovement') {
      return jsonResponse({ status:'ok', data:secretaryPageImprovement_(body) });
    }

    if (action === 'setupSecretaryTrigger') {
      if (body.confirm !== 'SETUP_SECRETARY_DAILY') throw new Error('確認値が必要です。');
      return jsonResponse({ status:'ok', data:setupSecretaryDailyTrigger() });
    }

    if (action === 'costSimActualize') {
      const dryRun = body.dryRun !== false;
      if (!dryRun && body.confirm !== 'APPLY_COST_SIM_ACTUALS') {
        return jsonResponse({ status: 'error', message: '本適用には確認値が必要です。' });
      }
      return jsonResponse({ status: 'ok', data: actualizeCostSim({ dryRun: dryRun }) });
    }

    if (action === 'costSimBackup') {
      if (body.confirm !== 'BACKUP_PRODUCT_LIFECYCLE') {
        return jsonResponse({ status: 'error', message: 'バックアップには確認値が必要です。' });
      }
      return jsonResponse({ status: 'ok', data: backupProductLifecycleForCostSim() });
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

    if (action === 'setHomeInventoryQuantity') {
      return jsonResponse({ status:'ok', data:setHomeInventoryQuantity_(body.item || {}) });
    }

    if (action === 'bulkSetHomeInventory') {
      return jsonResponse({ status:'ok', data:bulkSetHomeInventory_(body.rows || []) });
    }

    if (action === 'syncAdProductReport') {
          return jsonResponse({ status:'ok', data: syncAdProductReport(body.rows||[], body.rawBase64||'', body.filename||'') });
    }

    if (action === 'previewAdProductReport') {
          return jsonResponse({ status:'ok', data: previewAdProductReport(body.rows||[]) });
    }

    if (action === 'syncBusinessReport') {
          return jsonResponse({ status:'ok', data: syncBusinessReport(body.rows||[], body.dateFrom||'', body.dateTo||'', body.rawBase64||'', body.filename||'') });
    }

    if (action === 'previewSearchQueryPerformance') {
      return jsonResponse({
        status: 'ok',
        data: previewSearchQueryPerformance(body.report || {})
      });
    }

    if (action === 'syncSearchQueryPerformance') {
      return jsonResponse({
        status: 'ok',
        data: syncSearchQueryPerformance(
          body.report || {},
          body.rawBase64 || '',
          body.filename || '',
          body.fileSha256 || ''
        )
      });
    }

    if (action === 'previewAdvertisingKeywordAnalysis') {
      return jsonResponse({
        status: 'ok',
        data: previewAdvertisingKeywordAnalysis(body.request || {})
      });
    }

    if (action === 'runAdvertisingKeywordAnalysis') {
      return jsonResponse({
        status: 'ok',
        data: runAdvertisingKeywordAnalysis(body.request || {})
      });
    }

    if (action === 'setAlertSnooze') {
      const result = setAlertSnooze(body.asin, body.state, body.note || '');
      return jsonResponse({ status: 'ok', data: result });
    }

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action, available_actions: pgDebugModeOn_() ? pgListDispatchedActions_(doPost) : undefined });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message, stack: err.stack });
  }
}

// ============================================
// v6: product_lifecycle CRUD
// ============================================


function getAllCards_ProductLifecycle() {
  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);

  // 一覧で実際に使うJSONだけを解析する。巨大なAI分析・ページ案を
  // 全件JSON.parseしてから捨てると、GASの応答がタイムアウトしやすい。
  const jsonCols = ['tags', 'urls', 'scores', 'profit', 'cost_simulation', 'sales_actual', 'own_listing'];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result', 'own_listing'
  ];
  const boolCols = ['is_deleted', 'is_launched'];

  // 一覧表示に不要な重いフィールドを除外
  const excludeCols = new Set([
    'keepa_data', 'audit', 'produce', 'checks',
    'page_draft', 'actual_result', 'image_drive_ids', 'image_drive_id', 'description',
    'supplier_keywords_json', 'idea_tags_json'
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

function getCardDetail_ProductLifecycle(id) {
  id = String(id || '').trim();
  if (!id) return null;

  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;

  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const idIdx = headers.indexOf('id');
  if (idIdx === -1) throw new Error('product_lifecycle に id 列が見つかりません。');

  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual', 'keepa_data', 'own_listing'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result', 'keepa_data', 'own_listing'
  ];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx] || '').trim() === id) {
      return rowToObject_(headers, data[i], jsonCols, objectCols, BOOLEAN_COLS_LIFECYCLE);
    }
  }
  return null;
}

function normalizeOwnListingObject_(value) {
  let own = value;
  if (typeof own === 'string') {
    try { own = JSON.parse(own || '{}'); } catch (e) { own = {}; }
  }
  own = own && typeof own === 'object' && !Array.isArray(own) ? own : {};
  return {
    primary_asin: String(own.primary_asin || '').trim().toUpperCase(),
    parent_asin: String(own.parent_asin || '').trim().toUpperCase(),
    child_asins: Array.from(new Set((Array.isArray(own.child_asins) ? own.child_asins : []).map(function(x) { return String(x || '').trim().toUpperCase(); }).filter(Boolean))),
    connected_at: String(own.connected_at || ''), updated_at: String(own.updated_at || ''),
    keepa_status: String(own.keepa_status || ''), latest_snapshot_id: String(own.latest_snapshot_id || '')
  };
}

function stableOwnListingJson_(value) {
  const own = normalizeOwnListingObject_(value);
  own.child_asins.sort();
  return JSON.stringify(own);
}

function hasOwnAsin_(ownListing) {
  const own = normalizeOwnListingObject_(ownListing);
  return !!(own.primary_asin || own.parent_asin || own.child_asins.length);
}

function isGraduated_(card, linkedProject) {
  if (!card || card.is_deleted === true) return false;
  if (String(card.origin_type || '') !== 'research' || card.is_launched !== true) return false;
  return hasOwnAsin_(card.own_listing) || !!(linkedProject && hasOwnAsin_(linkedProject.own_listing));
}

function auditOriginTypeBackfill() {
  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const sourceIdx = headers.indexOf('source'), originIdx = headers.indexOf('origin_type'), ownIdx = headers.indexOf('own_listing');
  const sources = {}, pollutedOwnListingCandidates = [];
  for (let i = 1; i < data.length; i++) {
    const source = String(data[i][sourceIdx] || '').trim() || '(blank)';
    const inferred = legacyOriginTypeFromSource_(source === '(blank)' ? '' : source);
    const key = source + ' -> ' + inferred;
    sources[key] = (sources[key] || 0) + 1;
    const existing = String(data[i][originIdx] || '').trim();
    const own = normalizeOwnListingObject_(data[i][ownIdx]);
    if (!hasOwnAsin_(own) && own.connected_at) pollutedOwnListingCandidates.push({ row: i + 1, id: String(data[i][0] || ''), source: source, connected_at: own.connected_at });
    if (existing && ['research','import'].indexOf(existing) < 0) sources['INVALID: ' + existing] = (sources['INVALID: ' + existing] || 0) + 1;
  }
  const result = { rows: Math.max(0, data.length - 1), source_summary: sources, suspicious_own_listing: pollutedOwnListingCandidates };
  Logger.log('auditOriginTypeBackfill: ' + JSON.stringify(result));
  return result;
}

function backfillOriginType() {
  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const sourceIdx = headers.indexOf('source'), originIdx = headers.indexOf('origin_type');
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][originIdx] || '').trim()) continue;
    const source = String(data[i][sourceIdx] || '').trim();
    sheet.getRange(i + 1, originIdx + 1).setValue(legacyOriginTypeFromSource_(source));
    updated++;
  }
  Logger.log('backfillOriginType: ' + updated + '件設定');
  return updated;
}

function legacyOriginTypeFromSource_(source) {
  source = String(source || '').trim();
  return !source || ['inventory_import','csv_import','merged_duplicate'].indexOf(source) >= 0 ? 'import' : 'research';
}

function assertAsinsInSkuMaster_(asins) {
  const list = getAsinList_();
  if (!list.length) throw new Error('sku_masterにASINが登録されていません。先に在庫レポートを同期してください。');
  const valid = new Set(list.map(function(x) { return String(x.asin || '').toUpperCase(); }));
  asins.forEach(function(asin) {
    if (!valid.has(asin)) throw new Error('ASIN "' + asin + '" はsku_masterに存在しません。候補から選択してください。');
  });
}

function findPageProjectByCardId_(cardId) {
  return getAllPageProjects().find(function(p) { return String(p.source_card_id || p.card_id || '') === String(cardId); }) || null;
}

function connectOwnListing_(cardId, input) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const card = getCardDetail_ProductLifecycle(cardId);
    if (!card) throw new Error('カードが見つかりません。');
    input = input || {};
    const primary = lfAsin_(input.primary_asin), parent = lfAsin_(input.parent_asin);
    const children = Array.from(new Set((Array.isArray(input.child_asins) ? input.child_asins : []).map(lfAsin_).filter(Boolean)));
    const asins = [primary, parent].concat(children).filter(Boolean);
    if (!asins.length) throw new Error('自社ASINを1件以上入力してください。');
    assertAsinsInSkuMaster_(asins);
    const project = findPageProjectByCardId_(cardId);
    const competitors = (((project || {}).research_lineage || {}).competitor_asins || []).map(function(x) { return String(x || '').toUpperCase(); });
    asins.forEach(function(asin) { if (competitors.indexOf(asin) >= 0) throw new Error('競合ASINを自社ASINとして登録できません: ' + asin); });
    const old = normalizeOwnListingObject_(card.own_listing), now = new Date().toISOString();
    card.own_listing = { primary_asin:primary, parent_asin:parent, child_asins:children, connected_at:old.connected_at || now, updated_at:now, keepa_status:old.keepa_status || 'not_fetched', latest_snapshot_id:old.latest_snapshot_id || '' };
    card.is_launched = true;
    card.origin_type = card.origin_type || 'research';
    card.asin = primary || parent || children[0];
    if (!updateCardInLifecycle(card)) throw new Error('カードの更新に失敗しました。');
    if (project && !project.document_status) { project.own_listing = card.own_listing; project.document_status = 'candidate_selected'; updatePageProjectInSheet(project); }
    return card;
  } finally { lock.releaseLock(); }
}

function setNickname_(cardId, nickname) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const card = getCardDetail_ProductLifecycle(cardId);
    if (!card) throw new Error('カードが見つかりません。');
    const trimmed = String(nickname || '').trim();
    if (trimmed.length > 40) throw new Error('ニックネームは40文字以内で入力してください。');
    card.nickname = trimmed;
    if (!updateCardInLifecycle(card)) throw new Error('カードの更新に失敗しました。');
    return card;
  } finally { lock.releaseLock(); }
}

function getResearchLessons_() {
  ensureHeaders_(SHEET_RESEARCH_LESSONS, REQUIRED_HEADERS_RESEARCH_LESSONS);
  const sheet = getSheetByName_(SHEET_RESEARCH_LESSONS, REQUIRED_HEADERS_RESEARCH_LESSONS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_RESEARCH_LESSONS);
  const jsonCols = new Set(['entry_thesis_tags','hit_json','missed_json','lessons_json','next_seeds_json','hypothesis_snapshot_json','actual_snapshot_json']);
  return data.slice(1).filter(function(row) { return row[0]; }).map(function(row) {
    const out = {}; headers.forEach(function(h, i) { let v = row[i]; if (jsonCols.has(h)) { try { v = JSON.parse(v || (h.indexOf('snapshot') >= 0 ? '{}' : '[]')); } catch(e) { v = h.indexOf('snapshot') >= 0 ? {} : []; } } out[h] = v; }); return out;
  }).sort(function(a,b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
}

function resolveSaleStartDate_(card) {
  const own = normalizeOwnListingObject_((card || {}).own_listing);
  const candidates = [own.connected_at, card && card.amazon_published_date];
  for (let i = 0; i < candidates.length; i++) { const d = new Date(candidates[i]); if (candidates[i] && !isNaN(d.getTime())) return d; }
  const periods = (Array.isArray(card && card.sales_actual) ? card.sales_actual : []).map(function(x) { return String((x || {}).period || ''); }).filter(function(x) { return /^\d{4}-\d{2}$/.test(x); }).sort();
  return periods.length ? new Date(periods[0] + '-01T00:00:00+09:00') : null;
}

function buildActualPack_(card) {
  const now = new Date();
  const currentPeriod = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const start = resolveSaleStartDate_(card);
  
  const allRows = (Array.isArray(card && card.sales_actual) ? card.sales_actual : [])
    .slice()
    .filter(function(x) { return x && /^\d{4}-\d{2}$/.test(String(x.period || '')); })
    .sort(function(a, b) { return String(a.period).localeCompare(String(b.period)); });

  let isPartialStartMonth = false;
  let daysInMonth = 0;
  let monthDays = 0;
  let startPeriod = null;
  if (start) {
    const y = start.getFullYear();
    const m = start.getMonth();
    startPeriod = y + '-' + String(m + 1).padStart(2, '0');
    monthDays = new Date(y, m + 1, 0).getDate();
    const lastDay = new Date(y, m, monthDays, 23, 59, 59);
    daysInMonth = Math.max(1, Math.min(monthDays, Math.floor((lastDay.getTime() - start.getTime()) / 86400000) + 1));
    isPartialStartMonth = daysInMonth < monthDays;
  }

  const currentMonthRow = allRows.find(function(r) { return r.period === currentPeriod; });
  const completedRows = allRows.filter(function(r) { return r.period !== currentPeriod; });

  let targetRows = [];
  let basis = [];

  const otherCompletedRows = completedRows.filter(function(r) { return r.period !== startPeriod; });

  if (otherCompletedRows.length > 0) {
    completedRows.forEach(function(r) {
      if (r.period === startPeriod && isPartialStartMonth) {
        basis.push({ period: r.period, qty: Number(r.qty) || 0, prorated: false, excluded: true });
      } else {
        targetRows.push(r);
        basis.push({ period: r.period, qty: Number(r.qty) || 0, prorated: false });
      }
    });
    targetRows = targetRows.slice(-3);
    const targetPeriods = new Set(targetRows.map(function(r) { return r.period; }));
    basis = basis.filter(function(b) { return targetPeriods.has(b.period) || b.excluded; });
  } else if (completedRows.length === 1 && completedRows[0].period === startPeriod) {
    const r = completedRows[0];
    if (isPartialStartMonth) {
      const originalQty = Number(r.qty) || 0;
      const adjustedQty = originalQty * monthDays / daysInMonth;
      targetRows.push({
        period: r.period,
        qty: adjustedQty,
        sales_taxin: (Number(r.sales_taxin) || 0) * monthDays / daysInMonth,
        gross_profit: r.gross_profit !== null && r.gross_profit !== undefined ? (Number(r.gross_profit) || 0) * monthDays / daysInMonth : null,
        original_row: r
      });
      basis.push({ period: r.period, qty: Math.round(adjustedQty), prorated: true });
    } else {
      targetRows.push(r);
      basis.push({ period: r.period, qty: Number(r.qty) || 0, prorated: false });
    }
  }

  let provisional = false;
  let data_ready = targetRows.length > 0;

  if (targetRows.length === 0 && currentMonthRow) {
    provisional = true;
    data_ready = true;
    const y = now.getFullYear();
    const m = now.getMonth();
    const daysPassed = now.getDate();
    const totalDays = new Date(y, m + 1, 0).getDate();
    const originalQty = Number(currentMonthRow.qty) || 0;
    const adjustedQty = originalQty * totalDays / daysPassed;
    
    targetRows.push({
      period: currentMonthRow.period,
      qty: adjustedQty,
      sales_taxin: (Number(currentMonthRow.sales_taxin) || 0) * totalDays / daysPassed,
      gross_profit: currentMonthRow.gross_profit !== null && currentMonthRow.gross_profit !== undefined ? (Number(currentMonthRow.gross_profit) || 0) * totalDays / daysPassed : null
    });
    basis.push({ period: currentMonthRow.period, qty: Math.round(adjustedQty), prorated: true });
  }

  const qty = targetRows.reduce(function(s, x) { return s + (Number(x.qty) || 0); }, 0);
  const sales = targetRows.reduce(function(s, x) { return s + (Number(x.sales_taxin) || 0); }, 0);
  const profitRows = targetRows.filter(function(x) {
    const gp = x.original_row ? x.original_row.gross_profit : x.gross_profit;
    return gp !== null && gp !== undefined && Number(x.sales_taxin);
  });
  const profitSales = profitRows.reduce(function(s, x) { return s + (Number(x.sales_taxin) || 0); }, 0);
  const grossProfit = profitRows.reduce(function(s, x) { return s + (Number(x.gross_profit) || 0); }, 0);

  return {
    periods: targetRows.map(function(x) { return x.period; }),
    price: qty > 0 ? sales / qty : null,
    monthly_sales: targetRows.length ? qty / targetRows.length : null,
    profit_rate: profitSales ? grossProfit / profitSales : null,
    qty: qty,
    sales_taxin: sales,
    data_ready: data_ready,
    provisional: provisional,
    basis: basis
  };
}

function buildHypothesisPack_(card, project) {
  const sim = (card && card.cost_simulation && typeof card.cost_simulation === 'object') ? card.cost_simulation : {};
  const price = Number(sim.price) || null, net = Number(sim.net);
  let monthly = Number(sim.monthly_sales || sim.monthly_sold || (card && card.monthly_sales)) || null;
  const keepa = (card && card.keepa_data && typeof card.keepa_data === 'object') ? card.keepa_data : {};
  if (!monthly) monthly = Number(((keepa.product_facts || {}).monthly_sold) || keepa.monthlySold) || null;
  
  const weakness = String((card && card.weakness) || '').trim();
  const freeMemo = String((project && project.extra_texts && project.extra_texts.free_memo) || '').trim();

  return {
    price: price,
    monthly_sales: monthly,
    profit_rate: price && isFinite(net) ? net / price : null,
    thesis: weakness,
    memo: freeMemo.slice(0, 4000),
    scores: (card && card.scores) || {},
    category: (card && card.category) || (project && project.category) || '',
    fact_pack: keepa
  };
}

function deriveVerification_(card, project, lessonsForCard) {
  const startAt = resolveSaleStartDate_(card), days = startAt ? Math.max(0, Math.floor((Date.now() - startAt.getTime()) / 86400000)) : 0;
  const lessons = (lessonsForCard || []).slice().sort(function(a,b){return new Date(a.created_at||0)-new Date(b.created_at||0);});
  const latestLesson = lessons.length ? lessons[lessons.length - 1] : null;
  return { state:latestLesson ? 'verified' : days >= VERIFY_OBSERVE_DAYS ? 'due' : 'observing', days:days, latestLesson:latestLesson, hypothesis:buildHypothesisPack_(card,project), actual:buildActualPack_(card) };
}

function priceBand_(price) { const n = Number(price); if (!isFinite(n) || n < 0) return ''; const low = Math.floor(n / PRICE_BAND_SIZE) * PRICE_BAND_SIZE; return low + '-' + (low + PRICE_BAND_SIZE - 1); }

function saveResearchLesson_(lesson) {
  ensureHeaders_(SHEET_RESEARCH_LESSONS, REQUIRED_HEADERS_RESEARCH_LESSONS);
  const sheet = getSheetByName_(SHEET_RESEARCH_LESSONS, REQUIRED_HEADERS_RESEARCH_LESSONS), headers = getHeaders_(sheet, REQUIRED_HEADERS_RESEARCH_LESSONS);
  const jsonCols = new Set(['entry_thesis_tags','hit_json','missed_json','lessons_json','next_seeds_json','hypothesis_snapshot_json','actual_snapshot_json']);
  sheet.appendRow(headers.map(function(h){ const v=lesson[h]; return jsonCols.has(h) ? JSON.stringify(v == null ? (h.indexOf('snapshot')>=0?{}:[]) : v) : (v == null ? '' : v); }));
  return lesson;
}

function validateRetrospective_(value) {
  if (!value || ['的中','部分的中','外れ'].indexOf(value.verdict) < 0) throw new Error('verdictが不正です。');
  ['hit_hypotheses','missed_hypotheses','lessons','next_seeds'].forEach(function(k){ if(!Array.isArray(value[k])) throw new Error(k+'が配列ではありません。'); });
  value.lessons.forEach(function(x){ if(!x || ['sourcing','ad','listing'].indexOf(x.applies_to)<0) throw new Error('lessons.applies_toが不正です。'); });
  return value;
}

function requestRetrospectiveFromGemini_(hypothesis, actual) {
  const prompt = 'あなたは商品リサーチの検証担当です。事実だけを突き合わせ、データにない要因を断定しないでください。外れた仮説を重視してください。JSONのみ返してください。\n'
    +'【フィールド境界】\n'
    +'- lessons: 複数案件で再利用できる「条件→帰結」のルール。抽象的でよい。例:「月販予測が競合実績の連動値のみに依存する場合、ニッチ市場では過大になる」。※「〜場合がある」のようなヘッジで終わらせず、どんな場合かを条件側に書く（条件→帰結の形を守ること）。\n'
    +'- lessons[].tag: applies_to の値（sourcing/ad/listing）を流用せず、テーマを表す短句にする。例: 需要予測、価格帯xページ品質、セット販売、ブランド代替。\n'
    +'- next_seeds: Amazonの検索窓にそのまま打てる、具体的な商品名の横展開アイデアのみ。例:「熊よけベル」。商品名で言えないもの、判断基準、需要の再定義、調査方法はlessonsへ入れる。該当なしなら必ず空配列[]。\n'
    +'- 判定質問:「それはAmazonの検索窓に打てる言葉か？」打てないならnext_seedsではなくlessonsである。\n'
    +'- verdict: 数値の的中・未達を総合して 的中/部分的中/外れ のいずれか。\n'
    +'入力:'+JSON.stringify({hypothesis_pack:hypothesis,actual_pack:actual})+'\n'
    +'出力スキーマ:{"verdict":"的中|部分的中|外れ","hit_hypotheses":[{"hypothesis":"","evidence":""}],"missed_hypotheses":[{"hypothesis":"","actual":"","why":""}],"lessons":[{"tag":"","text":"条件→帰結","applies_to":"sourcing|ad|listing"}],"next_seeds":[{"idea":"具体的な商品名","basis":"元実例との共通需要"}]}';
  const payload={contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:4096,responseMimeType:'application/json'}};
  const response=JSON.parse(callGeminiWithRetry(payload));
  const text=response.candidates && response.candidates[0] && response.candidates[0].content.parts[0].text;
  return validateRetrospective_(extractJson_(text));
}

function generateRetrospective_(cardId) {
  const card=getCardDetail_ProductLifecycle(cardId); if(!card)throw new Error('カードが見つかりません。');
  
  // keepa_data の補完＆保存
  const asin = card.asin || (card.own_listing && card.own_listing.primary_asin) || '';
  let keepaUpdated = false;
  if ((!card.keepa_data || Object.keys(card.keepa_data).length === 0) && asin) {
    const keepaData = tryGetKeepaData_(asin);
    if (keepaData) {
      card.keepa_data = {
        asin:        asin,
        monthlySold: keepaData.monthlySold,
        imageCount:  keepaData.imageCount,
        hasAplus:    keepaData.hasAplus,
        brand:       keepaData.brand,
        features:    keepaData.features,
      };
      keepaUpdated = true;
    }
  }

  const project=findPageProjectByCardId_(cardId), hypothesis=buildHypothesisPack_(card,project), actual=buildActualPack_(card);
  if(!actual.data_ready)throw new Error('振り返りに必要な販売実績がありません。');

  if (keepaUpdated) {
    const lcSheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
    const lcHeaders = getHeaders_(lcSheet, REQUIRED_HEADERS_LIFECYCLE);
    const keepaDataIdx = lcHeaders.indexOf('keepa_data');
    const meta = readLifecycleMeta_()[asin];
    if (meta && meta.rowNum && keepaDataIdx >= 0) {
      lcSheet.getRange(meta.rowNum, keepaDataIdx + 1).setValue(JSON.stringify(card.keepa_data));
    }
  }

  let result, lastError; for(let attempt=0;attempt<2;attempt++){try{result=requestRetrospectiveFromGemini_(hypothesis,actual);break;}catch(e){lastError=e;}}
  if(!result)throw new Error('振り返りのJSON生成に失敗しました。再試行してください。 '+lastError.message);
  const own=normalizeOwnListingObject_(card.own_listing), now=new Date().toISOString();
  
  const own_asin = own.primary_asin || card.asin || own.parent_asin || (own.child_asins || [])[0] || '';
  const tags = Array.from(new Set(result.lessons.map(function(x){ return x.tag; }).filter(Boolean)));
  
  const lesson={lesson_id:Utilities.getUuid(),card_id:card.id,page_project_id:project?project.id:'',own_asin:own_asin,category:hypothesis.category,price_band:priceBand_(actual.price),entry_thesis_tags:tags,verdict:result.verdict,hit_json:result.hit_hypotheses,missed_json:result.missed_hypotheses,lessons_json:result.lessons,next_seeds_json:result.next_seeds,hypothesis_snapshot_json:hypothesis,actual_snapshot_json:actual,generated_by:GEMINI_MODEL,created_at:now};
  return saveResearchLesson_(lesson);
}

function getLessonsForCandidate_(factPack) {
  factPack=factPack||{};
  const tree=Array.isArray(factPack.category_tree)?factPack.category_tree:[];
  const names=tree.map(function(x){return String((x&&x.name)||x||'');}).filter(Boolean);
  const leaf=names[names.length-1]||String(factPack.category||''), parent=names[names.length-2]||'';
  const band=priceBand_(factPack.price), bandLow=Number(String(band).split('-')[0]);
  const candidateTags=(Array.isArray(factPack.entry_thesis_tags)?factPack.entry_thesis_tags:(Array.isArray(factPack.thesis_tags)?factPack.thesis_tags:[])).map(String);
  const cards=getAllCards_ProductLifecycle(), cardMap={}; cards.forEach(function(c){cardMap[String(c.id)]=c;});
  const results=[];
  getResearchLessons_().forEach(function(x){
    const category=String(x.category||''), low=Number(String(x.price_band||'').split('-')[0]); let score=0, matched=[];
    if(leaf&&category===leaf){score+=3;matched.push('category');}else if(parent&&category.indexOf(parent)>=0){score+=1;matched.push('category');}
    if(band&&isFinite(low)&&Math.abs(low-bandLow)<=PRICE_BAND_SIZE){score+=2;matched.push('price_band');}
    const lessonTags=Array.isArray(x.entry_thesis_tags)?x.entry_thesis_tags.map(String):[];
    if(candidateTags.some(function(t){return lessonTags.indexOf(t)>=0;})){score+=2;matched.push('thesis_tag');}
    if(!score)return;
    const card=cardMap[String(x.card_id)]||{}, h=x.hypothesis_snapshot_json||{}, a=x.actual_snapshot_json||{};
    const start=resolveSaleStartDate_(card), soldDays=start?Math.max(0,Math.floor((Date.now()-start.getTime())/86400000)):0;
    (Array.isArray(x.lessons_json)?x.lessons_json:[]).forEach(function(lesson){
      results.push({score:score,lesson_id:x.lesson_id,verdict:x.verdict,lesson:lesson,
        example:{card_id:x.card_id,title:card.title||category||x.own_asin,own_asin:x.own_asin,
          hypothesis:{price:h.price==null?null:h.price,monthly_qty:h.monthly_sales==null?null:h.monthly_sales,margin:h.profit_rate==null?null:h.profit_rate},
          actual:{price:a.price==null?null:a.price,monthly_qty:a.monthly_sales==null?null:a.monthly_sales,margin:a.profit_rate==null?null:a.profit_rate},sold_days:soldDays},
        matched_on:Array.from(new Set(matched)).join('|'),created_at:x.created_at});
    });
  });
  return results.sort(function(a,b){return b.score-a.score||new Date(b.created_at)-new Date(a.created_at);}).slice(0,5).map(function(x){delete x.score;delete x.created_at;return x;});
}

function normalizeAsin_(asin) {
  const value = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(value)) throw new Error('ASINは10文字の英数字で入力してください。');
  return value;
}

// ASINからAmazon.co.jpの商品ページURLを生成する。
// ATLASの返却値には依存しない。
function getAmazonProductUrlFromAsin_(asin) {
  const value = String(asin || '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(value)
    ? 'https://www.amazon.co.jp/dp/' + value
    : '';
}

// cardData に ASIN があれば amazon_url を補完する。
// すでにURLが入っている場合は上書きしない。
function applyAmazonUrlFromAsin_(cardData) {
  if (!cardData) return cardData;

  const currentUrl = String(cardData.amazon_url || '').trim();
  if (currentUrl) return cardData;

  const url = getAmazonProductUrlFromAsin_(cardData.asin);
  if (url) cardData.amazon_url = url;

  return cardData;
}

// 既存の product_lifecycle データに amazon_url を一括補完する。
// 初回反映後にApps Scriptエディタから1回だけ実行する。
function backfillAmazonUrlsFromAsin() {
  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);

  const sheet = getSheetByName_(
    SHEET_PRODUCT_LIFECYCLE,
    REQUIRED_HEADERS_LIFECYCLE
  );

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { checked: 0, updated: 0, skipped: 0 };
  }

  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const asinIdx = headers.indexOf('asin');
  const amazonUrlIdx = headers.indexOf('amazon_url');

  if (asinIdx < 0 || amazonUrlIdx < 0) {
    throw new Error(
      'product_lifecycle に asin または amazon_url 列が見つかりません。'
    );
  }

  let updated = 0;
  let skipped = 0;

  const values = data.slice(1).map(function(row) {
    const currentUrl = String(row[amazonUrlIdx] || '').trim();
    const generatedUrl = getAmazonProductUrlFromAsin_(row[asinIdx]);

    if (!generatedUrl) {
      skipped++;
      return [currentUrl];
    }

    // 手入力済みURLは保持し、空欄だけ埋める
    if (currentUrl) {
      return [currentUrl];
    }

    updated++;
    return [generatedUrl];
  });

  if (updated > 0) {
    sheet.getRange(2, amazonUrlIdx + 1, values.length, 1).setValues(values);
  }

  return {
    checked: values.length,
    updated: updated,
    skipped: skipped
  };
}

function findLifecycleCardByAsin_(asin) {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const asinIdx = headers.indexOf('asin');
  const idIdx = headers.indexOf('id');
  if (asinIdx < 0 || idIdx < 0) return null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][asinIdx] || '').trim().toUpperCase() === asin) {
      return getCardDetail_ProductLifecycle(String(data[i][idIdx] || '').trim());
    }
  }
  return null;
}

function fetchAtlasCardDraft_(asin) {
  asin = normalizeAsin_(asin);
  const existing = findLifecycleCardByAsin_(asin);
  if (existing) return { status: 'ok', duplicate: true, existingCard: existing };
  if (!ATLAS_API_URL) throw new Error('ATLAS_API_URL が未設定です。');
  if (!ATLAS_API_KEY) throw new Error('ATLAS_API_KEY が未設定です。');
  const response = UrlFetchApp.fetch(ATLAS_API_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({ action: 'haksaiCard', key: ATLAS_API_KEY, asin: asin }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  let json;
  try { json = JSON.parse(text); }
  catch (err) { throw new Error('ATLASから不正な応答が返されました（HTTP ' + code + '）。'); }
  if (code < 200 || code >= 300) throw new Error('ATLASへの接続に失敗しました（HTTP ' + code + '）。');
  if (json.error) throw new Error('ATLASで商品情報を取得できませんでした' + (json.message ? ': ' + json.message : ''));
  const card = json.data;
  if (!card || typeof card !== 'object') throw new Error('ATLASの商品データが空です。');
  card.asin = asin;
  applyAmazonUrlFromAsin_(card);
  card.id = 'atlas_' + asin + '_' + Utilities.getUuid();
  card.status = 'research';
  card.source = 'ATLAS_ASIN_RESEARCH';
  card.origin_type = 'research';
  card.tags = Array.isArray(card.tags) ? card.tags : [];
  if (card.tags.indexOf('ATLAS') < 0) card.tags.push('ATLAS');
  if (card.tags.indexOf('Keepa') < 0) card.tags.push('Keepa');
  return { status: 'ok', duplicate: false, cardData: card };
}

function saveAtlasCardDraft_(cardData) {
  if (!cardData || typeof cardData !== 'object') throw new Error('保存するカードデータがありません。');
  const asin = normalizeAsin_(cardData.asin);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = findLifecycleCardByAsin_(asin);
    if (existing) return { status: 'ok', duplicate: true, existingCard: existing };
    cardData.asin = asin;
    cardData.id = cardData.id || ('atlas_' + asin + '_' + Utilities.getUuid());
    cardData.status = 'research';
    cardData.source = 'ATLAS_ASIN_RESEARCH';
    cardData.origin_type = 'research';
    saveCardToLifecycle(cardData);
    return { status: 'ok', duplicate: false, card: cardData };
  } finally { lock.releaseLock(); }
}

function decisionCardAuthOk_(body) {
  const expected = typeof getPackKey_ === 'function' ? getPackKey_() : '';
  return !!expected && String((body && body.key) || '') === expected;
}

/**
 * ATLASの一次スクリーニング結果を商品カルテへUPSERTする。
 * 人間が後から入力した値は、ATLASが空値を送っても消さない。
 */
function upsertDecisionCard_(incoming) {
  if (!incoming || typeof incoming !== 'object') throw new Error('cardData required');
  const asin = normalizeAsin_(incoming.asin);
  const screen = incoming.keepa_data && incoming.keepa_data.decision_screen;
  if (!screen || screen.pipeline !== 'sourcing-decision') throw new Error('invalid decision_screen');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
    const data = sheet.getDataRange().getValues();
    const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
    const asinIdx = headers.indexOf('asin');
    let rowIndex = -1;
    let existing = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][asinIdx] || '').trim().toUpperCase() !== asin) continue;
      const candidate = rowToObject_(headers, data[i], JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
      const priorScreen = candidate.keepa_data && candidate.keepa_data.decision_screen;
      if ((priorScreen && priorScreen.pipeline === 'sourcing-decision') ||
          ['ATLAS_SOURCING_DECISION','ATLAS_ASIN_RESEARCH','Seller ATLAS'].indexOf(candidate.source) >= 0) {
        rowIndex = i + 1; existing = candidate; break;
      }
    }

    const now = new Date().toISOString();
    let card = existing ? mergeDecisionCard_(existing, incoming) : Object.assign({}, incoming);
    card.asin = asin;
    card.id = existing ? existing.id : ('atlas_decision_' + asin);
    card.status = existing && existing.status ? existing.status : 'research';
    card.source = 'ATLAS_SOURCING_DECISION';
    card.origin_type = existing && existing.origin_type ? existing.origin_type : 'research';
    card.created_at = existing && existing.created_at ? existing.created_at : now;
    card.updated_at = now;
    card.tags = Array.from(new Set((Array.isArray(card.tags) ? card.tags : []).concat(['ATLAS', 'Keepa', 'SourcingDecision'])));
    applyAmazonUrlFromAsin_(card);

    const row = buildRowFromHeaders_(headers, card, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
    if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    upsertDecisionCandidateProjection_(card);
    return { status: 'ok', action: rowIndex > 0 ? 'updated' : 'created', cardId: card.id, asin: asin };
  } finally {
    lock.releaseLock();
  }
}

function mergeDecisionCard_(existing, incoming) {
  const merged = Object.assign({}, existing);
  // ATLASは事実パックと表示用の自動項目だけ更新できる。
  // human_input・判断・ページ制作成果は将来フィールドが増えても上書きさせない。
  const allowed = new Set([
    'category','title','summary','price','monthly_sales','reviews','emoji','tags','weakness',
    'audit','produce','scores','urls','asin','parent_asin','amazon_url','keepa_data'
  ]);
  Object.keys(incoming).filter(function(key) { return allowed.has(key); }).forEach(function(key) {
    const value = incoming[key];
    if (value !== '' && value !== null && value !== undefined) merged[key] = value;
  });
  // 後工程の人間入力を保持し、ATLAS管理領域だけを更新する。
  merged.page_draft = existing.page_draft || {};
  merged.actual_result = existing.actual_result || {};
  if (existing.current_landed_cost) merged.current_landed_cost = existing.current_landed_cost;
  if (existing.supplier_1688_url) merged.supplier_1688_url = existing.supplier_1688_url;
  return merged;
}

/** decision_pack互換用。product_lifecycleを正本とし、このシートは投影として扱う。 */
function upsertDecisionCandidateProjection_(card) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet) sheet = ss.insertSheet('keepa_research_candidates');
  const required = ['asin','fetched_at','category_name','price_min','price_max','amazon_url','keepa_url',
    'title','brand','status','monthly_sold','offer_count','fba_count','image_count','has_aplus',
    'source_pipeline','rule_version','screen_result'];
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, required.length).setValues([required]);
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const missing = required.filter(function(h) { return currentHeaders.indexOf(h) < 0; });
  if (missing.length) sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const pack = card.keepa_data || {}, pf = pack.product_facts || {}, pg = pack.page_facts || {};
  const mf = pack.market_facts || {}, screen = pack.decision_screen || {};
  const record = {
    asin: card.asin, fetched_at: pack.fetched_at || card.updated_at, category_name: card.category || '',
    price_min: pf.price == null || pf.price === '' ? null : pf.price,
    price_max: pf.price == null || pf.price === '' ? null : pf.price,
    amazon_url: card.amazon_url || '', keepa_url: (card.urls || []).filter(function(u){ return String(u).indexOf('keepa.com') >= 0; })[0] || '',
    title: card.title || pf.title || '', brand: pf.brand || '', status: 'ATLAS候補',
    monthly_sold: pf.monthly_sold === '' ? null : pf.monthly_sold,
    offer_count: mf.total_offer_count == null ? null : mf.total_offer_count,
    fba_count: mf.fba_offer_count == null ? null : mf.fba_offer_count,
    image_count: pg.image_count == null || pg.image_count === '' ? null : pg.image_count,
    has_aplus: pg.has_aplus == null ? null : pg.has_aplus,
    source_pipeline: screen.pipeline, rule_version: screen.rule_version || '', screen_result: screen.result || ''
  };
  let targetRow = -1;
  let existingRow = null;
  if (sheet.getLastRow() >= 2) {
    const asinCol = headers.indexOf('asin') + 1;
    const values = sheet.getRange(2, asinCol, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim().toUpperCase() === card.asin) {
        targetRow = i + 2;
        existingRow = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
        break;
      }
    }
  }
  if (existingRow) {
    const currentStatus = String(existingRow[headers.indexOf('status')] || '').trim();
    if (currentStatus && currentStatus !== '未確認' && currentStatus !== 'ATLAS候補') record.status = currentStatus;
  }
  const row = headers.map(function(h, i) {
    return Object.prototype.hasOwnProperty.call(record, h) ? record[h] : (existingRow ? existingRow[i] : '');
  });
  if (targetRow > 0) sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}

function setAtlasConnection(url, apiKey) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ATLAS_API_URL', String(url || '').trim());
  props.setProperty('ATLAS_API_KEY', String(apiKey || '').trim());
  return 'ATLAS connection saved';
}

function saveCardToLifecycle(cardData) {
  if (!cardData || !cardData.id) throw new Error('cardData.id がありません。');
  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  applyAmazonUrlFromAsin_(cardData);
  if (!cardData.keepa_data && cardData.page_draft && cardData.page_draft.atlas_fact_pack) {
    cardData.keepa_data = cardData.page_draft.atlas_fact_pack;
  }
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const now = new Date().toISOString();
  cardData.created_at = cardData.created_at || now;
  cardData.updated_at = cardData.updated_at || now;
  cardData.status = cardData.status || 'research';
  cardData.origin_type = cardData.origin_type || (cardData.source === 'inventory_import' ? 'import' : 'research');
  cardData.page_draft = cardData.page_draft || {};
  cardData.actual_result = cardData.actual_result || {};
  sheet.appendRow(buildRowFromHeaders_(headers, cardData, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE));
}

function updateCardInLifecycle(cardData) {
  if (!cardData || !cardData.id) throw new Error('cardData.id がありません。');
  applyAmazonUrlFromAsin_(cardData);
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  cardData.updated_at = new Date().toISOString();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(cardData.id)) {
      const stored = rowToObject_(headers, data[i], JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
      if (!cardData.origin_type) cardData.origin_type = stored.origin_type || (cardData.source === 'inventory_import' ? 'import' : 'research');
      const oldOwnJson = stableOwnListingJson_(stored.own_listing);
      const newOwnJson = stableOwnListingJson_(cardData.own_listing);
      const row = buildRowFromHeaders_(headers, cardData, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
      if (oldOwnJson !== newOwnJson) {
        const projects = getAllPageProjects();
        const p = projects.find(function(x) { return String(x.source_card_id) === String(cardData.id); });
        if (p) {
          p.own_listing = normalizeOwnListingObject_(cardData.own_listing);
          if (!updatePageProjectInSheet(p)) throw new Error('ページ制作案件のown_listing同期に失敗しました。');
        }
      }
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
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(function(header) { return String(header || '').trim(); });
  const missingHeaders = REQUIRED_HEADERS_REORDER.filter(function(header) {
    return headers.indexOf(header) < 0;
  });
  if (missingHeaders.length) {
    throw new Error('reorder_history required headers missing: ' + missingHeaders.join(', '));
  }
  const duplicateHeaders = headers.filter(function(header, index) {
    return header && headers.indexOf(header) !== index;
  });
  if (duplicateHeaders.length) {
    throw new Error('reorder_history duplicate headers: ' + Array.from(new Set(duplicateHeaders)).join(', '));
  }

  const record = {
    id: recordId,
    product_id: productId,
    sku: reorderData.sku || '',
    order_date: reorderData.order_date,
    quantity: reorderData.quantity,
    unit_price_1688: reorderData.unit_price_1688 || null,
    landed_cost_actual: reorderData.landed_cost_actual,
    lead_time_days: reorderData.lead_time_days || null,
    expected_arrival_date: reorderData.expected_arrival_date || null,
    fba_fee_at_order: reorderData.fba_fee_at_order || null,
    selling_price_at_order: reorderData.selling_price_at_order || null,
    notes: reorderData.notes || '',
    created_at: now
  };
  sheet.appendRow(buildRowFromHeaders_(headers, record, [], [], []));

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
// リサーチ司令室(React版central-frontend専用、読み取り専用)
// product_lifecycle + page_projects を読み替えて集計するだけで、
// シート・トリガー・プロパティは一切変更しない。
// ============================================
const RCC_RESEARCH_SOURCES_ = [
  'ATLAS_SOURCING_DECISION',
  'ATLAS_ASIN_RESEARCH',
  'Seller ATLAS',
  'SECRETARY_COMPETITOR_ANALYSIS'
];
const RCC_FIELDS_ = [
  'asin', 'title', 'category', 'price', 'monthly_sales', 'reviews', 'human_memo',
  'keepa_data', 'product_facts', 'page_facts', 'decision_screen', 'images', 'supplier', 'page_project'
];
const RCC_STAGE_LABELS_ = {
  research_pool: 'リサーチプール', screened: '選別済み', supplier_materials: '仕入・素材収集',
  page_production: 'ページ制作中', launched: '販売中', archived: '終了'
};
const RCC_SOURCE_LABELS_ = {
  atlas: 'ATLAS', asin_research: 'ASIN起点リサーチ', secretary: 'マイカ(競合分析)',
  legacy: '旧カード', seed: '種(アイデア)'
};
const RCC_DECISION_RESULT_LABELS_ = {
  INSUFFICIENT_DATA: 'データ不足(判定保留)',
  GO: 'GO判定',
  NO_GO: 'NO GO判定',
  WATCH: '継続ウォッチ'
};
const RCC_REASON_LABELS_ = {
  DEMAND_UNKNOWN: '需要が不明'
};
const RCC_MISSING_FIELD_LABELS_ = {
  rakumart_url: '仕入先URL', cny_unit_cost: '仕入原価(元)', landed_cost_est: '着地原価見込み',
  competitors_3plus: '競合3件以上の比較', low_rating_reviews: '低評価レビューの確認',
  regulatory_check: '規制チェック', monthly_sold: '月間販売数'
};

function rccRows_(sheetName) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 1) return { exists: false, rows: [] };
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const rows = values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== '' && value !== null; });
  }).map(function(row) {
    const item = {};
    headers.forEach(function(header, index) { if (header) item[header] = row[index]; });
    return item;
  });
  return { exists: true, rows: rows };
}

function rccJson_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch (e) { return fallback; }
}

function rccBool_(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'yes'].indexOf(String(value || '').trim().toLowerCase()) >= 0;
}

function rccDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function rccLabelList_(codes, dict) {
  if (!Array.isArray(codes)) return [];
  return codes.map(function(code) {
    const key = String(code || '').trim();
    return dict[key] || key;
  }).filter(Boolean);
}

function rccCategoryPath_(tree) {
  if (!Array.isArray(tree)) return '';
  return tree.map(function(node) { return String((node && node.name) || '').trim(); }).filter(Boolean).join(' > ');
}

function rccLastValidPct_(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const value = Number(arr[i]);
    if (isFinite(value) && value >= 0) return value;
  }
  return null;
}

function rccKeepaFacts_(pack) {
  if (!pack || !Object.keys(pack).length) return null;
  const pf = pack.product_facts || {};
  const mf = pack.market_facts || {};
  const screen = pack.decision_screen || {};
  const resultCode = String(screen.result || '').trim();
  return {
    brand: String(pf.brand || '').trim(),
    category_path: rccCategoryPath_(pf.category_tree),
    variation_count: Number(pf.variation_count || 0),
    sales_rank_drops_30: Number(pf.sales_rank_drops_30 || 0),
    sales_rank_drops_90: Number(pf.sales_rank_drops_90 || 0),
    offer_count: Number(mf.total_offer_count || 0),
    buybox_is_amazon: !!mf.buy_box_is_amazon,
    out_of_stock_pct_90: rccLastValidPct_(mf.out_of_stock_pct_90),
    decision_result_label: resultCode ? (RCC_DECISION_RESULT_LABELS_[resultCode] || resultCode) : '',
    reason_labels: rccLabelList_(screen.reason_codes, RCC_REASON_LABELS_),
    missing_field_labels: rccLabelList_(screen.missing_fields, RCC_MISSING_FIELD_LABELS_)
  };
}

function rccIsResearchCard_(card) {
  const origin = String(card.origin_type || '').trim();
  const source = String(card.source || '').trim();
  const pack = rccJson_(card.keepa_data, {});
  const screen = pack.decision_screen || {};
  return origin === 'research' || RCC_RESEARCH_SOURCES_.indexOf(source) >= 0 || screen.pipeline === 'sourcing-decision';
}

function rccSourceGroup_(card, asin) {
  const source = String(card.source || '').trim();
  if (source === 'ATLAS_SOURCING_DECISION' || source === 'Seller ATLAS') return 'atlas';
  if (source === 'ATLAS_ASIN_RESEARCH') return 'asin_research';
  if (source === 'SECRETARY_COMPETITOR_ANALYSIS') return 'secretary';
  if (!asin) return 'seed';
  return 'legacy';
}

function rccHasSupplier_(card, project) {
  if (String(card.supplier_1688_url || '').trim()) return true;
  if (!project) return false;
  const brief = rccJson_(project.sourcing_brief, {});
  const comparison = rccJson_(project.sourcing_comparison, {});
  const extra = rccJson_(project.extra_texts, {});
  return !!String(extra.supplier_url || '').trim() || Object.keys(brief).length > 0 || Object.keys(comparison).length > 0;
}

function rccHasImages_(card, project) {
  const cardImages = rccJson_(card.image_drive_ids, []);
  if ((Array.isArray(cardImages) && cardImages.length) || String(card.image_drive_id || '').trim()) return true;
  if (!project) return false;
  const projectImages = rccJson_(project.image_drive_ids, []);
  const extraImages = rccJson_(project.extra_image_ids, []);
  return (Array.isArray(projectImages) && projectImages.length > 0) || (Array.isArray(extraImages) && extraImages.length > 0);
}

function rccHasOwnAsin_(value) {
  const own = rccJson_(value, {});
  if (Array.isArray(own)) return own.some(function(item) { return !!String(item && item.asin || '').trim(); });
  return !!String(own.asin || '').trim();
}

function rccStage_(archived, launched, linkedPage, hasSupplier, screen) {
  if (archived) return 'archived';
  if (launched) return 'launched';
  if (linkedPage) return 'page_production';
  if (hasSupplier) return 'supplier_materials';
  if (screen && Object.keys(screen).length) return 'screened';
  return 'research_pool';
}

function rccStatus_(archived, launched, rawStatus) {
  if (archived) return 'closed';
  if (launched) return 'launched';
  const status = String(rawStatus || '').trim().toLowerCase();
  if (/hold|保留|stop|pause/.test(status)) return 'hold';
  if (/go|promising|有望|favorite/.test(status)) return 'promising';
  return 'reviewing';
}

function rccNextAction_(stage, missingCore, hasSupplier, linkedPage) {
  if (missingCore.length) return '商品データ(ASIN・価格・月販・商品データ)を補完する';
  if (stage === 'research_pool') return '判断材料を評価する';
  if (stage === 'screened') return '仕入先を探す';
  if (stage === 'supplier_materials' && !linkedPage) return 'ページ案を作成する';
  if (stage === 'page_production' && !hasSupplier) return '仕入情報を接続する';
  if (stage === 'page_production') return 'ページ案を完成させる';
  if (stage === 'launched') return '実績を追う';
  return '終了済み';
}

function getResearchCommandCenterData_() {
  const now = new Date();
  const lifecycle = rccRows_(SHEET_PRODUCT_LIFECYCLE);
  const pageProjects = rccRows_(SHEET_PAGE_PROJECTS);
  const researchCards = lifecycle.rows.filter(rccIsResearchCard_);

  const pageByCard = {};
  pageProjects.rows.forEach(function(project) {
    const cardId = String(project.source_card_id || '').trim();
    if (!cardId) return;
    if (!pageByCard[cardId] || (rccDate_(project.updated_at) || 0) > (rccDate_(pageByCard[cardId].updated_at) || 0)) {
      pageByCard[cardId] = project;
    }
  });

  const sourceCounts = {}, stageCounts = {};
  let active = 0, readyForPage = 0, linkedPages = 0, needsSupplier = 0, updated30d = 0;

  const cards = researchCards.map(function(card) {
    const id = String(card.id || '').trim();
    const asin = String(card.asin || '').trim().toUpperCase();
    const pack = rccJson_(card.keepa_data, {});
    const pf = pack.product_facts || {};
    const pg = pack.page_facts || {};
    const screen = pack.decision_screen || {};
    const linkedPage = pageByCard[id] || null;
    const isArchived = rccBool_(card.is_deleted);
    const isLaunched = rccBool_(card.is_launched) || rccHasOwnAsin_(card.own_listing);
    const hasSupplier = rccHasSupplier_(card, linkedPage);
    const hasImages = rccHasImages_(card, linkedPage);
    const updatedAt = rccDate_(card.updated_at);
    const daysAgo = updatedAt ? Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 86400000)) : null;
    const decision = String(screen.result || screen.decision || screen.final_decision || '').trim();
    const stage = rccStage_(isArchived, isLaunched, linkedPage, hasSupplier, screen);
    const sourceGroup = rccSourceGroup_(card, asin);

    const price = Number(pf.price == null ? card.price : pf.price) || 0;
    const monthlySales = Number(pf.monthly_sold == null ? card.monthly_sales : pf.monthly_sold) || 0;
    const reviews = Number(pf.review_count == null ? card.reviews : pf.review_count) || 0;
    const title = String(card.title || pf.title || '').trim() || (asin || 'タイトル未設定');
    const audit = rccJson_(card.audit, {});
    const maicaComment = String(audit.commentary || '').trim();
    const description = String(pg.description || '').trim();
    const features = Array.isArray(pg.features) ? pg.features.map(function(f) { return String(f || '').trim(); }).filter(Boolean) : [];
    const imageUrls = Array.isArray(pg.image_urls) ? pg.image_urls.map(function(u) { return String(u || '').trim(); }).filter(Boolean) : [];
    const keepaFacts = rccKeepaFacts_(pack);

    const presence = {
      asin: !!asin,
      title: !!String(card.title || pf.title || '').trim(),
      category: !!String(card.category || '').trim(),
      price: price > 0,
      monthly_sales: monthlySales > 0,
      reviews: reviews > 0 || !!pf.review_count,
      human_memo: !!String(card.summary || card.weakness || '').trim(),
      keepa_data: Object.keys(pack).length > 0,
      product_facts: Object.keys(pf).length > 0,
      page_facts: Object.keys(pg).length > 0,
      decision_screen: Object.keys(screen).length > 0,
      images: hasImages,
      supplier: hasSupplier,
      page_project: !!linkedPage
    };
    const presentCount = RCC_FIELDS_.filter(function(field) { return presence[field]; }).length;
    const missingCore = ['asin', 'price', 'monthly_sales', 'product_facts'].filter(function(key) { return !presence[key]; });

    sourceCounts[sourceGroup] = (sourceCounts[sourceGroup] || 0) + 1;
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    if (stage !== 'launched' && stage !== 'archived') active++;
    if (linkedPage) linkedPages++;
    if (daysAgo !== null && daysAgo <= 30) updated30d++;
    if (missingCore.length === 0 && !linkedPage && stage !== 'archived') readyForPage++;
    if (stage === 'page_production' && !hasSupplier) needsSupplier++;

    return {
      id: id,
      asin: asin,
      title: title,
      category: String(card.category || '').trim(),
      source: String(card.source || '').trim(),
      source_group: sourceGroup,
      source_label: RCC_SOURCE_LABELS_[sourceGroup] || sourceGroup,
      status_raw: String(card.status || '').trim(),
      status: rccStatus_(isArchived, isLaunched, card.status),
      stage: stage,
      stage_label: RCC_STAGE_LABELS_[stage] || stage,
      decision: decision,
      price: price,
      monthly_sales: monthlySales,
      reviews: reviews,
      memo: String(card.summary || card.weakness || '').trim(),
      updated_at: updatedAt ? updatedAt.toISOString() : '',
      updated_days_ago: daysAgo,
      completeness_score: Math.round(presentCount / RCC_FIELDS_.length * 100),
      missing_core: missingCore,
      has_images: hasImages,
      has_supplier: hasSupplier,
      is_legacy: sourceGroup === 'legacy',
      next_action: rccNextAction_(stage, missingCore, hasSupplier, linkedPage),
      maica_comment: maicaComment,
      description: description,
      features: features,
      image_urls: imageUrls,
      keepa_facts: keepaFacts,
      page_project: linkedPage ? {
        id: String(linkedPage.id || ''),
        status: String(linkedPage.status || ''),
        sourcing_state: String(linkedPage.sourcing_state || ''),
        updated_at: linkedPage.updated_at ? String(linkedPage.updated_at) : ''
      } : null
    };
  }).sort(function(a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });

  return {
    generated_at: now.toISOString(),
    read_only: true,
    terminology: { external_tool: 'ATLAS', canonical_card_sheet: 'product_lifecycle', canonical_page_sheet: 'page_projects' },
    summary: {
      total: researchCards.length,
      active: active,
      ready_for_page: readyForPage,
      linked_page_projects: linkedPages,
      needs_supplier: needsSupplier,
      updated_within_30d: updated30d
    },
    source_counts: sourceCounts,
    stage_counts: stageCounts,
    cards: cards
  };
}

// ============================================
// page_projects（v5 互換性保持）
// ============================================
function getAllPageProjects() {
  ensureHeaders_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
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
  ensureHeaders_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  const sheet = getSheetByName_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_PAGE);
  const now = new Date().toISOString();
  projectData.created_at = projectData.created_at || now;
  projectData.updated_at = projectData.updated_at || now;
  sheet.appendRow(buildRowFromHeaders_(headers, projectData, JSON_COLS_PAGE, OBJECT_JSON_COLS_PAGE, BOOLEAN_COLS_PAGE));
}

function updatePageProjectInSheet(projectData) {
  if (!projectData || !projectData.id) throw new Error('projectData.id がありません。');
  ensureHeaders_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
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

function getPageProjectEvents_() {
  const sheet = getSheetByName_(SHEET_PAGE_EVENTS, REQUIRED_HEADERS_PAGE_EVENTS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_PAGE_EVENTS);
  return data.slice(1).filter(function(row) { return row[0]; }).map(function(row) {
    const event = {};
    headers.forEach(function(h, i) { event[h] = row[i]; });
    try { event.payload = event.payload_json ? JSON.parse(event.payload_json) : {}; }
    catch (_) { event.payload = {}; }
    return event;
  });
}

function logPageProjectEvent_(projectId, sourceCardId, eventType, reason, payload, actor) {
  const sheet = getSheetByName_(SHEET_PAGE_EVENTS, REQUIRED_HEADERS_PAGE_EVENTS);
  const event = {
    event_id: Utilities.getUuid(), page_project_id: projectId, source_card_id: sourceCardId || '',
    event_type: eventType, reason: reason || '', payload_json: JSON.stringify(payload || {}),
    actor: actor || 'user', created_at: new Date().toISOString()
  };
  sheet.appendRow(REQUIRED_HEADERS_PAGE_EVENTS.map(function(h) { return event[h] || ''; }));
  return event;
}

function logPageProjectEventOncePerDay_(projectId, eventType, reason, payload) {
  const project = getAllPageProjects().find(function(p) { return String(p.id) === String(projectId); });
  if (!project) throw new Error('ページ案件が見つかりません。');
  const today = new Date().toISOString().slice(0, 10);
  const exists = getPageProjectEvents_().some(function(e) {
    return String(e.page_project_id) === String(projectId)
      && String(e.event_type) === String(eventType)
      && String(e.created_at || '').slice(0, 10) === today;
  });
  return exists ? { duplicate:true } : logPageProjectEvent_(project.id, project.source_card_id, eventType, reason, payload, 'user');
}

function shelvePageProject_(projectId, reason, wakeAt) {
  reason = String(reason || '').trim();
  if (!reason) throw new Error('寝かせ理由を入力してください。');
  const project = getAllPageProjects().find(function(p) { return String(p.id) === String(projectId); });
  if (!project) throw new Error('ページ案件が見つかりません。');
  const prevStatus = project.status || '';
  const now = new Date().toISOString();
  project.shelf_state = 'shelved';
  project.shelved_at = now;
  project.wake_at = String(wakeAt || '').trim();
  project.shelf_reason = reason;
  updatePageProjectInSheet(project);
  logPageProjectEvent_(project.id, project.source_card_id, 'shelved', reason, { wake_at:project.wake_at, prev_status:prevStatus }, 'user');
  return project;
}

function wakePageProject_(projectId, mode, wakeAt) {
  const project = getAllPageProjects().find(function(p) { return String(p.id) === String(projectId); });
  if (!project) throw new Error('ページ案件が見つかりません。');
  mode = String(mode || 'manual');
  const events = getPageProjectEvents_().filter(function(e) { return String(e.page_project_id) === String(project.id); });
  const extendCount = events.filter(function(e) { return e.event_type === 'shelf_extended'; }).length;
  if (mode === 'extend') {
    const nextWake = String(wakeAt || '').trim();
    if (!nextWake) throw new Error('次の見直し日を指定してください。');
    project.shelf_state = 'shelved';
    project.wake_at = nextWake;
    updatePageProjectInSheet(project);
    logPageProjectEvent_(project.id, project.source_card_id, 'shelf_extended', project.shelf_reason || '', { wake_at:nextWake, extend_count:extendCount + 1 }, 'user');
    return project;
  }
  if (mode === 'retire') {
    const shelvedAt = new Date(project.shelved_at || Date.now());
    const shelvedDays = Math.max(0, Math.floor((Date.now() - shelvedAt.getTime()) / 86400000));
    project.shelf_state = '';
    project.wake_at = '';
    project.status = '撤退';
    updatePageProjectInSheet(project);
    logPageProjectEvent_(project.id, project.source_card_id, 'retired_from_shelf', project.shelf_reason || '', { shelved_days:shelvedDays, extend_count:extendCount }, 'user');
    return project;
  }
  project.shelf_state = '';
  project.shelved_at = '';
  project.wake_at = '';
  project.shelf_reason = '';
  updatePageProjectInSheet(project);
  logPageProjectEvent_(project.id, project.source_card_id, 'woke_manual', '', {}, 'user');
  return project;
}

function recordDueWakeEvents_(projects) {
  const now = Date.now(), events = getPageProjectEvents_();
  (projects || []).forEach(function(project) {
    const wake = project.shelf_state === 'shelved' && project.wake_at ? new Date(project.wake_at).getTime() : NaN;
    if (!isFinite(wake) || wake > now) return;
    const already = events.some(function(e) {
      return String(e.page_project_id) === String(project.id) && e.event_type === 'woke_due'
        && String((e.payload || {}).wake_at || '') === String(project.wake_at);
    });
    if (!already) logPageProjectEvent_(project.id, project.source_card_id, 'woke_due', project.shelf_reason || '', { wake_at:project.wake_at }, 'system');
  });
}

function getShelfDigestForSecretary_(projects) {
  projects = projects || getAllPageProjects();
  const events = getPageProjectEvents_(), now = Date.now(), extendCounts = {};
  events.forEach(function(e) {
    if (e.event_type === 'shelf_extended') extendCounts[e.page_project_id] = (extendCounts[e.page_project_id] || 0) + 1;
  });
  const shelved = projects.filter(function(p) { return p.shelf_state === 'shelved' && p.status !== '撤退'; });
  const due = shelved.filter(function(p) {
    const t = p.wake_at ? new Date(p.wake_at).getTime() : NaN;
    return isFinite(t) && t <= now;
  });
  const reviews = events.filter(function(e) { return e.event_type === 'shelf_review_done'; })
    .sort(function(a,b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return {
    shelved_count:shelved.length,
    due_count:due.length,
    due_items:due.map(function(p) { return { id:p.id, title:p.title, shelf_reason:p.shelf_reason, wake_at:p.wake_at }; }),
    last_review_at:reviews.length ? reviews[0].created_at : '',
    extend_counts:extendCounts,
    config:{ stale_days:PAGE_STALE_DAYS, review_interval_days:SHELF_REVIEW_INTERVAL_DAYS, extend_nudge_count:SHELF_EXTEND_NUDGE_COUNT }
  };
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
  cardData = hydrateAtlasCardForPageProject_(cardData);
  const atlasFactPack = getAtlasFactPackFromCard_(cardData);
  const atlasFactText = formatAtlasFactPackForPage_(atlasFactPack);
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
      competitor_reviews: atlasFactText || '',
      supplier_url: '',
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
      backend_keywords: '',
      atlas_fact_pack: atlasFactPack || null
    },
    memo: '',
    import_decision: {
      page_score: '',
      decision: '',
      reason: ''
    },
    extracted_input: {},
    extraction_meta: {},
    prompt_pack_meta: getActivePageSkillPackInfo_(),
    sourcing_state: 'needs_search_brief',
    adopted_candidate_id: '',
    sourcing_brief: {},
    sourcing_comparison: {},
    supplier_selection: {},
    listing_handoff: {},
    consultation_memo: '',
    consultation_memo_updated_at: '',
    consultation_topics: [],
    document_role: 'consultation_brief',
    document_status: 'draft',
    own_listing: {},
    research_lineage: { competitor_asins: [atlasFactPack && atlasFactPack.asin, atlasFactPack && atlasFactPack.parent_asin].filter(Boolean), source_card_id: cardData.id },
    initial_order_qty: '50',
    created_at: now,
    updated_at: now
  };
}

function hydrateAtlasCardForPageProject_(cardData) {
  if (!cardData || !cardData.id) return cardData || {};
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
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
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(cardData.id)) {
      const full = rowToObject_(headers, data[i], jsonCols, objectCols, BOOLEAN_COLS_LIFECYCLE);
      return Object.assign({}, full, cardData);
    }
  }
  return cardData;
}

function getAtlasFactPackFromCard_(cardData) {
  if (!cardData) return null;
  if (cardData.keepa_data && cardData.keepa_data.schema_version === 'atlas_keepa_fact_pack_v1') {
    return cardData.keepa_data;
  }
  if (cardData.page_draft && cardData.page_draft.atlas_fact_pack) {
    return cardData.page_draft.atlas_fact_pack;
  }
  return null;
}

function formatAtlasFactPackForPage_(factPack) {
  if (!factPack) return '';
  const pf = factPack.product_facts || {};
  const pg = factPack.page_facts || {};
  const mf = factPack.market_facts || {};
  const af = factPack.atlas_facts || {};
  const lines = [];
  lines.push('[Seller ATLAS / Keepa fact pack]');
  lines.push('ASIN: ' + (factPack.asin || ''));
  if (pf.title) lines.push('Title: ' + pf.title);
  if (pf.brand) lines.push('Brand: ' + pf.brand);
  if (pf.category_tree) lines.push('Category: ' + (Array.isArray(pf.category_tree) ? pf.category_tree.map(function(c){ return c.name || c; }).join(' > ') : pf.category_tree));
  if (pf.price !== '') lines.push('Price: ' + pf.price);
  if (pf.monthly_sold !== '') lines.push('Monthly sold: ' + pf.monthly_sold);
  if (pf.rating !== '') lines.push('Rating: ' + pf.rating);
  if (pf.review_count !== '') lines.push('Review count: ' + pf.review_count);
  if (pf.sales_rank_drops_30 !== '') lines.push('Sales rank drops 30d: ' + pf.sales_rank_drops_30);
  lines.push('');
  lines.push('Existing bullets from Keepa/Amazon:');
  (Array.isArray(pg.features) && pg.features.length ? pg.features : ['(none)']).forEach(function(f, i) {
    lines.push((i + 1) + '. ' + f);
  });
  if (pg.description) {
    lines.push('');
    lines.push('Description:');
    lines.push(pg.description);
  }
  if (Array.isArray(pg.aplus_modules) && pg.aplus_modules.length) {
    lines.push('');
    lines.push('A+ modules:');
    pg.aplus_modules.forEach(function(m, i) {
      lines.push('- Module ' + (i + 1));
      if (m.headline) lines.push('  headline: ' + m.headline);
      if (Array.isArray(m.text) && m.text.length) lines.push('  text: ' + m.text.join(' / '));
    });
  }
  if (Array.isArray(pg.image_urls) && pg.image_urls.length) {
    lines.push('');
    lines.push('Image URLs:');
    pg.image_urls.slice(0, 12).forEach(function(u) { lines.push('- ' + u); });
  }
  lines.push('');
  lines.push('Page facts: image_count=' + (pg.image_count || '') + ', has_aplus=' + pg.has_aplus + ', has_video=' + pg.has_video);
  lines.push('Market facts: buy_box_is_amazon=' + mf.buy_box_is_amazon + ', total_offer_count=' + (mf.total_offer_count || ''));
  lines.push('ATLAS facts: decision=' + (af.decision || '') + ', total_score=' + (af.total_score || '') + ', reason=' + (af.reason || ''));
  lines.push('');
  lines.push('Policy: Existing marketplace text is reference material only. Do not copy verbatim into a new listing.');
  return lines.join('\n');
}

function debugAtlasPromptInputForAsin(asinOrCardId) {
  const target = String(asinOrCardId || '').trim();
  if (!target) throw new Error('asinOrCardId is required.');

  const card = findLifecycleCardForDebug_(target);
  if (!card) throw new Error('product_lifecycle card not found: ' + target);

  const project = findLatestPageProjectForDebug_(card.id);
  const factPack = getAtlasFactPackFromCard_(card);
  const factTextFromCard = formatAtlasFactPackForPage_(factPack);
  const extraText = project && project.extra_texts ? String(project.extra_texts.competitor_reviews || '') : '';
  const promptLine = project ? ('- 競合レビュー抜粋: ' + (extraText || 'なし')) : '';
  const firstFeature = factPack && factPack.page_facts && Array.isArray(factPack.page_facts.features)
    ? String(factPack.page_facts.features[0] || '')
    : '';

  const result = {
    input: target,
    card: {
      found: true,
      id: card.id,
      asin: card.asin || '',
      title: card.title || '',
      source: card.source || '',
      keepaDataPresent: !!factPack,
      keepaSchema: factPack ? factPack.schema_version || '' : '',
      featureCount: factPack && factPack.page_facts && Array.isArray(factPack.page_facts.features)
        ? factPack.page_facts.features.length
        : 0,
      descriptionLength: factPack && factPack.page_facts && factPack.page_facts.description
        ? String(factPack.page_facts.description).length
        : 0
    },
    pageProject: project ? {
      found: true,
      id: project.id,
      source_card_id: project.source_card_id,
      extraCompetitorReviewsLength: extraText.length,
      extraTextContainsAsin: extraText.indexOf(card.asin || target) >= 0,
      extraTextContainsFirstFeature: firstFeature ? extraText.indexOf(firstFeature.slice(0, 30)) >= 0 : false,
      pageDraftHasAtlasFactPack: !!(project.page_draft && project.page_draft.atlas_fact_pack),
      generatedDraftPresent: !!(project.page_draft && project.page_draft.concept)
    } : {
      found: false
    },
    generatePageDraftPromptInput: {
      fieldUsedByPrompt: 'projectData.extra_texts.competitor_reviews',
      willBeIncluded: !!extraText,
      promptLinePreview: promptLine.slice(0, 2000)
    },
    factTextPreviewFromCard: factTextFromCard.slice(0, 2000)
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function findLifecycleCardForDebug_(asinOrCardId) {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const idIdx = headers.indexOf('id');
  const asinIdx = headers.indexOf('asin');
  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual', 'keepa_data'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result'
  ];
  const matches = [];
  for (let i = 1; i < data.length; i++) {
    const id = idIdx >= 0 ? String(data[i][idIdx] || '').trim() : '';
    const asin = asinIdx >= 0 ? String(data[i][asinIdx] || '').trim() : '';
    if (id === asinOrCardId || asin === asinOrCardId) {
      matches.push(rowToObject_(headers, data[i], jsonCols, objectCols, BOOLEAN_COLS_LIFECYCLE));
    }
  }
  matches.sort(function(a, b) {
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
  return matches[0] || null;
}

function debugListAtlasCardsForAsin(asin) {
  asin = String(asin || '').trim();
  if (!asin) throw new Error('asin is required.');

  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const asinIdx = headers.indexOf('asin');
  const sourceIdx = headers.indexOf('source');
  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual', 'keepa_data'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result'
  ];

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (asinIdx < 0 || String(data[i][asinIdx] || '').trim() !== asin) continue;
    if (sourceIdx >= 0 && String(data[i][sourceIdx] || '').trim() !== 'Seller ATLAS') continue;
    const card = rowToObject_(headers, data[i], jsonCols, objectCols, BOOLEAN_COLS_LIFECYCLE);
    const factPack = getAtlasFactPackFromCard_(card);
    rows.push({
      id: card.id,
      asin: card.asin,
      title: card.title,
      created_at: card.created_at,
      updated_at: card.updated_at,
      keepaDataPresent: !!factPack,
      keepaSchema: factPack ? factPack.schema_version || '' : '',
      featureCount: factPack && factPack.page_facts && Array.isArray(factPack.page_facts.features)
        ? factPack.page_facts.features.length
        : 0,
      hasPageProject: !!findLatestPageProjectForDebug_(card.id)
    });
  }
  rows.sort(function(a, b) {
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
  Logger.log(JSON.stringify(rows, null, 2));
  return rows;
}

function findLatestPageProjectForDebug_(sourceCardId) {
  const sheet = getSheetByName_(SHEET_PAGE_PROJECTS, REQUIRED_HEADERS_PAGE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_PAGE);
  const sourceIdx = headers.indexOf('source_card_id');
  const updatedIdx = headers.indexOf('updated_at');
  const matches = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][sourceIdx] || '') === String(sourceCardId)) {
      matches.push(rowToObject_(headers, data[i], JSON_COLS_PAGE, OBJECT_JSON_COLS_PAGE, BOOLEAN_COLS_PAGE));
    }
  }
  matches.sort(function(a, b) {
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
  return matches[0] || null;
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

    if (asin) {
      cardData.asin = normalizeAsin_(asin);
      applyAmazonUrlFromAsin_(cardData);
    }

    cardData.status = cardData.audit && cardData.audit.status
      ? cardData.audit.status
      : 'wait';
  cardData.source = 'Amazon';
  cardData.origin_type = 'research';
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
  const extractedInput = p.extracted_input || {};
  const skillPrompt = getActivePageSkillPrompt_();
  const handoff = p.listing_handoff || {};
  const isAtlasProject = Array.isArray(p.tags) && p.tags.indexOf('ATLAS') >= 0;
  const sourcingActivity = !!String(p.adopted_candidate_id || '').trim()
    || Object.keys(p.sourcing_brief || {}).length > 0
    || ['supplier_adopted', 'supplier_needs_confirmation'].indexOf(String(p.sourcing_state || '')) >= 0;
  if ((isAtlasProject || sourcingActivity) && !handoff.ready) {
    throw new Error('まだ生成できません。理由: 確認済み仕様（listing_handoff）が未確定です。「この解析結果を仕入候補として採用」またはラクマート候補の採用を先に行ってください。');
  }

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
- 仕入元URL: ${extraTexts.supplier_url || 'なし'}
- 仕入元情報: ${extraTexts.supplier_info || 'なし'}
- 狙いたい訴求/ターゲットメモ: ${extraTexts.target_notes || 'なし'}
- 自由メモ: ${extraTexts.free_memo || p.memo || 'なし'}

【スクリーンショットから抽出した構造化事実】
${JSON.stringify(extractedInput || {})}

【採用済み仕入候補からのページ制作引き継ぎ】
${JSON.stringify(handoff || {})}

商品仕様として使用できるのは listing_handoff.confirmed_facts と claim_guard.allowed_claims のみです。
market_insightsは訴求の優先順位にだけ使い、商品仕様として断定しないでください。
unconfirmed_itemsとclaim_guard.prohibited_claimsはタイトル・箇条書き・説明・画像文言に使用禁止です。

【交換可能なamazon-listing-pageスキル】
${skillPrompt || 'スキル未登録。固定ルールのみでドラフトを生成すること。'}

スキル内の手順・Amazon規約・画像プロンプト方針を適用してください。ただし、このプロンプト冒頭の事実保護ルールと下記JSON契約を優先してください。

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
  ,"competitor_analysis":{"common_claims":[],"complaints":[],"price_position":"","keyword_trends":[]}
  ,"keyword_plan":{"main_keyword":"","sub_keywords":[],"long_tail":[]}
  ,"recommended_title_index":1
  ,"submission_checklist":{"title_length":0,"backend_keyword_bytes":0,"prohibited_expression_check":[],"main_image_check":[]}
  ,"generated_by":"${GEMINI_MODEL}"
  ,"review_status":"draft"
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
  result.competitor_analysis = result.competitor_analysis && typeof result.competitor_analysis === 'object' ? result.competitor_analysis : {};
  result.keyword_plan = result.keyword_plan && typeof result.keyword_plan === 'object' ? result.keyword_plan : {};
  const aiChecklist = result.submission_checklist && typeof result.submission_checklist === 'object' ? result.submission_checklist : {};
  result.submission_checklist = Object.assign({}, aiChecklist, {
    title_lengths: result.title_candidates.map(function(title) { return Array.from(String(title || '')).length; }),
    title_count: result.title_candidates.length,
    bullet_count: result.bullets.length,
    image_plan_count: result.image_plan.length,
    backend_keyword_bytes: Utilities.newBlob(String(result.backend_keywords || ''), 'text/plain').getBytes().length,
    calculated_by: 'central-deterministic-checks'
  });
  result.generated_by = GEMINI_MODEL;
  result.review_status = 'draft';
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
      gtin: '',
      amazon_url: getAmazonProductUrlFromAsin_(p.asin),
      amazon_published_date: '',
      supplier_1688_url: '', rakumart_linkage_status: '', barcode_option: '',
      current_landed_cost: '', actual_result: {}, source: 'inventory_import', origin_type: 'import',
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
const SHEET_MANUAL_COST_FALLBACK = 'cost_fallback_overrides';

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

const REQUIRED_HEADERS_MANUAL_COST_FALLBACK = [
  'id', 'sku', 'asin', 'unit_cost', 'effective_from', 'status', 'note',
  'created_at', 'updated_at'
];

function getManualCostFallbacks_() {
  const sheet = getSheetByName_(SHEET_MANUAL_COST_FALLBACK, REQUIRED_HEADERS_MANUAL_COST_FALLBACK);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  return data.slice(1).map(row => ({
    id: String(row[idx('id')] || '').trim(),
    sku: String(row[idx('sku')] || '').trim(),
    asin: String(row[idx('asin')] || '').trim(),
    unit_cost: toNumberOrNull_(row[idx('unit_cost')]),
    effective_from: row[idx('effective_from')],
    status: String(row[idx('status')] || '').trim() || 'active',
    note: String(row[idx('note')] || '').trim(),
    created_at: String(row[idx('created_at')] || '').trim(),
    updated_at: String(row[idx('updated_at')] || '').trim()
  })).filter(row => row.sku && row.unit_cost !== null && row.unit_cost > 0 && row.status === 'active');
}

function readManualCostFallbackMap_() {
  const map = {};
  getManualCostFallbacks_().forEach(row => {
    const effectiveDate = parseDate_(row.effective_from);
    const normalized = Object.assign({}, row, {
      effective_from: effectiveDate ? Utilities.formatDate(effectiveDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      effective_time: effectiveDate ? effectiveDate.getTime() : Number.NEGATIVE_INFINITY
    });
    const current = map[row.sku];
    if (!current || normalized.effective_time >= current.effective_time) map[row.sku] = normalized;
  });
  return map;
}

function upsertManualCostFallback_(item) {
  const sku = String(item.sku || '').trim();
  const asin = String(item.asin || '').trim().toUpperCase();
  const unitCost = toNumberOrNull_(item.unit_cost);
  const effectiveFrom = String(item.effective_from || '').trim();
  const note = String(item.note || '').trim().slice(0, 500);
  if (!sku) throw new Error('SKUが必要です。');
  if (!asin) throw new Error('ASINが必要です。');
  if (unitCost === null || unitCost <= 0) throw new Error('仮の着地原価は0より大きい数値を入力してください。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !parseDate_(effectiveFrom)) {
    throw new Error('適用開始日をYYYY-MM-DD形式で入力してください。');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheetByName_(SHEET_MANUAL_COST_FALLBACK, REQUIRED_HEADERS_MANUAL_COST_FALLBACK);
    const headers = getHeaders_(sheet, REQUIRED_HEADERS_MANUAL_COST_FALLBACK);
    const missing = REQUIRED_HEADERS_MANUAL_COST_FALLBACK.filter(h => headers.indexOf(h) < 0);
    if (missing.length) throw new Error('cost_fallback_overrides の列が不足しています: ' + missing.join(', '));
    const data = sheet.getDataRange().getValues();
    const idx = name => headers.indexOf(name);
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idx('sku')] || '').trim() === sku && String(data[i][idx('status')] || 'active') === 'active') {
        targetRow = i + 1;
        break;
      }
    }
    const now = new Date().toISOString();
    const existingId = targetRow > 0 ? String(sheet.getRange(targetRow, idx('id') + 1).getValue() || '') : '';
    const existingCreated = targetRow > 0 ? String(sheet.getRange(targetRow, idx('created_at') + 1).getValue() || '') : '';
    const value = {
      id: existingId || Utilities.getUuid(), sku: sku, asin: asin,
      unit_cost: unitCost, effective_from: effectiveFrom, status: 'active', note: note,
      created_at: existingCreated || now, updated_at: now
    };
    const rowValues = headers.map(h => value[h] !== undefined ? value[h] : '');
    if (targetRow > 0) sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
    else sheet.appendRow(rowValues);
    sheet.getRange(targetRow > 0 ? targetRow : sheet.getLastRow(), idx('effective_from') + 1).setNumberFormat('@STRING@');
    return value;
  } finally {
    lock.releaseLock();
  }
}

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

function syncTransactions(transactions, periodCosts, periodKey, newSkuMappings) {
  if (!periodKey) throw new Error('periodKey が必要です。');

  // ── 新商品検知(売上取込側)で確定したsku→asinマッピングをsku_masterへ先に反映 ──
  // これをbuildSkuToAsinMap_より前に行うことで、今回の取込分から即座に解決できるようにする。
  if (newSkuMappings && newSkuMappings.length) {
    applyNewSkuMappings_(newSkuMappings);
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

  // ── 既存の取込済み明細数をキー別に取得 ──
  const existingKeyCounts = getExistingTransactionKeyCounts_(periodKey);
  const incomingKeyCounts = {};

  // ── トランザクション集計 ──
  const asinSummary  = {};
  const newHistoryRows = [];
  let importedCount  = 0;
  let duplicateCount = 0;
  let noSkuCount     = 0;

  transactions.forEach(tx => {
    if (!tx.sku) { noSkuCount++; return; }
    const dupKey = makeTransactionDedupeKey_(tx);
    const seenInIncoming = incomingKeyCounts[dupKey] || 0;
    incomingKeyCounts[dupKey] = seenInIncoming + 1;
    if (seenInIncoming < (existingKeyCounts[dupKey] || 0)) {
      duplicateCount++;
      return;
    }

    const asin = skuToAsin[tx.sku] || '';
    const id   = Utilities.getUuid();
    const now  = new Date().toISOString();

    newHistoryRows.push([
      id, tx.orderId, tx.sku, asin, tx.date,
      tx.type, tx.qty,
      tx.salesTaxin, tx.fee, tx.fbaFee,
      tx.discount, tx.points, tx.net,
      String(periodKey), now
    ]);

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

  const refreshed = refreshSalesActualForPeriod_(periodKey);

  Logger.log(`syncTransactions: imported=${importedCount}, duplicate=${duplicateCount}, noSku=${noSkuCount}`);
  return {
    imported: importedCount,
    skipped_duplicate: duplicateCount,
    skipped_no_sku: noSkuCount,
    sales_actual_refreshed: refreshed.updated
  };
}


// ── 新商品検知(売上取込側)で入力されたsku→asinマッピングをsku_masterへ反映 ──
// 既存SKUならasin(未設定時)・商品名(未設定時)を補完し、新規SKUなら行を追加する。
function applyNewSkuMappings_(mappings) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SKU_MASTER);
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS_SKU_MASTER.length).setValues([REQUIRED_HEADERS_SKU_MASTER]);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const skuIdx  = headers.indexOf('sku');
  const asinIdx = headers.indexOf('asin');
  const nameIdx = headers.indexOf('product_name');
  const dateIdx = headers.indexOf('updated_at');

  const existingSkuRow = {};
  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][skuIdx] || '').trim();
    if (sku) existingSkuRow[sku] = i + 1;
  }

  const now = new Date().toISOString();
  const newRows = [];

  mappings.forEach(m => {
    const sku  = String((m && m.sku)  || '').trim();
    const asin = String((m && m.asin) || '').trim().toUpperCase();
    if (!sku || !asin) return;
    const title = String((m && m.title) || '').trim();
    if (existingSkuRow[sku]) {
      const rowNum = existingSkuRow[sku];
      if (!data[rowNum - 1][asinIdx]) sheet.getRange(rowNum, asinIdx + 1).setValue(asin);
      if (title && !data[rowNum - 1][nameIdx]) sheet.getRange(rowNum, nameIdx + 1).setValue(title);
      sheet.getRange(rowNum, dateIdx + 1).setValue(now);
    } else {
      newRows.push([sku, asin, '', title, now]);
      existingSkuRow[sku] = -1;
    }
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  }

  Logger.log(`applyNewSkuMappings_: ${newRows.length}件追加`);
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

function toNumberOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number' && isFinite(value)) {
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/\s*(JST|UTC|GMT)\s*$/i, '')
    .replace(/[年月]/g, '/')
    .replace(/日/g, '')
    .trim();

  const ymd = normalized.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ymd) {
    return new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      Number(ymd[4] || 0),
      Number(ymd[5] || 0),
      Number(ymd[6] || 0)
    );
  }

  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function txEventTime_(tx) {
  const d = parseDate_(tx.date);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

function makeTransactionDedupeKey_(tx) {
  return [
    String(tx.orderId || tx.order_id || '').trim(),
    String(tx.date || '').trim(),
    String(tx.sku || '').trim(),
    String(tx.type || tx.transaction_type || '').trim(),
    String(Number(tx.qty) || 0),
    String(Number(tx.net) || 0),
    String(Number(tx.salesTaxin || tx.sales_taxin) || 0),
    String(Number(tx.fee) || 0),
    String(Number(tx.fbaFee || tx.fba_fee) || 0),
    String(Number(tx.discount) || 0),
    String(Number(tx.points) || 0)
  ].join('__');
}

function readLifecycleMeta_() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  const idx = name => headers.indexOf(name);
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const asin = String(data[i][idx('asin')] || '').trim();
    if (!asin) continue;
    result[asin] = {
      rowNum: i + 1,
      productId: String(data[i][idx('id')] || '').trim(),
      title: String(data[i][idx('title')] || '').trim() || asin,
      emoji: String(data[i][idx('emoji')] || '').trim() || '📦',
      subtitle: idx('subtitle') >= 0 ? String(data[i][idx('subtitle')] || '').trim() : '',
      currentLandedCost: toNumberOrNull_(data[i][idx('current_landed_cost')]),
      salesActualRaw: idx('sales_actual') >= 0 ? data[i][idx('sales_actual')] : ''
    };
  }
  return result;
}

function readReorderRows_() {
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  return data.slice(1).map(row => {
    const cost = toNumberOrNull_(row[idx('landed_cost_actual')]);
    const qty = toNumberOrNull_(row[idx('quantity')]);
    return {
      product_id: String(row[idx('product_id')] || '').trim(),
      sku: String(row[idx('sku')] || '').trim(),
      date: row[idx('order_date')],
      time: txEventTime_({ date: row[idx('order_date')] }),
      qty: qty,
      unit_cost: cost
    };
  }).filter(r => r.qty !== null && r.qty > 0 && r.unit_cost !== null && r.unit_cost > 0);
}

function readTransactionRows_() {
  const sheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  return data.slice(1).map((row, offset) => {
    const periodVal = row[idx('period_key')];
    let periodStr = '';
    if (periodVal instanceof Date) {
      const y = periodVal.getFullYear();
      const m = String(periodVal.getMonth() + 1).padStart(2, '0');
      periodStr = `${y}-${m}`;
    } else {
      periodStr = String(periodVal || '').trim();
      if (periodStr.length > 7 && isNaN(Number(periodStr))) {
        const d = new Date(periodStr);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          periodStr = `${y}-${m}`;
        }
      }
    }

    return {
      rowNum: offset + 2,
      id: String(row[idx('id')] || '').trim(),
      orderId: String(row[idx('order_id')] || '').trim(),
      sku: String(row[idx('sku')] || '').trim(),
      asin: String(row[idx('asin')] || '').trim(),
      date: row[idx('date')],
      type: String(row[idx('transaction_type')] || '').trim(),
      qty: Number(row[idx('qty')]) || 0,
      salesTaxin: Number(row[idx('sales_taxin')]) || 0,
      fee: Number(row[idx('fee')]) || 0,
      fbaFee: Number(row[idx('fba_fee')]) || 0,
      discount: Number(row[idx('discount')]) || 0,
      points: Number(row[idx('points')]) || 0,
      net: Number(row[idx('net')]) || 0,
      period: periodStr
    };
  }).filter(tx => tx.sku && tx.period && (tx.type === '注文' || tx.type === '返金'));
}

function mergeCostSource_(current, next) {
  const rank = { moving_average: 0, last_receipt_fallback: 1, current_landed_cost: 2, manual_provisional: 3, missing: 4 };
  if (!current) return next;
  return (rank[next] || 0) > (rank[current] || 0) ? next : current;
}

function buildCogsLedgerBySku_(sku, reorderRows, txRows, options) {
  options = options || {};
  const productId = String(options.productId || '').trim();
  const fallbackCost = toNumberOrNull_(options.fallbackCost);
  const manualFallback = options.manualFallback || null;
  const periodCogs = {};
  const periodUnits = {};
  const costEstimated = {};
  const periodCostSources = {};
  const periodManualFallbacks = {};
  const perTxCost = {};

  const events = [];
  reorderRows.forEach(r => {
    const sameSku = r.sku && r.sku === sku;
    const pidFallback = !r.sku && productId && r.product_id === productId;
    if (!sameSku && !pidFallback) return;
    events.push({ kind: 'RECV', time: r.time, qty: r.qty, unit_cost: r.unit_cost });
  });
  txRows.forEach(tx => {
    if (tx.sku !== sku) return;
    events.push({
      kind: tx.type === '返金' ? 'RET' : 'SALE',
      time: txEventTime_(tx),
      qty: Math.abs(Number(tx.qty) || 0),
      period: tx.period,
      tx
    });
  });

  const order = { RECV: 0, RET: 1, SALE: 2 };
  events.sort((a, b) => (a.time - b.time) || (order[a.kind] - order[b.kind]));

  let qtyOnHand = 0;
  let invValue = 0;
  // 数量を使い切った後も、最後に実在した仕入原価を正式な代替原価として使う。
  // 2026-01-01の期首在庫もRECVイベントなので、この値へ自然に登録される。
  // 後日、正しい入荷日で仕入履歴が追加されれば、その原価が以後の代替原価になる。
  let lastReceiptCost = null;
  events.forEach(ev => {
    if (ev.kind === 'RECV') {
      lastReceiptCost = ev.unit_cost;
      qtyOnHand += ev.qty;
      invValue += ev.qty * ev.unit_cost;
      return;
    }

    const avg = qtyOnHand > 0 ? invValue / qtyOnHand : null;
    let unitCost = avg;
    let estimated = false;
    let costSource = unitCost !== null && isFinite(unitCost) ? 'moving_average' : 'missing';
    if (unitCost === null || !isFinite(unitCost)) {
      if (lastReceiptCost !== null && lastReceiptCost > 0) {
        unitCost = lastReceiptCost;
        estimated = true;
        costSource = 'last_receipt_fallback';
      } else if (fallbackCost !== null && fallbackCost > 0) {
        unitCost = fallbackCost;
        estimated = true;
        costSource = 'current_landed_cost';
      } else if (manualFallback && manualFallback.unit_cost > 0 && ev.time >= manualFallback.effective_time) {
        unitCost = manualFallback.unit_cost;
        estimated = true;
        costSource = 'manual_provisional';
      } else {
        unitCost = null;
        costSource = 'missing';
      }
    }

    const period = ev.period;
    if (!periodCogs[period]) periodCogs[period] = 0;
    if (!periodUnits[period]) periodUnits[period] = 0;
    periodCostSources[period] = mergeCostSource_(periodCostSources[period], costSource);
    if (costSource === 'manual_provisional') {
      if (!periodManualFallbacks[period]) periodManualFallbacks[period] = {};
      periodManualFallbacks[period][sku] = {
        sku: sku,
        asin: manualFallback.asin || '',
        unit_cost: manualFallback.unit_cost,
        effective_from: manualFallback.effective_from || '',
        note: manualFallback.note || ''
      };
    }

    if (unitCost !== null) {
      const amount = ev.qty * unitCost;
      if (ev.kind === 'SALE') {
        periodCogs[period] += amount;
        periodUnits[period] += ev.qty;
        invValue -= amount;
        qtyOnHand -= ev.qty;
      } else {
        periodCogs[period] -= amount;
        periodUnits[period] -= ev.qty;
        invValue += amount;
        qtyOnHand += ev.qty;
      }
      perTxCost[ev.tx.id] = { unitCost, amount, estimated, costSource };
      if (estimated) costEstimated[period] = true;
    } else {
      perTxCost[ev.tx.id] = { unitCost: null, amount: null, estimated: false, costSource: 'missing' };
      costEstimated[period] = true;
      if (ev.kind === 'SALE') qtyOnHand -= ev.qty;
      else qtyOnHand += ev.qty;
    }
  });

  return { perTxCost, periodCogs, periodUnits, costEstimated, periodCostSources, periodManualFallbacks };
}

function calculateMovingAverageActuals_() {
  const skuToAsin = buildSkuToAsinMap_();
  const asinMeta = readLifecycleMeta_();
  const reorderRows = readReorderRows_();
  const manualFallbacks = readManualCostFallbackMap_();
  const txRows = readTransactionRows_().map(tx => {
    if (!tx.asin && skuToAsin[tx.sku]) tx.asin = skuToAsin[tx.sku];
    return tx;
  });

  const byPeriodAsin = {};
  const ensure = (period, asin) => {
    const key = period + '__' + asin;
    if (!byPeriodAsin[key]) {
      const meta = asinMeta[asin] || {};
      byPeriodAsin[key] = {
        period,
        asin,
        title: meta.title || asin,
        subtitle: meta.subtitle || '',
        emoji: meta.emoji || '📦',
        qty: 0,
        salesTaxin: 0,
        fee: 0,
        fbaFee: 0,
        discount: 0,
        points: 0,
        net: 0,
        returnQty: 0,
        returnAmount: 0,
        cogs: 0,
        costUnits: 0,
        costEstimated: false,
        costSource: '',
        manualFallbacks: {},
        hasCost: false
      };
    }
    return byPeriodAsin[key];
  };

  txRows.forEach(tx => {
    const asin = tx.asin || skuToAsin[tx.sku] || '';
    if (!asin) return;
    const s = ensure(tx.period, asin);
    if (tx.type === '注文') {
      s.qty += tx.qty;
      s.salesTaxin += tx.salesTaxin;
      s.fee += tx.fee;
      s.fbaFee += tx.fbaFee;
      s.discount += tx.discount;
      s.points += tx.points;
      s.net += tx.net;
    } else if (tx.type === '返金') {
      s.returnQty += Math.abs(tx.qty);
      s.returnAmount += tx.net;
      s.salesTaxin += tx.salesTaxin;
      s.fee += tx.fee;
      s.fbaFee += tx.fbaFee;
      s.discount += tx.discount;
      s.points += tx.points;
      s.net += tx.net;
    }
  });

  const skuSet = {};
  txRows.forEach(tx => { if (tx.sku) skuSet[tx.sku] = true; });
  reorderRows.forEach(r => { if (r.sku) skuSet[r.sku] = true; });

  Object.keys(skuSet).forEach(sku => {
    const asin = skuToAsin[sku] || txRows.find(tx => tx.sku === sku && tx.asin)?.asin || '';
    const meta = asin ? asinMeta[asin] : null;
    const ledger = buildCogsLedgerBySku_(sku, reorderRows, txRows, {
      productId: meta ? meta.productId : '',
      fallbackCost: meta ? meta.currentLandedCost : null,
      manualFallback: manualFallbacks[sku] || null
    });
    Object.keys(ledger.periodCogs).forEach(period => {
      if (!asin) return;
      const s = ensure(period, asin);
      const units = ledger.periodUnits[period] || 0;
      const periodSource = ledger.periodCostSources[period] || 'missing';
      // 全数返品では原価対象数が0に戻るが、売上と返品の原価差額は残り得る。
      // 数量が相殺された期間もCOGSを集計し、全イベントに原価があれば原価確認済みとする。
      s.cogs += ledger.periodCogs[period] || 0;
      if (units !== 0) {
        s.costUnits += units;
        s.hasCost = true;
      } else if (periodSource !== 'missing') {
        s.hasCost = true;
      }
      if (ledger.costEstimated[period]) s.costEstimated = true;
      s.costSource = mergeCostSource_(s.costSource, periodSource);
      const usedManual = ledger.periodManualFallbacks[period] || {};
      Object.keys(usedManual).forEach(key => { s.manualFallbacks[key] = usedManual[key]; });
    });
  });

  return { byPeriodAsin, txRows, reorderRows, asinMeta };
}

function buildSalesActualEntry_(s, importedAt) {
  const costUnits = s.costUnits || 0;
  const netUnits = (Number(s.qty) || 0) - (Number(s.returnQty) || 0);
  const fullyReturned = Math.abs(netUnits) < 0.000001;
  const landedCost = s.hasCost && costUnits !== 0 ? s.cogs / costUnits : null;
  // 注文数と返品数が同数なら在庫原価は相殺されるため、原価入力なしでも粗利を確定できる。
  // 手数料・返金調整などAmazon側に残った差額が、その期間の粗利になる。
  const grossProfit = landedCost !== null || fullyReturned ? s.net - s.cogs : null;
  return {
    period: s.period,
    qty: Math.round(s.qty),
    sales_taxin: Math.round(s.salesTaxin),
    fee: Math.round(s.fee),
    fba_fee: Math.round(s.fbaFee),
    discount: Math.round(s.discount),
    points: Math.round(s.points),
    net: Math.round(s.net),
    landed_cost_used: landedCost !== null ? Math.round(landedCost) : null,
    cost_covered_qty: costUnits,
    gross_profit: grossProfit !== null ? Math.round(grossProfit) : null,
    gross_profit_per_unit: grossProfit !== null && costUnits > 0 ? Math.round(grossProfit / costUnits) : null,
    cost_estimated: !!s.costEstimated,
    cost_source: s.costSource || (landedCost === null ? 'missing' : 'moving_average'),
    manual_fallbacks: Object.values(s.manualFallbacks || {}),
    return_qty: Math.round(s.returnQty),
    return_amount: Math.round(s.returnAmount),
    imported_at: importedAt || new Date().toISOString()
  };
}

function getPeriodSummaryMovingAverage_(periodKey) {
  const calc = calculateMovingAverageActuals_();
  const products = Object.keys(calc.byPeriodAsin)
    .map(key => calc.byPeriodAsin[key])
    .filter(s => s.period === periodKey)
    .map(s => {
      const entry = buildSalesActualEntry_(s);
      return {
        asin: s.asin,
        title: s.title,
        subtitle: s.subtitle || '',
        emoji: s.emoji,
        current_landed_cost: entry.landed_cost_used,
        qty: entry.qty,
        sales_taxin: entry.sales_taxin,
        fee: entry.fee,
        fba_fee: entry.fba_fee,
        net: entry.net,
        gross_profit: entry.gross_profit,
        gross_profit_per_unit: entry.gross_profit_per_unit,
        cost_estimated: entry.cost_estimated,
        cost_source: entry.cost_source,
        manual_fallbacks: entry.manual_fallbacks,
        return_qty: entry.return_qty,
        return_amount: entry.return_amount
      };
    })
    .sort((a, b) => b.sales_taxin - a.sales_taxin);

  attachAdBusinessToProducts_(products, periodKey);

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
    const ct   = String(costsData[i][cType] || '');
    const desc = String(costsData[i][cDesc] || '');
    const amt  = Number(costsData[i][cAmount]) || 0;
    if (!costMap[ct]) costMap[ct] = { costType: ct, description: desc, amount: 0, count: 0 };
    costMap[ct].amount += amt;
    costMap[ct].count++;
  }
  const periodCosts = Object.values(costMap);

  const totalSalesTaxin = products.reduce((sum, p) => sum + (p.sales_taxin || 0), 0);
  const totalNet = products.reduce((sum, p) => sum + (p.net || 0), 0);
  const totalQty = products.reduce((sum, p) => sum + (p.qty || 0), 0);
  const totalReturnAmount = products.reduce((sum, p) => sum + (p.return_amount || 0), 0);
  const totalReturnQty = products.reduce((sum, p) => sum + (p.return_qty || 0), 0);
  const costSetCount = products.filter(p => p.gross_profit !== null && p.gross_profit !== undefined).length;
  const uncostProducts = products.filter(p => p.gross_profit === null || p.gross_profit === undefined);
  const uncostNet = uncostProducts.reduce((sum, p) => sum + (p.net || 0), 0);
  const provisionalProducts = products.filter(p => p.cost_source === 'manual_provisional');
  const provisionalNet = provisionalProducts.reduce((sum, p) => sum + (p.net || 0), 0);
  const costSourceCounts = products.reduce((counts, p) => {
    const source = p.gross_profit === null || p.gross_profit === undefined ? 'missing' : (p.cost_source || 'moving_average');
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
  const totalGrossProfit = products
    .filter(p => p.gross_profit !== null && p.gross_profit !== undefined)
    .reduce((sum, p) => sum + p.gross_profit, 0);
  const totalFixedCosts = periodCosts.reduce((sum, c) => sum + c.amount, 0);
  const operatingProfit = totalGrossProfit + totalFixedCosts;

  return {
    periodKey,
    summary: {
      totalSalesTaxin: Math.round(totalSalesTaxin),
      totalNet: Math.round(totalNet),
      totalGrossProfit,
      totalFixedCosts: Math.round(totalFixedCosts),
      operatingProfit,
      totalReturnAmount: Math.round(totalReturnAmount),
      totalReturnQty,
      totalQty,
      returnRate: totalQty > 0 ? Math.round(totalReturnQty / totalQty * 1000) / 10 : 0,
      costSetCount,
      uncostCount: uncostProducts.length,
      uncostNet: Math.round(uncostNet),
      provisionalCount: provisionalProducts.length,
      provisionalNet: Math.round(provisionalNet),
      costSourceCounts: costSourceCounts
    },
    products,
    periodCosts,
    dailySales: getDailySales_(periodKey)
  };
}

function refreshSalesActualForPeriod_(periodKey) {
  const calc = calculateMovingAverageActuals_();
  const lcSheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcHeaders = getHeaders_(lcSheet, REQUIRED_HEADERS_LIFECYCLE);
  const salesActualIdx = getOrAddLifecycleCol_(lcSheet, lcHeaders, 'sales_actual');
  const now = new Date().toISOString();
  let updated = 0;

  Object.keys(calc.byPeriodAsin).forEach(key => {
    const s = calc.byPeriodAsin[key];
    if (s.period !== periodKey) return;
    const meta = calc.asinMeta[s.asin];
    if (!meta || !meta.rowNum) return;

    let existing = [];
    try {
      existing = meta.salesActualRaw ? JSON.parse(meta.salesActualRaw) : [];
      if (!Array.isArray(existing)) existing = [];
    } catch(e) {
      existing = [];
    }

    const newEntry = buildSalesActualEntry_(s, now);
    existing = existing.filter(e => String(e.period) !== periodKey);
    existing.push(newEntry);
    existing.sort((a, b) => String(a.period).localeCompare(String(b.period)));
    lcSheet.getRange(meta.rowNum, salesActualIdx + 1).setValue(JSON.stringify(existing));
    updated++;
  });

  return { updated };
}

function createSheetBackup_(sheetName) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('sheet not found: ' + sheetName);
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const backup = sheet.copyTo(ss);
  backup.setName(sheetName + '_backup_' + ts);
  return backup.getName();
}

function writeMovingAverageRecalcLog_(rows) {
  const ss = getSpreadsheet_();
  const name = 'sales_actual_mavg_recalc_log';
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  const headers = [
    'checked_at', 'asin', 'period',
    'old_landed_cost_used', 'new_landed_cost_used',
    'old_gross_profit', 'new_gross_profit',
    'old_gross_profit_per_unit', 'new_gross_profit_per_unit',
    'old_qty', 'new_qty',
    'cost_estimated'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return name;
}

function recalcSalesActualMovingAverage(dryRun, applyActualFields) {
  dryRun = dryRun !== false;
  applyActualFields = applyActualFields === true;
  const calc = calculateMovingAverageActuals_();
  const lcSheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcHeaders = getHeaders_(lcSheet, REQUIRED_HEADERS_LIFECYCLE);
  const salesActualIdx = getOrAddLifecycleCol_(lcSheet, lcHeaders, 'sales_actual');
  const checkedAt = new Date().toISOString();
  const logRows = [];
  let changed = 0;
  const byAsin = {};
  const backupSheet = dryRun ? '' : createSheetBackup_(SHEET_PRODUCT_LIFECYCLE);

  Object.keys(calc.byPeriodAsin).forEach(key => {
    const s = calc.byPeriodAsin[key];
    if (!byAsin[s.asin]) byAsin[s.asin] = [];
    byAsin[s.asin].push(buildSalesActualEntry_(s, checkedAt));
  });

  Object.keys(byAsin).forEach(asin => {
    const meta = calc.asinMeta[asin];
    if (!meta || !meta.rowNum) return;
    let existing = [];
    try {
      existing = meta.salesActualRaw ? JSON.parse(meta.salesActualRaw) : [];
      if (!Array.isArray(existing)) existing = [];
    } catch(e) {
      existing = [];
    }
    const byPeriod = {};
    existing.forEach(e => { if (e && e.period) byPeriod[String(e.period)] = e; });

    const nextByPeriod = {};
    existing.forEach(e => { if (e && e.period) nextByPeriod[String(e.period)] = Object.assign({}, e); });

    byAsin[asin].forEach(newEntry => {
      const old = byPeriod[String(newEntry.period)] || {};
      const merged = applyActualFields
        ? Object.assign({}, old, newEntry)
        : Object.assign({}, old, {
            period: newEntry.period,
            landed_cost_used: newEntry.landed_cost_used,
            cost_covered_qty: newEntry.cost_covered_qty,
            gross_profit: newEntry.gross_profit,
            gross_profit_per_unit: newEntry.gross_profit_per_unit,
            cost_estimated: newEntry.cost_estimated
          });
      nextByPeriod[String(newEntry.period)] = merged;

      const costChanged =
        String(old.landed_cost_used) !== String(newEntry.landed_cost_used) ||
        String(old.gross_profit) !== String(newEntry.gross_profit) ||
        String(old.gross_profit_per_unit) !== String(newEntry.gross_profit_per_unit) ||
        String(old.cost_estimated || false) !== String(newEntry.cost_estimated || false);
      if (costChanged || Number(old.qty || 0) !== Number(newEntry.qty || 0)) {
        changed++;
        logRows.push([
          checkedAt, asin, newEntry.period,
          old.landed_cost_used ?? '', newEntry.landed_cost_used ?? '',
          old.gross_profit ?? '', newEntry.gross_profit ?? '',
          old.gross_profit_per_unit ?? '', newEntry.gross_profit_per_unit ?? '',
          old.qty ?? '', newEntry.qty ?? '',
          newEntry.cost_estimated ? true : false
        ]);
      }
    });

    if (!dryRun) {
      const next = Object.values(nextByPeriod).sort((a, b) => String(a.period).localeCompare(String(b.period)));
      lcSheet.getRange(meta.rowNum, salesActualIdx + 1).setValue(JSON.stringify(next));
    }
  });

  const logSheet = writeMovingAverageRecalcLog_(logRows);
  return { dryRun, applyActualFields, changed, logRows: logRows.length, logSheet, backupSheet };
}

function checkTransactionRepeatedLines() {
  const txRows = readTransactionRows_();
  const seen = {};
  const repeated = [];
  txRows.forEach(tx => {
    const key = makeTransactionDedupeKey_(tx);
    if (!seen[key]) seen[key] = [];
    seen[key].push({
      id: tx.id,
      rowNum: tx.rowNum,
      orderId: tx.orderId,
      sku: tx.sku,
      qty: tx.qty,
      net: tx.net,
      period: tx.period
    });
  });
  Object.keys(seen).forEach(key => {
    if (seen[key].length > 1) repeated.push({ key, lines: seen[key] });
  });
  return {
    repeatedLineGroups: repeated.length,
    note: 'These are repeated transaction lines, not deletion candidates. Amazon may emit multiple identical-looking lines for multi-unit orders.',
    repeatedLines: repeated.slice(0, 50)
  };
}

function findTransactionRepeatedLineGroups_() {
  const txRows = readTransactionRows_();
  const groups = {};
  txRows.forEach(tx => {
    const key = makeTransactionDedupeKey_(tx);
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  });

  const repeatedGroups = [];
  Object.keys(groups).forEach(key => {
    const rows = groups[key].sort((a, b) => a.rowNum - b.rowNum);
    if (rows.length <= 1) return;
    repeatedGroups.push({
      key,
      rows
    });
  });

  return { repeatedGroups };
}

function writeTransactionRepeatedLineLog_() {
  const ss = getSpreadsheet_();
  const found = findTransactionRepeatedLineGroups_();
  const name = 'transaction_repeated_lines_log';
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();

  const headers = [
    'checked_at', 'note',
    'group_size',
    'row_num', 'id', 'order_id', 'date', 'sku', 'asin', 'type',
    'qty', 'sales_taxin', 'fee', 'fba_fee', 'discount', 'points', 'net',
    'period', 'repeated_line_key'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const checkedAt = new Date().toISOString();
  const note = 'inspection only; not a deletion list';
  const rows = [];
  found.repeatedGroups.forEach(group => {
    group.rows.forEach(tx => {
      rows.push([
        checkedAt,
        note,
        group.rows.length,
        tx.rowNum,
        tx.id,
        tx.orderId,
        String(tx.date || ''),
        tx.sku,
        tx.asin,
        tx.type,
        tx.qty,
        tx.salesTaxin,
        tx.fee,
        tx.fbaFee,
        tx.discount,
        tx.points,
        tx.net,
        tx.period,
        group.key
      ]);
    });
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return {
    repeatedLineGroups: found.repeatedGroups.length,
    logSheet: name,
    sample: found.repeatedGroups.slice(0, 20).map(group => ({
      key: group.key,
      ids: group.rows.map(tx => tx.id),
      rowNums: group.rows.map(tx => tx.rowNum),
      qtyTotal: group.rows.reduce((sum, tx) => sum + (Number(tx.qty) || 0), 0)
    }))
  };
}

function debugMovingAverageForSku(sku) {
  sku = String(sku || '').trim();
  if (!sku) throw new Error('sku required');
  const skuToAsin = buildSkuToAsinMap_();
  const asinMeta = readLifecycleMeta_();
  const reorderRows = readReorderRows_();
  const txRows = readTransactionRows_().map(tx => {
    if (!tx.asin && skuToAsin[tx.sku]) tx.asin = skuToAsin[tx.sku];
    return tx;
  });
  const asin = skuToAsin[sku] || txRows.find(tx => tx.sku === sku && tx.asin)?.asin || '';
  const meta = asin ? asinMeta[asin] : null;
  const ledger = buildCogsLedgerBySku_(sku, reorderRows, txRows, {
    productId: meta ? meta.productId : '',
    fallbackCost: meta ? meta.currentLandedCost : null
  });
  const periods = Object.keys(ledger.periodCogs).sort().map(period => {
    const units = ledger.periodUnits[period] || 0;
    return {
      period,
      units,
      cogs: ledger.periodCogs[period],
      moving_avg_used: units > 0 ? Math.round(ledger.periodCogs[period] / units) : null,
      cost_estimated: !!ledger.costEstimated[period]
    };
  });
  return { sku, asin, periods };
}

function diagnoseMovingAverageCostCoverage(periodKey) {
  periodKey = String(periodKey || '').trim();
  const calc = calculateMovingAverageActuals_();
  const rows = Object.keys(calc.byPeriodAsin)
    .map(key => calc.byPeriodAsin[key])
    .filter(s => !periodKey || s.period === periodKey)
    .map(s => {
      const entry = buildSalesActualEntry_(s);
      const soldUnits = Number(entry.qty) || 0;
      const returnUnits = Number(entry.return_qty) || 0;
      const expectedCostUnits = Math.max(0, soldUnits - returnUnits);
      const coveredUnits = Number(entry.cost_covered_qty) || 0;
      let status = 'costed';
      if (expectedCostUnits > 0 && coveredUnits <= 0) status = 'uncosted';
      else if (expectedCostUnits > 0 && coveredUnits < expectedCostUnits) status = 'partial';
      else if (entry.cost_estimated) status = 'estimated';
      return {
        period: s.period,
        asin: s.asin,
        title: s.title,
        subtitle: s.subtitle || '',
        qty: soldUnits,
        return_qty: returnUnits,
        expected_cost_qty: expectedCostUnits,
        cost_covered_qty: coveredUnits,
        uncovered_qty: Math.max(0, expectedCostUnits - coveredUnits),
        net: entry.net,
        landed_cost_used: entry.landed_cost_used,
        gross_profit: entry.gross_profit,
        gross_profit_per_unit: entry.gross_profit_per_unit,
        cost_estimated: entry.cost_estimated,
        cost_source: entry.cost_source,
        manual_fallbacks: entry.manual_fallbacks,
        status
      };
    })
    .sort((a, b) => {
      const rank = { uncosted: 0, partial: 1, estimated: 2, costed: 3 };
      return (rank[a.status] - rank[b.status]) ||
        String(a.period).localeCompare(String(b.period)) ||
        ((b.net || 0) - (a.net || 0));
    });

  const summary = rows.reduce((acc, row) => {
    acc.products++;
    acc.qty += row.qty || 0;
    acc.net += row.net || 0;
    acc[row.status] = (acc[row.status] || 0) + 1;
    if (row.status !== 'costed') {
      acc.problemProducts++;
      acc.problemQty += row.qty || 0;
      acc.problemNet += row.net || 0;
    }
    return acc;
  }, {
    periodKey: periodKey || 'ALL',
    products: 0,
    qty: 0,
    net: 0,
    costed: 0,
    estimated: 0,
    partial: 0,
    uncosted: 0,
    problemProducts: 0,
    problemQty: 0,
    problemNet: 0
  });

  return {
    summary,
    problemRows: rows.filter(r => r.status !== 'costed').slice(0, 200),
    topUncostedByNet: rows
      .filter(r => r.status === 'uncosted' || r.status === 'partial')
      .sort((a, b) => (b.net || 0) - (a.net || 0))
      .slice(0, 50)
  };
}

function diagnoseMissingCostSources(periodKey) {
  periodKey = String(periodKey || '').trim();
  const coverage = diagnoseMovingAverageCostCoverage(periodKey);
  const problemAsins = {};
  coverage.problemRows.forEach(row => { problemAsins[row.asin] = row; });

  const skuToAsin = buildSkuToAsinMap_();
  const asinMeta = readLifecycleMeta_();
  const txRows = readTransactionRows_().filter(tx => !periodKey || tx.period === periodKey);
  const reorderRows = readReorderRows_();

  const txByAsin = {};
  txRows.forEach(tx => {
    const asin = tx.asin || skuToAsin[tx.sku] || '';
    if (!asin || !problemAsins[asin]) return;
    if (!txByAsin[asin]) txByAsin[asin] = {};
    if (!txByAsin[asin][tx.sku]) {
      txByAsin[asin][tx.sku] = { sku: tx.sku, orderQty: 0, returnQty: 0, net: 0 };
    }
    const s = txByAsin[asin][tx.sku];
    if (tx.type === '注文') s.orderQty += tx.qty || 0;
    else if (tx.type === '返金') s.returnQty += Math.abs(tx.qty || 0);
    s.net += tx.net || 0;
  });

  const reorderBySku = {};
  const reorderByPid = {};
  reorderRows.forEach(r => {
    if (r.sku) {
      if (!reorderBySku[r.sku]) reorderBySku[r.sku] = [];
      reorderBySku[r.sku].push(r);
    }
    if (r.product_id) {
      if (!reorderByPid[r.product_id]) reorderByPid[r.product_id] = [];
      reorderByPid[r.product_id].push(r);
    }
  });

  const rows = Object.keys(problemAsins).map(asin => {
    const problem = problemAsins[asin];
    const meta = asinMeta[asin] || {};
    const skuRows = Object.values(txByAsin[asin] || {}).map(s => {
      const skuReorders = reorderBySku[s.sku] || [];
      const pidReorders = meta.productId ? (reorderByPid[meta.productId] || []) : [];
      const latestSku = skuReorders.slice().sort((a, b) => b.time - a.time)[0] || null;
      const latestPid = pidReorders.slice().sort((a, b) => b.time - a.time)[0] || null;
      return {
        sku: s.sku,
        order_qty: s.orderQty,
        return_qty: s.returnQty,
        net: Math.round(s.net),
        reorder_by_sku_count: skuReorders.length,
        reorder_by_product_id_count: pidReorders.length,
        latest_sku_landed_cost: latestSku ? latestSku.unit_cost : null,
        latest_sku_order_date: latestSku ? String(latestSku.date).slice(0, 10) : '',
        latest_product_landed_cost: latestPid ? latestPid.unit_cost : null,
        latest_product_order_date: latestPid ? String(latestPid.date).slice(0, 10) : ''
      };
    });

    let cause = 'unknown';
    const hasCurrent = meta.currentLandedCost !== null && meta.currentLandedCost > 0;
    const hasAnyReorder = skuRows.some(s => s.reorder_by_sku_count > 0 || s.reorder_by_product_id_count > 0);
    if (!meta.productId) cause = 'missing_product_lifecycle';
    else if (!hasCurrent && !hasAnyReorder) cause = 'no_current_landed_cost_and_no_reorder_history';
    else if (!hasAnyReorder) cause = 'no_reorder_history';
    else if (!hasCurrent) cause = 'no_current_landed_cost_fallback';

    return {
      period: problem.period,
      asin,
      title: problem.title,
      status: problem.status,
      qty: problem.qty,
      return_qty: problem.return_qty,
      expected_cost_qty: problem.expected_cost_qty,
      uncovered_qty: problem.uncovered_qty,
      net: problem.net,
      current_landed_cost: meta.currentLandedCost,
      cost_source: problem.cost_source || '',
      manual_fallbacks: problem.manual_fallbacks || [],
      product_id: meta.productId || '',
      cause,
      skus: skuRows
    };
  }).sort((a, b) => (b.net || 0) - (a.net || 0));

  const causeSummary = rows.reduce((acc, row) => {
    acc[row.cause] = (acc[row.cause] || 0) + 1;
    return acc;
  }, {});

  return {
    periodKey: periodKey || 'ALL',
    summary: coverage.summary,
    causeSummary,
    rows: rows.slice(0, 200)
  };
}

// ── transaction_history から既存の取込済み明細数をキー別に取得 ──
function getExistingTransactionKeyCounts_(periodKey) {
  const sheet = getSheetByName_(SHEET_TRANSACTION_HISTORY, REQUIRED_HEADERS_TRANSACTION);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};
  const headers   = data[0];
  const orderIdx  = headers.indexOf('order_id');
  const skuIdx    = headers.indexOf('sku');
  const periodIdx = headers.indexOf('period_key');
  const dateIdx   = headers.indexOf('date');
  const typeIdx   = headers.indexOf('transaction_type');
  const qtyIdx    = headers.indexOf('qty');
  const salesIdx  = headers.indexOf('sales_taxin');
  const feeIdx    = headers.indexOf('fee');
  const fbaIdx    = headers.indexOf('fba_fee');
  const discIdx   = headers.indexOf('discount');
  const ptsIdx    = headers.indexOf('points');
  const netIdx    = headers.indexOf('net');
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][periodIdx]) !== periodKey) continue;
    const key = makeTransactionDedupeKey_({
      orderId: data[i][orderIdx],
      date: data[i][dateIdx],
      sku: data[i][skuIdx],
      type: data[i][typeIdx],
      qty: data[i][qtyIdx],
      salesTaxin: data[i][salesIdx],
      fee: data[i][feeIdx],
      fbaFee: data[i][fbaIdx],
      discount: data[i][discIdx],
      points: data[i][ptsIdx],
      net: data[i][netIdx]
    });
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
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
  return getPeriodSummaryMovingAverage_(periodKey);

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
function toDayString_(dateVal) {
  if (dateVal instanceof Date) {
    const y = dateVal.getFullYear();
    const m = String(dateVal.getMonth() + 1).padStart(2, '0');
    const d = String(dateVal.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(dateVal || '').slice(0, 10);
}

// 日別の粗利・商品別内訳。月次の移動平均原価(calculateMovingAverageActuals_)を
// asinごとの単価としてそのまま日別の数量に適用する(月内は原価が一定という前提は
// 月次サマリーの粗利計算と同じ)。月次合計と日別合計の粗利が一致するように、
// 期間サマリーと同じ landed_cost_used / cost_source を再利用する。
function getDailySales_(periodKey) {
  const calc = calculateMovingAverageActuals_();

  const perAsinCost = {};
  Object.keys(calc.byPeriodAsin).forEach(key => {
    const s = calc.byPeriodAsin[key];
    if (s.period !== periodKey) return;
    const entry = buildSalesActualEntry_(s);
    perAsinCost[s.asin] = {
      landedCost: entry.landed_cost_used,
      costSource: entry.cost_source
    };
  });

  const dayMap = {};
  const ensureDay = (day) => {
    if (!dayMap[day]) dayMap[day] = { date: day, net: 0, sales_taxin: 0, qty: 0, return_qty: 0, byAsin: {} };
    return dayMap[day];
  };
  const ensureProduct = (dayEntry, asin) => {
    if (!dayEntry.byAsin[asin]) {
      const meta = calc.asinMeta[asin] || {};
      dayEntry.byAsin[asin] = {
        asin,
        title: meta.title || asin,
        subtitle: meta.subtitle || '',
        emoji: meta.emoji || '📦',
        qty: 0,
        return_qty: 0,
        sales_taxin: 0,
        net: 0
      };
    }
    return dayEntry.byAsin[asin];
  };

  calc.txRows.forEach(tx => {
    if (tx.period !== periodKey || !tx.asin) return;
    const day = toDayString_(tx.date);
    if (!day) return;
    const dayEntry = ensureDay(day);
    const product = ensureProduct(dayEntry, tx.asin);

    if (tx.type === '注文') {
      dayEntry.net += tx.net;
      dayEntry.sales_taxin += tx.salesTaxin;
      dayEntry.qty += tx.qty;
      product.qty += tx.qty;
      product.sales_taxin += tx.salesTaxin;
      product.net += tx.net;
    } else if (tx.type === '返金') {
      dayEntry.net += tx.net;
      dayEntry.sales_taxin += tx.salesTaxin;
      dayEntry.return_qty += Math.abs(tx.qty);
      product.return_qty += Math.abs(tx.qty);
      product.sales_taxin += tx.salesTaxin;
      product.net += tx.net;
    }
  });

  return Object.values(dayMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(dayEntry => {
      const products = Object.values(dayEntry.byAsin).map(p => {
        const cost = perAsinCost[p.asin];
        const landedCost = cost ? cost.landedCost : null;
        const netUnits = p.qty - p.return_qty;
        const fullyReturned = Math.abs(netUnits) < 0.000001;
        const cogs = landedCost !== null ? landedCost * netUnits : 0;
        const grossProfit = (landedCost !== null || fullyReturned) ? Math.round(p.net - cogs) : null;
        return {
          asin: p.asin,
          title: p.title,
          subtitle: p.subtitle,
          emoji: p.emoji,
          qty: Math.round(p.qty),
          return_qty: Math.round(p.return_qty),
          sales_taxin: Math.round(p.sales_taxin),
          net: Math.round(p.net),
          cogs: Math.round(cogs),
          gross_profit: grossProfit,
          cost_complete: grossProfit !== null,
          cost_sources: cost && cost.costSource ? [cost.costSource] : []
        };
      }).sort((a, b) => b.sales_taxin - a.sales_taxin);

      const knownProducts = products.filter(p => p.gross_profit !== null);
      const missingCount = products.length - knownProducts.length;
      const knownGrossProfit = knownProducts.reduce((sum, p) => sum + p.gross_profit, 0);

      return {
        date: dayEntry.date,
        net: Math.round(dayEntry.net),
        sales_taxin: Math.round(dayEntry.sales_taxin),
        qty: Math.round(dayEntry.qty),
        return_qty: Math.round(dayEntry.return_qty),
        gross_profit: missingCount === 0 ? Math.round(knownGrossProfit) : null,
        known_gross_profit: Math.round(knownGrossProfit),
        cost_complete: missingCount === 0,
        missing_cost_count: missingCount,
        products
      };
    });
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

function getAsinList_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const asinIdx = headers.indexOf('asin');
  const nameIdx = headers.indexOf('product_name');
  
  const list = [];
  const seen = new Set();
  for (let i = 1; i < data.length; i++) {
    const asin = String(data[i][asinIdx] || '').trim().toUpperCase();
    const name = String(data[i][nameIdx] || '').trim();
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    list.push({ asin: asin, name: name || asin });
  }
  return list;
}

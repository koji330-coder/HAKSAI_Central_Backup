const SHEET_MOVING_AVG_COST_ISSUES = 'moving_avg_cost_issues';
const SHEET_MOVING_AVG_COST_IMPORT_LOG = 'moving_avg_cost_issues_import_log';

function exportMovingAverageCostIssues(periodKey) {
  periodKey = String(periodKey || '').trim();
  if (!periodKey) {
    const periods = getAvailablePeriods();
    periodKey = periods && periods.length ? periods[0] : '';
  }
  const diagnosticPeriodKey = periodKey === 'ALL' ? '' : periodKey;
  const diagnostic = diagnoseMissingCostSources(diagnosticPeriodKey);
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_MOVING_AVG_COST_ISSUES);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(SHEET_MOVING_AVG_COST_ISSUES);

  const headers = [
    'period', 'status', 'cause',
    'ASIN', 'SKU', 'product_id', '商品名',
    '販売数', '返品数', '原価対象数', '未カバー数', '手取合計',
    'current_landed_cost',
    'reorder_by_sku_count', 'latest_sku_landed_cost', 'latest_sku_order_date',
    'reorder_by_product_id_count', 'latest_product_landed_cost', 'latest_product_order_date',
    '推奨最小数量',
    '着地原価（手入力）', '初期ロット数量（手入力）', '適用開始日（手入力）',
    '処理方針', 'メモ'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  const rows = [];
  diagnostic.rows.forEach(item => {
    const skuRows = item.skus && item.skus.length ? item.skus : [{
      sku: '',
      order_qty: item.qty || 0,
      return_qty: item.return_qty || 0,
      net: item.net || 0,
      reorder_by_sku_count: 0,
      reorder_by_product_id_count: 0,
      latest_sku_landed_cost: null,
      latest_sku_order_date: '',
      latest_product_landed_cost: null,
      latest_product_order_date: ''
    }];
    skuRows.forEach(skuRow => {
      const expectedQty = Math.max(0, Number(skuRow.order_qty || 0) - Number(skuRow.return_qty || 0));
      const suggestedQty = Math.max(expectedQty, Number(item.uncovered_qty || 0), Number(item.expected_cost_qty || 0));
      const suggestedCost = firstPositiveNumber_(
        item.current_landed_cost,
        skuRow.latest_sku_landed_cost,
        skuRow.latest_product_landed_cost
      );
      rows.push([
        item.period,
        item.status,
        item.cause,
        item.asin,
        skuRow.sku,
        item.product_id || '',
        item.title,
        Number(skuRow.order_qty || 0),
        Number(skuRow.return_qty || 0),
        expectedQty,
        Number(item.uncovered_qty || 0),
        Math.round(Number(skuRow.net || 0)),
        item.current_landed_cost ?? '',
        Number(skuRow.reorder_by_sku_count || 0),
        skuRow.latest_sku_landed_cost ?? '',
        skuRow.latest_sku_order_date || '',
        Number(skuRow.reorder_by_product_id_count || 0),
        skuRow.latest_product_landed_cost ?? '',
        skuRow.latest_product_order_date || '',
        suggestedQty || '',
        suggestedCost ?? '',
        '',
        item.period ? item.period + '-01' : '',
        '',
        ''
      ]);
    });
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 8, rows.length, 6).setNumberFormat('#,##0');
    sheet.getRange(2, 13, rows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(2, 15, rows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(2, 18, rows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(2, 20, rows.length, 3).setNumberFormat('#,##0');
    sheet.getRange(2, 23, rows.length, 1).setNumberFormat('@STRING@');
  }

  sheet.setColumnWidth(4, 130);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 250);
  sheet.setColumnWidth(7, 360);
  sheet.setColumnWidth(21, 150);
  sheet.setColumnWidth(22, 170);
  sheet.setColumnWidth(23, 170);
  sheet.setColumnWidth(24, 120);
  sheet.setColumnWidth(25, 240);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    rows.length + '行を ' + SHEET_MOVING_AVG_COST_ISSUES + ' に出力しました。',
    '平均原価デバッグ', 6
  );
  return {
    periodKey: diagnostic.periodKey,
    rows: rows.length,
    sheet: SHEET_MOVING_AVG_COST_ISSUES,
    summary: diagnostic.summary,
    causeSummary: diagnostic.causeSummary
  };
}

function exportMovingAverageCostIssuesAll() {
  return exportMovingAverageCostIssues('ALL');
}

function importMovingAverageCostIssues(dryRun) {
  dryRun = dryRun !== false;
  const ss = getSpreadsheet_();
  const srcSheet = ss.getSheetByName(SHEET_MOVING_AVG_COST_ISSUES);
  if (!srcSheet) throw new Error(SHEET_MOVING_AVG_COST_ISSUES + ' シートがありません。exportMovingAverageCostIssues() を先に実行してください。');

  const data = srcSheet.getDataRange().getValues();
  if (data.length <= 1) return { dryRun, inserted: 0, skipped: 0, logSheet: '' };
  const headers = data[0].map(h => String(h || '').trim());
  const h = name => headers.indexOf(name);
  const required = ['period', 'ASIN', 'SKU', 'product_id', '商品名', '着地原価（手入力）', '初期ロット数量（手入力）', '適用開始日（手入力）'];
  required.forEach(name => {
    if (h(name) < 0) throw new Error(SHEET_MOVING_AVG_COST_ISSUES + ' に必要列がありません: ' + name);
  });

  const reorderSheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const reorderHeaders = getHeaders_(reorderSheet, REQUIRED_HEADERS_REORDER);
  const r = name => reorderHeaders.indexOf(name);
  const existingKeys = getExistingMovingAverageManualLotKeys_(reorderSheet, reorderHeaders);
  const now = new Date().toISOString();
  const rowsToInsert = [];
  const logRows = [];
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const sku = String(row[h('SKU')] || '').trim();
    const productId = String(row[h('product_id')] || '').trim();
    const cost = toNumberOrNull_(row[h('着地原価（手入力）')]);
    const qty = toNumberOrNull_(row[h('初期ロット数量（手入力）')]);
    const applyDate = normalizeManualCostDate_(row[h('適用開始日（手入力）')] || (row[h('period')] ? String(row[h('period')]) + '-01' : ''));
    const policyIdx = h('処理方針');
    const policy = policyIdx >= 0 ? String(row[policyIdx] || '').trim() : '';
    const asin = String(row[h('ASIN')] || '').trim();
    const title = String(row[h('商品名')] || '').trim();
    const period = String(row[h('period')] || '').trim();

    if (!sku && !productId) {
      skipped++;
      logRows.push([now, 'skip', i + 1, period, asin, sku, productId, qty ?? '', cost ?? '', applyDate, 'SKU/product_id missing']);
      continue;
    }
    if (cost === null || cost <= 0 || qty === null || qty <= 0 || !applyDate) {
      skipped++;
      logRows.push([now, 'skip', i + 1, period, asin, sku, productId, qty ?? '', cost ?? '', applyDate, 'manual cost/quantity/date missing']);
      continue;
    }
    if (policy && ['skip', 'スキップ', '除外', 'ignore'].includes(policy.toLowerCase())) {
      skipped++;
      logRows.push([now, 'skip', i + 1, period, asin, sku, productId, qty, cost, applyDate, 'policy skip']);
      continue;
    }

    const key = makeMovingAverageManualLotKey_(sku, productId, applyDate, qty, cost);
    if (existingKeys[key]) {
      skipped++;
      logRows.push([now, 'skip', i + 1, period, asin, sku, productId, qty, cost, applyDate, 'same lot already exists']);
      continue;
    }
    existingKeys[key] = true;

    const newRow = new Array(reorderHeaders.length).fill('');
    newRow[r('id')] = Utilities.getUuid();
    newRow[r('product_id')] = productId;
    newRow[r('sku')] = sku;
    newRow[r('order_date')] = applyDate;
    newRow[r('quantity')] = qty;
    newRow[r('landed_cost_actual')] = cost;
    newRow[r('notes')] = ['moving_avg_cost_issues取込', period, asin, title].filter(Boolean).join(' / ');
    newRow[r('created_at')] = now;
    rowsToInsert.push(newRow);
    logRows.push([now, dryRun ? 'dryRun' : 'insert', i + 1, period, asin, sku, productId, qty, cost, applyDate, '']);
  }

  let backupSheet = '';
  if (!dryRun && rowsToInsert.length) {
    backupSheet = createSheetBackup_(SHEET_REORDER_HISTORY);
    const startRow = reorderSheet.getLastRow() + 1;
    const orderDateCol = r('order_date') + 1;
    reorderSheet.getRange(startRow, orderDateCol, rowsToInsert.length, 1).setNumberFormat('@STRING@');
    reorderSheet.getRange(startRow, 1, rowsToInsert.length, reorderHeaders.length).setValues(rowsToInsert);
  }

  const logSheet = writeMovingAverageCostIssuesImportLog_(logRows);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    (dryRun ? 'dryRun: ' : '') + rowsToInsert.length + '件登録対象 / ' + skipped + '件スキップ',
    '平均原価 原価取込', 6
  );
  return {
    dryRun,
    inserted: dryRun ? 0 : rowsToInsert.length,
    insertCandidates: rowsToInsert.length,
    skipped,
    backupSheet,
    logSheet
  };
}

function applyMovingAverageCostIssues() {
  return importMovingAverageCostIssues(false);
}

function firstPositiveNumber_() {
  for (let i = 0; i < arguments.length; i++) {
    const n = toNumberOrNull_(arguments[i]);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function normalizeManualCostDate_(value) {
  const date = parseDate_(value);
  if (!date) return '';
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function makeMovingAverageManualLotKey_(sku, productId, date, qty, cost) {
  return [
    String(sku || '').trim(),
    String(productId || '').trim(),
    String(date || '').trim(),
    String(Number(qty) || 0),
    String(Number(cost) || 0)
  ].join('__');
}

function getExistingMovingAverageManualLotKeys_(sheet, headers) {
  const data = sheet.getDataRange().getValues();
  const idx = name => headers.indexOf(name);
  const keys = {};
  for (let i = 1; i < data.length; i++) {
    const date = normalizeManualCostDate_(data[i][idx('order_date')]);
    const qty = toNumberOrNull_(data[i][idx('quantity')]);
    const cost = toNumberOrNull_(data[i][idx('landed_cost_actual')]);
    if (!date || qty === null || cost === null) continue;
    const sku = String(data[i][idx('sku')] || '').trim();
    const productId = String(data[i][idx('product_id')] || '').trim();
    keys[makeMovingAverageManualLotKey_(sku, productId, date, qty, cost)] = true;
  }
  return keys;
}

function writeMovingAverageCostIssuesImportLog_(rows) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_MOVING_AVG_COST_IMPORT_LOG);
  if (!sheet) sheet = ss.insertSheet(SHEET_MOVING_AVG_COST_IMPORT_LOG);
  sheet.clearContents();
  const headers = [
    'checked_at', 'action', 'source_row', 'period', 'asin', 'sku', 'product_id',
    'quantity', 'landed_cost_actual', 'order_date', 'message'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21')
    .setFontColor('#e8d5a3')
    .setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  return SHEET_MOVING_AVG_COST_IMPORT_LOG;
}

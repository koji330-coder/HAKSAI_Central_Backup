/****************************************************
 * HAKSAI Central
 * 初期在庫原価インポート関数
 *
 * 目的：
 * - 2025-12-31時点の確定申告採用原価を
 *   reorder_history に初期在庫原価として追加する
 * - これにより、2026年初期の売上にも原価が当たる
 ****************************************************/

const INITIAL_COST_SPREADSHEET_ID = '1w71T_U8dDRK9FKhAbFP7JqPKuHWxDkJe1Cu2ISjHBsw';

const INITIAL_COST_IMPORT_SHEET = 'initial_landed_cost_import';
const INITIAL_COST_REORDER_SHEET = 'reorder_history';
const INITIAL_COST_PRODUCT_SHEET = 'product_lifecycle';
const INITIAL_COST_SKU_MASTER_SHEET = 'sku_master';

const INITIAL_COST_ORDER_DATE = '2025-12-31';

const INITIAL_COST_ROWS = [
  {
    sku: '1G-J7MH-R6DY',
    landed_cost_actual: 1393,
    memo: 'バイクカバー 初期在庫原価 / 確定申告採用原価',
  },
  {
    sku: '7R-S2TJ-79AH',
    landed_cost_actual: 1393,
    memo: 'バイクカバー 初期在庫原価 / 確定申告採用原価',
  },
  {
    sku: 'PH-ISWG-C02J',
    landed_cost_actual: 1396,
    memo: 'CEVAN アウトドアチェア 初期在庫原価 / 確定申告採用原価',
  },
  {
    sku: 'O8-GQWJ-FBLV',
    landed_cost_actual: 1451,
    memo: 'バイクカバー 初期在庫原価 / 確定申告採用原価',
  },
  {
    sku: 'Z1-OEHV-SMGO',
    landed_cost_actual: 1451,
    memo: 'バイクカバー 初期在庫原価 / 確定申告採用原価',
  },
  {
    sku: '4J-BX8I-CZ03',
    landed_cost_actual: 1567,
    memo: 'バイクカバー 初期在庫原価 / 確定申告採用原価',
  },
  {
    sku: '61-7ITB-753Q',
    landed_cost_actual: 1567,
    memo: 'バイクカバー 初期在庫原価 / 確定申告採用原価',
  },
];

/**
 * 1. 初期原価インポート用シートを作成
 *
 * まずこれを実行。
 * initial_landed_cost_import シートを確認して、
 * apply にチェックが入っている行だけ反映される。
 */
function createInitialLandedCostImportSheet() {
  const ss = SpreadsheetApp.openById(INITIAL_COST_SPREADSHEET_ID);

  const skuRows = icGetSheetObjects_(ss, INITIAL_COST_SKU_MASTER_SHEET);
  const products = icGetSheetObjects_(ss, INITIAL_COST_PRODUCT_SHEET);
  const reorders = icGetSheetObjects_(ss, INITIAL_COST_REORDER_SHEET);

  const skuMap = {};
  skuRows.forEach(row => {
    const sku = String(row.sku || '').trim();
    if (!sku) return;
    skuMap[sku] = row;
  });

  const productByAsin = {};
  products.forEach(row => {
    const asin = String(row.asin || '').trim();
    if (!asin) return;
    productByAsin[asin] = row;
  });

  const rows = [[
    'apply',
    'order_date',
    'sku',
    'asin',
    'product_id',
    'product_name',
    'landed_cost_actual',
    'quantity',
    'notes',
    'existing_reorder_dates',
    'duplicate_check',
  ]];

  INITIAL_COST_ROWS.forEach(item => {
    const skuInfo = skuMap[item.sku] || {};
    const asin = String(skuInfo.asin || '').trim();
    const product = productByAsin[asin] || {};

    const existingForSku = reorders.filter(r => String(r.sku || '').trim() === item.sku);
    const existingDates = existingForSku
      .map(r => `${r.order_date || ''}: ${r.landed_cost_actual || ''}`)
      .filter(Boolean)
      .join(' / ');

    const duplicate = existingForSku.some(r => {
      const d = String(r.order_date || '').slice(0, 10);
      const cost = icToNumber_(r.landed_cost_actual);
      return d === INITIAL_COST_ORDER_DATE && cost === Number(item.landed_cost_actual);
    });

    rows.push([
      true,
      INITIAL_COST_ORDER_DATE,
      item.sku,
      asin,
      product.id || '',
      skuInfo.product_name || product.title || '',
      item.landed_cost_actual,
      '',
      item.memo,
      existingDates,
      duplicate ? 'DUPLICATE_EXISTS' : 'OK',
    ]);
  });

  let sheet = ss.getSheetByName(INITIAL_COST_IMPORT_SHEET);
  if (!sheet) sheet = ss.insertSheet(INITIAL_COST_IMPORT_SHEET);

  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, rows[0].length);

  const header = sheet.getRange(1, 1, 1, rows[0].length);
  header.setFontWeight('bold');
  header.setBackground('#222222');
  header.setFontColor('#ffffff');

  if (rows.length > 1) {
    sheet.getRange(2, 1, rows.length - 1, 1).insertCheckboxes();
    sheet.getRange(2, 7, rows.length - 1, 1).setBackground('#fff2cc');
    sheet.getRange(2, 9, rows.length - 1, 1).setBackground('#eaf2f8');
  }

  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, rows.length, rows[0].length).createFilter();

  Logger.log(`初期原価インポートシートを作成しました: ${INITIAL_COST_IMPORT_SHEET}`);

  return {
    status: 'ok',
    sheetName: INITIAL_COST_IMPORT_SHEET,
    count: rows.length - 1,
  };
}

/**
 * 2. initial_landed_cost_import から reorder_history へ反映
 *
 * apply が TRUE の行だけ追加。
 * 同じ SKU + order_date + landed_cost_actual が既にあればスキップ。
 */
function applyInitialLandedCosts() {
  const ss = SpreadsheetApp.openById(INITIAL_COST_SPREADSHEET_ID);

  const importRows = icGetSheetObjects_(ss, INITIAL_COST_IMPORT_SHEET);
  if (!importRows.length) {
    throw new Error(`${INITIAL_COST_IMPORT_SHEET} にデータがありません。先に createInitialLandedCostImportSheet() を実行してください。`);
  }

  const reorderSheet = ss.getSheetByName(INITIAL_COST_REORDER_SHEET);
  if (!reorderSheet) {
    throw new Error(`${INITIAL_COST_REORDER_SHEET} が見つかりません。`);
  }

  icBackupSheet_(ss, INITIAL_COST_REORDER_SHEET);

  const reorderValues = reorderSheet.getDataRange().getValues();
  const headers = reorderValues[0].map(h => String(h || '').trim());
  const headerMap = icMakeHeaderMap_(headers);

  const existingKeys = {};

  for (let r = 1; r < reorderValues.length; r++) {
    const row = reorderValues[r];
    const sku = String(row[headerMap.sku] || '').trim();
    const orderDate = headerMap.order_date !== undefined
      ? icDateKey_(row[headerMap.order_date])
      : '';
    const cost = headerMap.landed_cost_actual !== undefined
      ? icToNumber_(row[headerMap.landed_cost_actual])
      : 0;

    if (sku && orderDate && cost) {
      existingKeys[`${sku}__${orderDate}__${cost}`] = true;
    }
  }

  const rowsToAppend = [];
  const logs = [];

  let added = 0;
  let skipped = 0;

  importRows.forEach(row => {
    if (!icIsTruthy_(row.apply)) {
      skipped++;
      return;
    }

    const sku = String(row.sku || '').trim();
    const orderDate = String(row.order_date || INITIAL_COST_ORDER_DATE).slice(0, 10);
    const landedCost = icToNumber_(row.landed_cost_actual);

    if (!sku || !orderDate || !landedCost) {
      skipped++;
      logs.push([new Date(), 'skip', sku, orderDate, landedCost, 'SKU / order_date / landed_cost_actual のいずれかが空']);
      return;
    }

    const key = `${sku}__${orderDate}__${landedCost}`;

    if (existingKeys[key]) {
      skipped++;
      logs.push([new Date(), 'skip', sku, orderDate, landedCost, '同一SKU・日付・原価のレコードが既に存在']);
      return;
    }

    const newObj = {
      id: `initcost_${sku}_${orderDate}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      product_id: row.product_id || '',
      sku,
      order_date: orderDate,
      quantity: row.quantity || '',
      unit_price_1688: '',
      landed_cost_actual: landedCost,
      lead_time_days: '',
      expected_arrival_date: '',
      fba_fee_at_order: '',
      selling_price_at_order: '',
      notes: row.notes || '初期在庫原価 / 確定申告採用原価',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const appendRow = headers.map(h => {
      if (!h) return '';

      if (newObj[h] !== undefined) {
        return newObj[h];
      }

      return '';
    });

    rowsToAppend.push(appendRow);
    existingKeys[key] = true;
    added++;

    logs.push([new Date(), 'add', sku, orderDate, landedCost, row.notes || '']);
  });

  if (rowsToAppend.length) {
    reorderSheet
      .getRange(reorderSheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length)
      .setValues(rowsToAppend);
  }

  icWriteInitialCostApplyLog_(ss, logs);

  Logger.log(`初期原価反映完了。追加: ${added}, スキップ: ${skipped}`);

  return {
    status: 'ok',
    added,
    skipped,
  };
}

/**
 * 反映後の確認用。
 * 指定SKUの reorder_history をログ出力する。
 */
function debugInitialCostReorderRows() {
  const ss = SpreadsheetApp.openById(INITIAL_COST_SPREADSHEET_ID);
  const reorders = icGetSheetObjects_(ss, INITIAL_COST_REORDER_SHEET);

  const targetSkus = INITIAL_COST_ROWS.map(r => r.sku);
  const rows = reorders.filter(r => targetSkus.includes(String(r.sku || '').trim()));

  Logger.log(JSON.stringify(rows, null, 2));

  return {
    status: 'ok',
    count: rows.length,
    rows,
  };
}

/* ---------------- helper functions ---------------- */

function icGetSheetObjects_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h || '').trim());

  return values.slice(1)
    .filter(row => row.some(v => String(v || '').trim() !== ''))
    .map((row, i) => {
      const obj = { __rowNumber: i + 2 };
      headers.forEach((h, col) => {
        if (!h) return;
        obj[h] = row[col];
      });
      return obj;
    });
}

function icMakeHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i;
  });
  return map;
}

function icToNumber_(value) {
  if (typeof value === 'number') return value;

  const s = String(value || '')
    .replace(/[,\s¥￥]/g, '')
    .replace(/%$/, '');

  if (!s) return 0;

  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function icIsTruthy_(value) {
  const s = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'はい', '反映', 'apply'].includes(s);
}

function icDateKey_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const s = String(value).trim();

  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  return s.slice(0, 10);
}

function icBackupSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`${sheetName} が見つかりません。`);

  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );

  const backupName = `${sheetName}_backup_${timestamp}`;
  const copied = sheet.copyTo(ss);
  copied.setName(backupName);

  return backupName;
}

function icWriteInitialCostApplyLog_(ss, logs) {
  const sheetName = 'initial_landed_cost_apply_log';

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 6).setValues([[
      'timestamp',
      'action',
      'sku',
      'order_date',
      'landed_cost_actual',
      'message',
    ]]);
    sheet.setFrozenRows(1);
  }

  if (!logs.length) return;

  sheet
    .getRange(sheet.getLastRow() + 1, 1, logs.length, 6)
    .setValues(logs);

  sheet.autoResizeColumns(1, 6);
}
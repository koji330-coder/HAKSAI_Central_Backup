/**
 * cost_simulation の実績反映。
 *
 * transaction_history の直近90日をASIN単位で集計し、実測できる
 * price / amazon / fba を更新する。net / rate は利益シミュレーターと
 * 同じ式で再計算し、その他の手入力値と未知のキーは保持する。
 *
 * 初回運用:
 *   backupProductLifecycleForCostSim()
 *   actualizeCostSim({ dryRun: true })
 *   actualizeCostSim()
 */
const CSA_WINDOW_DAYS = 90;
const CSA_ACTUAL_KEYS = ['price', 'amazon', 'fba'];
const CSA_MANUAL_COST_KEYS = ['cost', 'rakumart', 'shipping', 'ad', 'other'];

function csaNum_(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/[%,\s]/g, ''));
  return isFinite(n) ? n : 0;
}

function csaParseJsonObject_(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.assign({}, value);
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    // 過去にGAS表示形式 {price=1000.0, ...} で保存されたセルだけ救済する。
    const legacy = {};
    text.replace(/^\{|\}$/g, '').split(',').forEach(function(pair) {
      const i = pair.indexOf('=');
      if (i < 0) return;
      const key = pair.slice(0, i).trim();
      const raw = pair.slice(i + 1).trim();
      if (!key) return;
      const n = Number(raw);
      legacy[key] = raw !== '' && isFinite(n) ? n : raw;
    });
    return legacy;
  }
}

function csaRequireColumns_(headers, names, sheetName) {
  const cols = {};
  names.forEach(function(name) {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(sheetName + ' に列がありません: ' + name);
    cols[name] = index;
  });
  return cols;
}

/** transaction_historyから直近90日の数量加重実績をASIN別に作る。 */
function csaBuildActuals_(now) {
  const sheet = getSpreadsheet_().getSheetByName('transaction_history');
  if (!sheet || sheet.getLastRow() < 2) return {};

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = csaRequireColumns_(headers,
    ['transaction_type', 'date', 'asin', 'qty', 'sales_taxin', 'fee', 'fba_fee'],
    'transaction_history');
  const baseNow = now instanceof Date ? now : new Date();
  const since = new Date(baseNow.getTime() - CSA_WINDOW_DAYS * 864e5);
  const agg = {};
  const diagnostics = {
    rows: values.length - 1, orderRows: 0, recentOrderRows: 0,
    usableRows: 0, missingAsin: 0, invalidDate: 0,
    minDate: '', maxDate: '', transactionTypes: {}
  };

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const type = String(row[col.transaction_type] || '').trim();
    diagnostics.transactionTypes[type || '(blank)'] = (diagnostics.transactionTypes[type || '(blank)'] || 0) + 1;
    if (type !== '注文') continue;
    diagnostics.orderRows++;
    const date = typeof parseDateLoose_ === 'function'
      ? parseDateLoose_(row[col.date])
      : (row[col.date] instanceof Date ? row[col.date] : new Date(row[col.date]));
    if (!date || isNaN(date.getTime())) { diagnostics.invalidDate++; continue; }
    const isoDate = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!diagnostics.minDate || isoDate < diagnostics.minDate) diagnostics.minDate = isoDate;
    if (!diagnostics.maxDate || isoDate > diagnostics.maxDate) diagnostics.maxDate = isoDate;
    if (date < since || date > baseNow) continue;
    diagnostics.recentOrderRows++;

    const asin = String(row[col.asin] || '').trim().toUpperCase();
    const qty = csaNum_(row[col.qty]);
    const sales = csaNum_(row[col.sales_taxin]);
    if (!asin) { diagnostics.missingAsin++; continue; }
    if (qty <= 0 || sales <= 0) continue;
    diagnostics.usableRows++;

    const a = agg[asin] || (agg[asin] = { qty: 0, sales: 0, fee: 0, fba: 0, lines: 0 });
    a.qty += qty;
    a.sales += sales;
    a.fee += Math.abs(csaNum_(row[col.fee]));
    a.fba += Math.abs(csaNum_(row[col.fba_fee]));
    a.lines++;
  }

  const actuals = {};
  Object.keys(agg).forEach(function(asin) {
    const a = agg[asin];
    actuals[asin] = {
      price: Math.round(a.sales / a.qty),
      amazon: Math.round(a.fee / a.qty),
      fba: Math.round(a.fba / a.qty),
      _units: a.qty,
      _lines: a.lines
    };
  });
  Object.defineProperty(actuals, '_diagnostics', { value: diagnostics, enumerable: false });
  return actuals;
}

function csaRecalculateProfit_(simulation) {
  const price = csaNum_(simulation.price);
  let net = price;
  CSA_MANUAL_COST_KEYS.concat(['amazon', 'fba']).forEach(function(key) {
    net -= csaNum_(simulation[key]);
  });
  simulation.net = net;
  simulation.rate = price ? Number((net / price * 100).toFixed(1)) : 0;
  return simulation;
}

/** product_lifecycleを同一スプレッドシート内に複製する（初回本適用前用）。 */
function backupProductLifecycleForCostSim() {
  const ss = getSpreadsheet_();
  const source = ss.getSheetByName('product_lifecycle');
  if (!source) throw new Error('product_lifecycle シートがありません。');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const name = 'product_lifecycle_backup_costsim_' + stamp;
  source.copyTo(ss).setName(name);
  return { status: 'ok', sheetName: name };
}

/** dryRun時は書き込まず、同じ集計・比較結果だけを返す。 */
function actualizeCostSim(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const actuals = csaBuildActuals_(opts.now);
  const sheet = getSpreadsheet_().getSheetByName('product_lifecycle');
  if (!sheet || sheet.getLastRow() < 2) {
    return { dryRun: dryRun, updated: 0, unchanged: 0, noActual: 0, sample: [] };
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = csaRequireColumns_(headers, ['asin', 'cost_simulation', 'profit'], 'product_lifecycle');
  const writes = [];
  const sample = [];
  let updated = 0;
  let unchanged = 0;
  let noActual = 0;

  for (let r = 1; r < values.length; r++) {
    const asin = String(values[r][col.asin] || '').trim().toUpperCase();
    const actual = actuals[asin];
    if (!asin || !actual) { noActual++; continue; }

    const simulation = csaParseJsonObject_(values[r][col.cost_simulation]);
    const before = {};
    CSA_ACTUAL_KEYS.forEach(function(key) {
      before[key] = simulation[key];
      simulation[key] = actual[key];
    });
    const beforeNet = simulation.net;
    const beforeRate = simulation.rate;
    csaRecalculateProfit_(simulation);

    const json = JSON.stringify(simulation);
    const oldSim = JSON.stringify(csaParseJsonObject_(values[r][col.cost_simulation]));
    const oldProfit = JSON.stringify(csaParseJsonObject_(values[r][col.profit]));
    if (json === oldSim && json === oldProfit) { unchanged++; continue; }

    updated++;
    writes.push({ row: r + 1, json: json });
    if (sample.length < 30) {
      sample.push({
        asin: asin, units: actual._units, lines: actual._lines,
        price: [before.price, simulation.price],
        amazon: [before.amazon, simulation.amazon],
        fba: [before.fba, simulation.fba],
        net: [beforeNet, simulation.net],
        rate: [beforeRate, simulation.rate]
      });
    }
  }

  if (!dryRun && writes.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      writes.forEach(function(write) {
        sheet.getRange(write.row, col.cost_simulation + 1).setValue(write.json);
        sheet.getRange(write.row, col.profit + 1).setValue(write.json);
      });
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }

  const result = {
    dryRun: dryRun,
    windowDays: CSA_WINDOW_DAYS,
    actualAsins: Object.keys(actuals).length,
    updated: updated,
    unchanged: unchanged,
    noActual: noActual,
    sample: sample,
    diagnostics: actuals._diagnostics || null
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

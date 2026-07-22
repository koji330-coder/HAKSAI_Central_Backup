/** 参入判断用データパック（読み取り専用） */
const DP_SHEETS = {
  tx: 'transaction_history',
  sku: 'sku_master',
  reorder: 'reorder_history',
  lifecycle: 'product_lifecycle',
  biz: 'business_report_period'
};

function dpRows_(name) {
  const reportSheets = new Set([DP_SHEETS.biz]);
  const ss = reportSheets.has(name) ? getReportSpreadsheet_() : getSpreadsheet_();
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const h = v[0].map(String);
  return v.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

function dpMedian_(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function dpNum_(v) {
  const n = Number(String(v).replace(/[%,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function dpNullableNum_(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[%,]/g, ''));
  return isNaN(n) ? null : n;
}

function dpJson_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch (e) { return fallback; }
}

function dpLifecycleCandidate_(row) {
  if (!row) return null;
  const pack = dpJson_(row.keepa_data, {});
  const pf = pack.product_facts || {};
  const pg = pack.page_facts || {};
  const mf = pack.market_facts || {};
  const screen = pack.decision_screen || {};
  const urls = dpJson_(row.urls, []);
  const keepaUrl = Array.isArray(urls)
    ? (urls.find(function(url) { return String(url).indexOf('keepa.com') >= 0; }) || '')
    : '';
  const price = pf.price == null || pf.price === '' ? row.price : pf.price;
  return {
    asin:String(row.asin || '').trim(),
    title:String(row.title || pf.title || '').trim() || null,
    category:String(row.category || '').trim() || null,
    price_min:dpNullableNum_(price),
    price_max:dpNullableNum_(price),
    monthly_sold:dpNullableNum_(pf.monthly_sold == null ? row.monthly_sales : pf.monthly_sold),
    offer_count:dpNullableNum_(mf.total_offer_count),
    fba_count:dpNullableNum_(mf.fba_offer_count),
    image_count:dpNullableNum_(pg.image_count),
    has_aplus:pg.has_aplus == null ? null : !!pg.has_aplus,
    keepa_url:String(keepaUrl || '').trim() || null,
    status:String(screen.result || screen.decision || row.status || '').trim() || null
  };
}

function dpCvr_(v) {
  const n = dpNum_(v);
  return n > 1 ? n / 100 : n;
}

function dpDate_(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return new Date(s.replace(/\s+JST$/i, ''));
}

function buildDecisionPack(asin) {
  asin = String(asin || '').trim();
  const since = new Date(Date.now() - 90 * 864e5);
  const names = {};
  dpRows_(DP_SHEETS.sku).forEach(r => (names[String(r.sku)] = r.product_name));

  const bySku = {};
  dpRows_(DP_SHEETS.tx).forEach(r => {
    if (String(r.transaction_type).trim() !== '注文') return;
    const d = dpDate_(r.date);
    if (!(d > since)) return;
    const qty = dpNum_(r.qty), sales = dpNum_(r.sales_taxin);
    if (qty <= 0 || sales <= 0) return;
    const sku = String(r.sku);
    (bySku[sku] = bySku[sku] || []).push({
      orderId: String(r.order_id || '').trim(),
      qty,
      unit: sales / qty,
      feeRate: Math.abs(dpNum_(r.fee)) / sales,
      fbaUnit: Math.abs(dpNum_(r.fba_fee)) / qty,
      asin: r.asin
    });
  });
  const fee_table = Object.entries(bySku).map(([sku, ts]) => ({
    sku,
    asin: ts[0].asin,
    name: String(names[sku] || '').slice(0, 40),
    orders_90d: new Set(ts.map(t => t.orderId).filter(Boolean)).size,
    transaction_lines_90d: ts.length,
    units_90d: ts.reduce((sum, t) => sum + t.qty, 0),
    unit_price_taxin: Math.round(dpMedian_(ts.map(t => t.unit))),
    fee_rate_taxin: +dpMedian_(ts.map(t => t.feeRate)).toFixed(3),
    fba_fee_unit: Math.round(dpMedian_(ts.map(t => t.fbaUnit)))
  })).sort((a, b) => a.fba_fee_unit - b.fba_fee_unit);

  const reorders = dpRows_(DP_SHEETS.reorder)
    .filter(r => dpNum_(r.unit_price_1688) > 0 && dpNum_(r.landed_cost_actual) > 0)
    .sort((a, b) => dpDate_(b.order_date) - dpDate_(a.order_date))
    .slice(0, 30)
    .map(r => ({
      sku: r.sku,
      order_date: r.order_date instanceof Date
        ? Utilities.formatDate(r.order_date, 'JST', 'yyyy-MM-dd') : String(r.order_date),
      cny: dpNum_(r.unit_price_1688),
      landed: dpNum_(r.landed_cost_actual),
      yen_per_cny: +(dpNum_(r.landed_cost_actual) / dpNum_(r.unit_price_1688)).toFixed(2)
    }));
  // Centralの現行UIはunit_price_1688を円/個で保存している。
  // 円建て値を円/元として誤配信しないよう、実測として妥当な行だけを採用する。
  const cnyReorders = reorders.filter(r => r.yen_per_cny >= 20 && r.yen_per_cny <= 60);

  let candidate = null;
  if (asin) {
    const hit = dpRows_(DP_SHEETS.lifecycle).find(r => String(r.asin || '').trim() === asin);
    candidate = dpLifecycleCandidate_(hit);
  }

  const biz = dpRows_(DP_SHEETS.biz);
  const lastKey = biz.reduce((m, r) => (String(r.period_key) > m ? String(r.period_key) : m), '');
  const lastPeriodRow = biz.find(r => String(r.period_key) === lastKey) || {};
  const own_baseline = biz
    .filter(r => String(r.period_key) === lastKey && dpNum_(r.sessions) > 0)
    .map(r => ({
      asin: r.asin, sessions: dpNum_(r.sessions),
      cvr: +dpCvr_(r.unit_session_rate).toFixed(3),
      units: dpNum_(r.ordered_units)
    }))
    .sort((a, b) => b.units - a.units).slice(0, 15);

  return {
    generated_at: new Date().toISOString(),
    window: '90d',
    requested_asin: asin || null,
    candidate,
    data_contract: {
      candidate_status_role: '一次選別ステータス。最終的な参入可否ではない',
      missing_numeric_value: 'nullは未取得、0は確認済みのゼロ',
      fee_table_role: '自社の手数料実績。候補商品の需要・販売数量の予測には使用しない',
      orders_90d_definition: '直近90日の重複を除いたAmazon注文番号数',
      transaction_lines_90d_definition: '直近90日の取引明細行数',
      units_90d_definition: '直近90日の販売個数合計',
      own_baseline_role: '最新レポート期間の自社実績。候補商品の予測値ではない',
      unit_price_1688_currency: 'JPY',
      landed_cost_actual_currency: 'JPY',
      yen_per_cny_rule: 'nullの場合は円/元係数を推定・補完しない'
    },
    yen_per_cny_composite_median: dpMedian_(cnyReorders.map(r => r.yen_per_cny)),
    overhead_recent: cnyReorders.slice(0, 10),
    fee_table,
    own_baseline_period: lastKey,
    own_baseline_date_from: String(lastPeriodRow.date_from || '').trim() || null,
    own_baseline_date_to: String(lastPeriodRow.date_to || '').trim() || null,
    own_baseline
  };
}

function doGetDecisionPack_(e) {
  const pack = buildDecisionPack(String(e.parameter.asin || '').trim());
  return ContentService.createTextOutput(JSON.stringify(pack, null, 1))
    .setMimeType(ContentService.MimeType.JSON);
}

function testDecisionPack() {
  Logger.log(JSON.stringify(buildDecisionPack(''), null, 2));
}

function testDecisionPackCandidate() {
  const first = dpRows_(DP_SHEETS.lifecycle).find(function(row) {
    return String(row.asin || '').trim() && dpJson_(row.keepa_data, {}).product_facts;
  });
  if (!first) throw new Error('product_lifecycleにKeepaリサーチカードがありません。');
  const asin = String(first.asin).trim();
  Logger.log(JSON.stringify({ asin: asin, candidate: buildDecisionPack(asin).candidate }, null, 2));
}

/** 実データの単位・除外理由を確認する読み取り専用診断。 */
function testPackDiagnostics() {
  const since = new Date(Date.now() - 90 * 864e5);
  const tx = dpRows_(DP_SHEETS.tx);
  const typeCounts = {};
  const dateSamples = [];
  let orderType = 0, validDate = 0, inWindow = 0, positive = 0;
  let minDate = null, maxDate = null;
  tx.forEach(r => {
    const type = String(r.transaction_type || '').trim() || '(blank)';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    if (type !== '注文') return;
    if (dateSamples.length < 5) {
      dateSamples.push({
        value: String(r.date),
        value_type: typeof r.date,
        is_date_object: r.date instanceof Date
      });
    }
    orderType++;
    const d = dpDate_(r.date);
    if (isNaN(d.getTime())) return;
    validDate++;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
    if (!(d > since)) return;
    inWindow++;
    if (dpNum_(r.qty) > 0 && dpNum_(r.sales_taxin) > 0) positive++;
  });

  const ratios = dpRows_(DP_SHEETS.reorder)
    .filter(r => dpNum_(r.unit_price_1688) > 0 && dpNum_(r.landed_cost_actual) > 0)
    .map(r => dpNum_(r.landed_cost_actual) / dpNum_(r.unit_price_1688));
  const bands = { under10: 0, from10to20: 0, from20to60: 0, over60: 0 };
  ratios.forEach(v => {
    if (v < 10) bands.under10++;
    else if (v < 20) bands.from10to20++;
    else if (v <= 60) bands.from20to60++;
    else bands.over60++;
  });

  Logger.log(JSON.stringify({
    transaction_history: {
      total: tx.length,
      type_counts: typeCounts,
      date_samples: dateSamples,
      order_type_rows: orderType,
      valid_date_rows: validDate,
      min_order_date: minDate ? minDate.toISOString() : null,
      max_order_date: maxDate ? maxDate.toISOString() : null,
      rows_in_90d: inWindow,
      rows_with_positive_qty_and_sales: positive
    },
    reorder_history: {
      ratio_count: ratios.length,
      ratio_bands: bands,
      ratio_median_all: dpMedian_(ratios),
      ratio_median_plausible_20_to_60: dpMedian_(ratios.filter(v => v >= 20 && v <= 60))
    }
  }, null, 2));
}

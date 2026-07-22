/** 既存ページ診断用データパック（読み取り専用） */
function apRows_(name) {
  const reportSheets = new Set(['business_report_period', 'ad_product_daily', 'inventory_snapshot']);
  const ss = reportSheets.has(name) ? getReportSpreadsheet_() : getSpreadsheet_();
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const h = v[0].map(String);
  return v.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

function apNum_(v) {
  const n = Number(String(v).replace(/[%,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function apCvr_(v) {
  const n = apNum_(v);
  return n > 1 ? n / 100 : n;
}

function apDate_(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return new Date(s.replace(/\s+JST$/i, ''));
}

function apMedian_(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildAuditPack(asin) {
  asin = String(asin || '').trim();
  const biz = apRows_('business_report_period');
  const keys = [...new Set(biz.map(r => String(r.period_key)))].sort();
  const curKey = keys[keys.length - 1] || '';
  const prevKey = keys[keys.length - 2] || '';
  const byAsin = {};
  biz.forEach(r => {
    const a = String(r.asin).trim();
    if (!a || (asin && a !== asin)) return;
    const rec = (byAsin[a] = byAsin[a] || { asin: a, title: String(r.title || '').slice(0, 40) });
    const p = {
      sessions: apNum_(r.sessions), pv: apNum_(r.page_views),
      cvr: +apCvr_(r.unit_session_rate).toFixed(4), units: apNum_(r.ordered_units),
      sales: apNum_(r.ordered_sales)
    };
    if (String(r.period_key) === curKey) rec.cur = p;
    if (String(r.period_key) === prevKey) rec.prev = p;
  });

  const since30 = new Date(Date.now() - 30 * 864e5);
  const ad = {};
  apRows_('ad_product_daily').forEach(r => {
    const d = apDate_(r.date);
    if (!(d > since30)) return;
    const a = String(r.asin).trim();
    if (asin && a !== asin) return;
    const x = (ad[a] = ad[a] || { imp: 0, clicks: 0, spend: 0, sales: 0, units: 0 });
    x.imp += apNum_(r.impressions); x.clicks += apNum_(r.clicks);
    x.spend += apNum_(r.spend); x.sales += apNum_(r.sales); x.units += apNum_(r.units);
  });

  const inv = {};
  apRows_('inventory_snapshot').forEach(r => {
    const a = String(r.asin).trim();
    if (asin && a !== asin) return;
    const d = apDate_(r.snapshot_date);
    if (!inv[a] || d > inv[a]._d) inv[a] = {
      _d: d, available: apNum_(r.available), inbound: apNum_(r.inbound),
      days_remain: apNum_(r.days_remain), alert: String(r.alert || '')
    };
  });

  const pl = {};
  apRows_('product_lifecycle').forEach(r => {
    const a = String(r.asin || '').trim();
    if (a && (!asin || a === asin)) pl[a] = {
      price: apNum_(r.price), landed_cost: apNum_(r.current_landed_cost),
      status: String(r.status || '')
    };
  });

  const since90 = new Date(Date.now() - 90 * 864e5);
  const feeAgg = {};
  apRows_('transaction_history').forEach(r => {
    if (String(r.transaction_type).trim() !== '注文') return;
    const d = apDate_(r.date);
    if (!(d > since90)) return;
    const a = String(r.asin).trim();
    if (asin && a !== asin) return;
    const qty = apNum_(r.qty), sales = apNum_(r.sales_taxin);
    if (qty <= 0 || sales <= 0) return;
    const x = (feeAgg[a] = feeAgg[a] || { fees: [], fbas: [] });
    x.fees.push(Math.abs(apNum_(r.fee)) / sales);
    x.fbas.push(Math.abs(apNum_(r.fba_fee)) / qty);
  });

  const rows = Object.values(byAsin).filter(r => r.cur).map(r => {
    const a = r.asin, av = ad[a] || {}, iv = inv[a] || {}, p = pl[a] || {}, f = feeAgg[a];
    const fee_rate = f ? apMedian_(f.fees) : null;
    const fba_unit = f ? apMedian_(f.fbas) : null;
    const unit_margin = (p.price && p.landed_cost && fee_rate != null && fba_unit != null)
      ? Math.round(p.price - p.landed_cost - p.price * fee_rate - fba_unit) : null;
    return {
      asin: a, title: r.title, cur: r.cur, prev: r.prev || null,
      ad_30d: av.imp ? {
        impressions: av.imp, clicks: av.clicks, spend: Math.round(av.spend),
        sales: Math.round(av.sales), units: av.units,
        acos: av.sales > 0 ? +(av.spend / av.sales).toFixed(3) : null,
        ctr: av.imp > 0 ? +(av.clicks / av.imp).toFixed(4) : null
      } : null,
      stock: iv._d ? {
        available: iv.available, inbound: iv.inbound,
        days_remain: iv.days_remain, alert: iv.alert
      } : null,
      price: p.price || null, landed_cost: p.landed_cost || null,
      fee_rate_taxin: fee_rate != null ? +fee_rate.toFixed(3) : null,
      fba_fee_unit: fba_unit != null ? Math.round(fba_unit) : null,
      unit_margin,
      ad_dependency: (av.units && r.cur.units > 0) ? +(av.units / r.cur.units).toFixed(2) : null
    };
  }).sort((x, y) => (y.cur.sales || 0) - (x.cur.sales || 0));

  const cvrBaseline = apMedian_(rows.map(r => r.cur.cvr).filter(v => v > 0));
  return {
    generated_at: new Date().toISOString(),
    period_current: curKey, period_previous: prevKey,
    cvr_baseline_median: cvrBaseline,
    asin_count: rows.length,
    audit_table: rows
  };
}

function doGetAuditPack_(e) {
  const pack = buildAuditPack(String(e.parameter.asin || '').trim());
  return ContentService.createTextOutput(JSON.stringify(pack, null, 1))
    .setMimeType(ContentService.MimeType.JSON);
}

function testAuditPack() {
  const p = buildAuditPack('');
  Logger.log('ASIN数: ' + p.asin_count + ' / CVR基準: ' + p.cvr_baseline_median);
  Logger.log(JSON.stringify(p.audit_table.slice(0, 3), null, 2));
}

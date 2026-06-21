// ============================================================
// HAKSAI Central 追加機能：広告・ビジネスレポート取込（A案）
//   - ad_product_daily      … 日次 × ASIN に集約して保存
//   - business_report_period … 期間 × 子ASIN（ビジネスレポートは日付を持たないため期間は手入力）
//
// ▼ 設置方法
//   1) このファイルの全内容を「コード.gs」の末尾に貼り付ける
//   2) doPost の中（return jsonResponse({ status:'error', message:'Unknown action...' }) の直前）に
//      下記2行を追加：
//        if (action === 'syncAdProductReport') {
//          return jsonResponse({ status:'ok', data: syncAdProductReport(body.rows||[], body.rawBase64||'', body.filename||'') });
//        }
//        if (action === 'syncBusinessReport') {
//          return jsonResponse({ status:'ok', data: syncBusinessReport(body.rows||[], body.dateFrom||'', body.dateTo||'', body.rawBase64||'', body.filename||'') });
//        }
//   3) doGet の中（最後の return jsonResponse({...'is running'}) の直前）に下記1行を追加：
//        if (action === 'getImportStatus') {
//          return jsonResponse({ status:'ok', data: getImportStatus() });
//        }
// ============================================================

const SHEET_AD_PRODUCT_DAILY = 'ad_product_daily';
const SHEET_BUSINESS_REPORT  = 'business_report_period';

// 加算可能な素の指標だけ保存する。ACOS/ROAS/CVR/CPC/CTR は読み出し時に再計算する。
const REQUIRED_HEADERS_AD_PRODUCT_DAILY = [
  'id', 'date', 'period_key', 'asin', 'sku',
  'impressions', 'clicks', 'spend', 'sales', 'orders', 'units',
  'imported_at'
];

const REQUIRED_HEADERS_BUSINESS_REPORT = [
  'id', 'date_from', 'date_to', 'period_key', 'parent_asin', 'asin', 'title',
  'sessions', 'page_views', 'unit_session_rate', 'ordered_units', 'ordered_sales',
  'sessions_b2b', 'page_views_b2b', 'unit_session_rate_b2b', 'ordered_units_b2b', 'ordered_sales_b2b',
  'imported_at'
];

// ------------------------------------------------------------
// レポート用シートの置き場所
//   スクリプトプロパティ REPORT_SPREADSHEET_ID があればそちら、
//   無ければメインの SPREADSHEET_ID にフォールバック。
//   → 行数が増えてメインの doGet が重くなったら、別スプレッドシートを
//     作って ID をプロパティに入れ、再取込するだけで分離できる（Keepaと同じ逃がし方）。
// ------------------------------------------------------------
function getReportSpreadsheet_() {
  const id = PROPS.getProperty('REPORT_SPREADSHEET_ID') || SPREADSHEET_ID;
  if (!id) throw new Error('SPREADSHEET_ID が未設定です。');
  return SpreadsheetApp.openById(id);
}

function getReportSheet_(sheetName, requiredHeaders) {
  const ss = getReportSpreadsheet_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
  }
  return sheet;
}

// ------------------------------------------------------------
// 汎用UPSERT：keyFields が一致する既存行を入れ替えて一括書き戻し
//   読み1回・クリア1回・書き1回（setValues）で済むので重くなりにくい
// ------------------------------------------------------------
function upsertReportRows_(sheetName, requiredHeaders, incomingObjs, keyFields, stringFields) {
  const sheet = getReportSheet_(sheetName, requiredHeaders);
  const headers = getHeaders_(sheet, requiredHeaders);

  // 不足列を補完
  requiredHeaders.forEach(h => {
    if (headers.indexOf(h) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
    }
  });

  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const lastRow = sheet.getLastRow();
  const existingRaw = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];

  const keyOfRow = (arr) => keyFields.map(f => String(arr[colIdx[f]] != null ? arr[colIdx[f]] : '').trim()).join('__');
  const keyOfObj = (o)   => keyFields.map(f => String(o[f] != null ? o[f] : '').trim()).join('__');

  // 空行（先頭キー列が空）は捨てる
  const firstKeyIdx = colIdx[keyFields[0]];
  const existing = existingRaw.filter(r => String(r[firstKeyIdx] != null ? r[firstKeyIdx] : '').trim() !== '');

  const incomingKeys = new Set(incomingObjs.map(keyOfObj));
  const kept = existing.filter(r => !incomingKeys.has(keyOfRow(r)));
  const replacedCount = existing.length - kept.length;

  const now = new Date().toISOString();
  const incomingArrays = incomingObjs.map(o => {
    if (!o.id) o.id = Utilities.getUuid();
    o.imported_at = now;
    return headers.map(h => (o[h] !== undefined && o[h] !== null) ? o[h] : '');
  });

  const finalRows = kept.concat(incomingArrays);

  // 既存本文をクリア（書式は残る）
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();

  if (finalRows.length) {
    // 日付・period_key などは @STRING@ に固定（Sheetsの日付化を防ぐ）
    (stringFields || []).forEach(f => {
      const ci = colIdx[f];
      if (ci !== undefined) sheet.getRange(2, ci + 1, finalRows.length, 1).setNumberFormat('@STRING@');
    });
    sheet.getRange(2, 1, finalRows.length, headers.length).setValues(finalRows);
  }

  return {
    total:    finalRows.length,
    appended: incomingArrays.length,
    replaced: replacedCount,
    added:    incomingArrays.length - replacedCount
  };
}

// ------------------------------------------------------------
// 生ファイルを Drive に退避（A案で集約しても元データを失わないため）
// ------------------------------------------------------------
function getOrCreateSubfolder_(parentId, name) {
  const parent = DriveApp.getFolderById(parentId);
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function archiveRawToDrive_(rawBase64, filename, mimeType) {
  if (!rawBase64 || !DRIVE_FOLDER_ID) return null;
  try {
    const folder = getOrCreateSubfolder_(DRIVE_FOLDER_ID, 'raw_reports');
    const bytes = Utilities.base64Decode(rawBase64);
    const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
    const safe = String(filename || 'report').replace(/[\/\\]/g, '_');
    const blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', stamp + '__' + safe);
    return folder.createFile(blob).getId();
  } catch (e) {
    Logger.log('archiveRawToDrive_ failed: ' + e.message);
    return null;
  }
}

// ------------------------------------------------------------
// 広告対象商品レポート取込（フロントで 日次×ASIN に集約済みの rows を受け取る）
// ------------------------------------------------------------
function syncAdProductReport(rows, rawBase64, filename) {
  const driveId = archiveRawToDrive_(
    rawBase64, filename,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  const objs = (rows || []).map(r => {
    const date = String(r.date || '').trim();
    return {
      date:        date,
      period_key:  date.slice(0, 7),
      asin:        String(r.asin || '').trim(),
      sku:         String(r.sku || '').trim(),
      impressions: Number(r.impressions) || 0,
      clicks:      Number(r.clicks) || 0,
      spend:       Number(r.spend) || 0,
      sales:       Number(r.sales) || 0,
      orders:      Number(r.orders) || 0,
      units:       Number(r.units) || 0
    };
  }).filter(o => o.date && o.asin);

  const res = upsertReportRows_(
    SHEET_AD_PRODUCT_DAILY, REQUIRED_HEADERS_AD_PRODUCT_DAILY,
    objs, ['date', 'asin'], ['date', 'period_key']
  );

  const periodSet = {};
  objs.forEach(o => { periodSet[o.period_key] = true; });
  return Object.assign(res, { driveFileId: driveId, periods: Object.keys(periodSet).sort() });
}

// ------------------------------------------------------------
// ビジネスレポート取込（日付を持たないため dateFrom/dateTo は必須・手入力）
// ------------------------------------------------------------
function syncBusinessReport(rows, dateFrom, dateTo, rawBase64, filename) {
  if (!dateFrom || !dateTo) {
    throw new Error('dateFrom / dateTo が必要です（ビジネスレポートには対象期間が含まれないため）。');
  }
  const driveId = archiveRawToDrive_(rawBase64, filename, 'text/csv');
  const periodKey = String(dateFrom).slice(0, 7);

  const objs = (rows || []).map(r => ({
    date_from:             String(dateFrom),
    date_to:               String(dateTo),
    period_key:            periodKey,
    parent_asin:           String(r.parent_asin || '').trim(),
    asin:                  String(r.asin || '').trim(),
    title:                 String(r.title || '').trim(),
    sessions:              Number(r.sessions) || 0,
    page_views:            Number(r.page_views) || 0,
    unit_session_rate:     Number(r.unit_session_rate) || 0,
    ordered_units:         Number(r.ordered_units) || 0,
    ordered_sales:         Number(r.ordered_sales) || 0,
    sessions_b2b:          Number(r.sessions_b2b) || 0,
    page_views_b2b:        Number(r.page_views_b2b) || 0,
    unit_session_rate_b2b: Number(r.unit_session_rate_b2b) || 0,
    ordered_units_b2b:     Number(r.ordered_units_b2b) || 0,
    ordered_sales_b2b:     Number(r.ordered_sales_b2b) || 0
  })).filter(o => o.asin);

  // 重複キーは period_key + asin。
  //   → 同じ月を何度取り込み直しても「1ヶ月＝1商品1行」に収束し、最後の取込が勝つ。
  //     入力期間が違っても同月なら別行を作らないので、月次合算での二重カウントを原理的に防ぐ。
  const res = upsertReportRows_(
    SHEET_BUSINESS_REPORT, REQUIRED_HEADERS_BUSINESS_REPORT,
    objs, ['period_key', 'asin'], ['date_from', 'date_to', 'period_key']
  );

  return Object.assign(res, { driveFileId: driveId, periodKey: periodKey, dateFrom: String(dateFrom), dateTo: String(dateTo) });
}

// ------------------------------------------------------------
// 取込状況（MVP1の確認用：行数・期間・日付範囲）
// ------------------------------------------------------------
function getImportStatus() {
  function summarizeAd() {
    const sheet = getReportSheet_(SHEET_AD_PRODUCT_DAILY, REQUIRED_HEADERS_AD_PRODUCT_DAILY);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { rows: 0, periods: [], minDate: '', maxDate: '' };
    const hdr = data[0];
    const pkIdx = hdr.indexOf('period_key');
    const dIdx  = hdr.indexOf('date');
    const periods = {};
    let minD = '', maxD = '', count = 0;
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      count++;
      const pk = String(data[i][pkIdx] || '');
      if (pk) periods[pk] = true;
      const dv = String(data[i][dIdx] || '');
      if (dv) {
        if (!minD || dv < minD) minD = dv;
        if (!maxD || dv > maxD) maxD = dv;
      }
    }
    return { rows: count, periods: Object.keys(periods).sort(), minDate: minD, maxDate: maxD };
  }

  // ビジネスは period_key ごとに「実際に格納されている date_from〜date_to」を出す。
  //   → 「2026-05 のつもりが中身は 05-14〜05-31 だけ」のような部分月を目で発見できる。
  function summarizeBusiness() {
    const sheet = getReportSheet_(SHEET_BUSINESS_REPORT, REQUIRED_HEADERS_BUSINESS_REPORT);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { rows: 0, periods: [], ranges: [] };
    const hdr = data[0];
    const pkIdx = hdr.indexOf('period_key');
    const fIdx  = hdr.indexOf('date_from');
    const tIdx  = hdr.indexOf('date_to');
    const map = {};
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      count++;
      const pk = String(data[i][pkIdx] || '');
      if (!pk) continue;
      const f = String(data[i][fIdx] || '');
      const t = String(data[i][tIdx] || '');
      if (!map[pk]) map[pk] = { period_key: pk, from: f, to: t, count: 0 };
      const m = map[pk];
      m.count++;
      if (f && (!m.from || f < m.from)) m.from = f;
      if (t && (!m.to   || t > m.to))   m.to = t;
    }
    const ranges = Object.keys(map).sort().map(k => map[k]);
    return { rows: count, periods: ranges.map(r => r.period_key), ranges: ranges };
  }

  return { ad: summarizeAd(), business: summarizeBusiness() };
}

// ============================================================
// HAKSAI Central MVP2：商品別行に「広告・流入」を合流（月次そろえ）
//
// ▼ 設置方法
//   1) このファイルの全内容を「コード.gs」の末尾（ad_business_import.gs の後ろ）に貼り付ける
//   2) getPeriodSummary の中、未紐付きを products.push した直後・
//      「// ── 期間固定費（件数付き・costTypeで集約） ──」の直前に、次の1行を追加：
//
//        attachAdBusinessToProducts_(products, periodKey);
//
//   ※ これだけ。既存の集計・サマリー・営業利益の計算には触れない。
//   ※ 期間の広告費総額は既に period_costs('ad') で営業利益から控除済みのため、
//     ここでは商品行への「按分表示」だけを足す（二重計上しない）。
// ============================================================

// 指定 period の広告・流入を ASIN 別に集計して返す
function getAdBusinessByAsin_(periodKey) {
  const adByAsin = {};
  const bizByAsin = {};

  // ── ad_product_daily（日次×ASIN）を period でフィルタして ASIN 合算 ──
  try {
    const adSheet = getReportSheet_(SHEET_AD_PRODUCT_DAILY, REQUIRED_HEADERS_AD_PRODUCT_DAILY);
    const ad = adSheet.getDataRange().getValues();
    if (ad.length > 1) {
      const h = ad[0];
      const pk = h.indexOf('period_key'), ai = h.indexOf('asin');
      const im = h.indexOf('impressions'), cl = h.indexOf('clicks'),
            sp = h.indexOf('spend'), sa = h.indexOf('sales'),
            or = h.indexOf('orders'), un = h.indexOf('units');
      for (let i = 1; i < ad.length; i++) {
        if (String(ad[i][pk]) !== periodKey) continue;
        const asin = String(ad[i][ai] || '').trim();
        if (!asin) continue;
        if (!adByAsin[asin]) adByAsin[asin] = { impressions:0, clicks:0, spend:0, sales:0, orders:0, units:0 };
        const a = adByAsin[asin];
        a.impressions += Number(ad[i][im]) || 0;
        a.clicks      += Number(ad[i][cl]) || 0;
        a.spend       += Number(ad[i][sp]) || 0;
        a.sales       += Number(ad[i][sa]) || 0;
        a.orders      += Number(ad[i][or]) || 0;
        a.units       += Number(ad[i][un]) || 0;
      }
    }
  } catch (e) { Logger.log('getAdBusinessByAsin_ ad read failed: ' + e.message); }

  // ── business_report_period（period_key+asin で1行に収束済み） ──
  try {
    const bizSheet = getReportSheet_(SHEET_BUSINESS_REPORT, REQUIRED_HEADERS_BUSINESS_REPORT);
    const bz = bizSheet.getDataRange().getValues();
    if (bz.length > 1) {
      const h = bz[0];
      const pk = h.indexOf('period_key'), ai = h.indexOf('asin');
      const se = h.indexOf('sessions'), pv = h.indexOf('page_views'),
            ur = h.indexOf('unit_session_rate'), ou = h.indexOf('ordered_units'),
            os = h.indexOf('ordered_sales'),
            seB = h.indexOf('sessions_b2b'), urB = h.indexOf('unit_session_rate_b2b');
      for (let i = 1; i < bz.length; i++) {
        if (String(bz[i][pk]) !== periodKey) continue;
        const asin = String(bz[i][ai] || '').trim();
        if (!asin) continue;
        bizByAsin[asin] = {
          sessions:              Number(bz[i][se]) || 0,
          page_views:            Number(bz[i][pv]) || 0,
          unit_session_rate:     Number(bz[i][ur]) || 0,   // 0〜1
          ordered_units:         Number(bz[i][ou]) || 0,
          ordered_sales:         Number(bz[i][os]) || 0,
          sessions_b2b:          seB >= 0 ? Number(bz[i][seB]) || 0 : 0,
          unit_session_rate_b2b: urB >= 0 ? Number(bz[i][urB]) || 0 : 0
        };
      }
    }
  } catch (e) { Logger.log('getAdBusinessByAsin_ biz read failed: ' + e.message); }

  return { adByAsin: adByAsin, bizByAsin: bizByAsin };
}

// products 各行（ASIN）に広告・流入フィールドを付与（破壊的）
//   ACOS / ROAS / CVR / CPC は保存値ではなく、合算後にここで再計算する
function attachAdBusinessToProducts_(products, periodKey) {
  const maps = getAdBusinessByAsin_(periodKey);
  const adByAsin = maps.adByAsin, bizByAsin = maps.bizByAsin;
  const r2 = function (n) { return Math.round(n); };
  const ratio = function (num, den) { return den > 0 ? num / den : null; };

  products.forEach(function (p) {
    const asin = p.asin;
    const ad = (asin && adByAsin[asin]) ? adByAsin[asin] : null;
    const bz = (asin && bizByAsin[asin]) ? bizByAsin[asin] : null;
    const gpKnown = (p.gross_profit !== null && p.gross_profit !== undefined);

    // ── 広告 ──
    if (ad) {
      p.ad_impressions = r2(ad.impressions);
      p.ad_clicks      = r2(ad.clicks);
      p.ad_spend       = r2(ad.spend);
      p.ad_sales       = r2(ad.sales);
      p.ad_orders      = r2(ad.orders);
      p.acos           = ratio(ad.spend, ad.sales);    // 0〜1 or null
      p.roas           = ratio(ad.sales, ad.spend);    // 倍 or null
      p.ad_cvr         = ratio(ad.orders, ad.clicks);  // 0〜1 or null
      p.cpc            = ad.clicks > 0 ? r2(ad.spend / ad.clicks) : null;
      // 広告費控除後の利益（粗利が分かる商品のみ）。粗利と広告費はどちらも円なので減算可。
      p.gross_profit_after_ad = gpKnown ? r2(p.gross_profit - ad.spend) : null;
    } else {
      p.ad_impressions = 0; p.ad_clicks = 0; p.ad_spend = 0; p.ad_sales = 0; p.ad_orders = 0;
      p.acos = null; p.roas = null; p.ad_cvr = null; p.cpc = null;
      p.gross_profit_after_ad = gpKnown ? p.gross_profit : null;
    }

    // ── 流入（ビジネスレポート） ──
    if (bz) {
      p.sessions       = r2(bz.sessions);
      p.page_views     = r2(bz.page_views);
      p.cvr            = bz.unit_session_rate;       // 0〜1（ユニットセッション率）
      p.session_orders = r2(bz.ordered_units);
      p.session_sales  = r2(bz.ordered_sales);
      p.cvr_b2b        = bz.unit_session_rate_b2b;
      p.has_business   = true;
    } else {
      p.sessions = null; p.page_views = null; p.cvr = null;
      p.session_orders = null; p.session_sales = null; p.cvr_b2b = null;
      p.has_business = false;
    }
  });
}

// ============================================
// 在庫スナップショット（時系列・追記専用）
//   product_lifecycle への上書き保存とは独立。
//   最新状態は従来どおり残し、履歴だけをレポート用スプレッドシートに
//   dedup(snapshot_date + asin) で蓄積する。
// ============================================
const SHEET_INVENTORY_SNAPSHOT = 'inventory_snapshot';
const REQUIRED_HEADERS_INVENTORY_SNAPSHOT = [
  'id', 'snapshot_date', 'asin',
  'available', 'inbound', 'daily_t7', 'days_remain', 'alert',
  'synced_at', 'imported_at'
];

function appendInventorySnapshot_(snapRows) {
  if (!snapRows || !snapRows.length) {
    return { total: 0, appended: 0, replaced: 0, added: 0 };
  }
  return upsertReportRows_(
    SHEET_INVENTORY_SNAPSHOT, REQUIRED_HEADERS_INVENTORY_SNAPSHOT,
    snapRows, ['snapshot_date', 'asin'], ['snapshot_date', 'synced_at']
  );
}
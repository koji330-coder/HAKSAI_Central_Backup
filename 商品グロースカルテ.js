/** 商品グロースカルテ: 日次実績、改善アクション、自社Keepaスナップショット。 */

const PG_ACTION_SHEET = 'product_actions';
const PG_ACTION_HEADERS = [
  'action_id','product_id','asin','sku','action_at','action_type','title','hypothesis',
  'action_detail','expected_metric','expected_direction','evaluation_date','status','result',
  'tags_json','related_url','attachments_json','show_on_chart','action_scope','target_asins_json',
  'variation_group_key','created_at','updated_at'
];
const PG_AD_ACTION_CONTEXT_SHEET = 'advertising_action_contexts';
const PG_AD_ACTION_CONTEXT_HEADERS = [
  'context_id','action_id','asin','analysis_session_id','candidate_ids_json',
  'execution_detail_mode','before_snapshot_file_id','after_snapshot_file_id',
  'evaluation_status','comparison_json','created_at','updated_at'
];
const PG_SNAPSHOT_HEADERS = [
  'snapshot_id','page_project_id','own_asin','captured_at','checked_at','source','content_hash',
  'title','bullets_json','description','image_urls_json','aplus_json','price','rating','review_count',
  'brand','manufacturer','monthly_sold','category_tree_json','variations_json','videos_json',
  'dimensions_json','fees_json','market_json','keepa_tokens_left','raw_file_id'
];
const PG_CONSULT_SHEET = 'product_consultations';
const PG_CONSULT_HEADERS = ['session_id','asin','title','status','summary','important_conclusion','drive_file_id','message_count','created_at','updated_at'];
const PG_CONTEXT_NOTE_SHEET = 'product_context_notes';
const PG_CONTEXT_NOTE_HEADERS = ['note_id','asin','note_type','content','status','source_session_id','created_at','updated_at','resolved_at'];
const PG_KEEPA_TRIAL_SHEET = 'keepa_history_trial_preview';
const PG_KEEPA_TRIAL_HEADERS = [
  'asin','fetched_at','request_kind','series_key','point_count','first_at','last_at',
  'min_value','max_value','missing_count','payload_bytes','duration_ms','tokens_before',
  'tokens_consumed','tokens_left','raw_file_id','verdict','note'
];
const PG_MARKET_HISTORY_SHEET = 'product_market_history_index';
const PG_MARKET_HISTORY_HEADERS = [
  'history_id','asin','from_date','to_date','checked_at','source','request_kind','series_json',
  'point_count','raw_file_id','normalized_file_id','payload_bytes','tokens_consumed','tokens_left',
  'status','error'
];
const PG_KEEPA_START_MINUTE = 21564000;

function pgDateKey_(value) {
  const d = parseDate_(value);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function pgAsin_(value) {
  const asin = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('正しいASINを指定してください。');
  return asin;
}

function pgEnsureSheet_(name, requiredHeaders) {
  ensureHeaders_(name, requiredHeaders);
  const sheet = getSheetByName_(name, requiredHeaders);
  return { sheet: sheet, headers: getHeaders_(sheet, requiredHeaders) };
}

function pgParseJson_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return value ? JSON.parse(value) : fallback; } catch (e) { return fallback; }
}

function pgHydrateAdvertisingActionContext_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  obj.candidate_ids = pgParseJson_(obj.candidate_ids_json, []);
  obj.selected_candidate_count = obj.candidate_ids.length;
  obj.comparison = pgParseJson_(obj.comparison_json, null);
  delete obj.candidate_ids_json;
  delete obj.comparison_json;
  return obj;
}

function pgAdvertisingActionContextMap_() {
  const ref = pgEnsureSheet_(PG_AD_ACTION_CONTEXT_SHEET, PG_AD_ACTION_CONTEXT_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  const out = {};
  if (values.length < 2) return out;
  values.slice(1).forEach(function(row) {
    const context = pgHydrateAdvertisingActionContext_(ref.headers, row);
    if (context.action_id) out[String(context.action_id)] = context;
  });
  return out;
}

function pgAttachAdvertisingContexts_(actions) {
  const contexts = pgAdvertisingActionContextMap_();
  return actions.map(function(action) {
    if (contexts[action.action_id]) action.advertising_context = contexts[action.action_id];
    return action;
  });
}

function pgNormalizeActionAsins_(primaryAsin, values) {
  const primary = String(primaryAsin || '').trim().toUpperCase();
  const input = Array.isArray(values) ? values : [];
  const out = [];
  [primary].concat(input).forEach(function(value) {
    const asin = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || out.indexOf(asin) >= 0) return;
    out.push(asin);
  });
  return out.slice(0, 50);
}

function pgHydrateProductAction_(headers, row, viewedAsin) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  obj.tags = pgParseJson_(obj.tags_json, []);
  obj.attachments = pgParseJson_(obj.attachments_json, []);
  obj.target_asins = pgNormalizeActionAsins_(obj.asin, pgParseJson_(obj.target_asins_json, []));
  obj.action_scope = obj.target_asins.length > 1 ? String(obj.action_scope || 'selected_variations') : 'single';
  obj.variation_group_key = String(obj.variation_group_key || '').trim().toUpperCase();
  obj.is_shared = obj.target_asins.length > 1;
  obj.shared_product_count = obj.target_asins.length;
  obj.show_on_chart = normalizeBool_(obj.show_on_chart);
  obj.action_at = pgDateKey_(obj.action_at);
  obj.evaluation_date = pgDateKey_(obj.evaluation_date);
  if (viewedAsin) obj.viewed_asin = String(viewedAsin).trim().toUpperCase();
  delete obj.tags_json;
  delete obj.attachments_json;
  delete obj.target_asins_json;
  return obj;
}

function pgActionAppliesToAsin_(action, asin) {
  const target = String(asin || '').trim().toUpperCase();
  return Array.isArray(action.target_asins) && action.target_asins.indexOf(target) >= 0;
}

function pgReadSkuRows_() {
  const sheet = getSheetByName_(SHEET_SKU_MASTER, REQUIRED_HEADERS_SKU_MASTER);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const h = values[0], ix = function(name) { return h.indexOf(name); };
  return values.slice(1).map(function(row) {
    return {
      sku: String(row[ix('sku')] || '').trim(),
      asin: String(row[ix('asin')] || '').trim().toUpperCase(),
      title: String(row[ix('product_name')] || '').trim()
    };
  }).filter(function(x) { return x.sku || x.asin; });
}

function getProductCatalog_() {
  const items = {};
  const ensure = function(asin) {
    asin = String(asin || '').trim().toUpperCase();
    if (!asin) return null;
    if (!items[asin]) items[asin] = { asin: asin, parent_asin: '', nickname: '', title: asin, emoji: '📦', skus: [], status: '', is_deleted: false, first_sale_date: '', last_sale_date: '', total_units: 0 };
    return items[asin];
  };

  const lifecycle = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lv = lifecycle.getDataRange().getValues();
  if (lv.length > 1) {
    const h = lv[0], ix = function(name) { return h.indexOf(name); };
    lv.slice(1).forEach(function(row) {
      const item = ensure(row[ix('asin')]);
      if (!item) return;
      item.product_id = String(row[ix('id')] || '').trim();
      item.parent_asin = ix('parent_asin') >= 0 ? String(row[ix('parent_asin')] || '').trim().toUpperCase() : '';
      item.nickname = ix('nickname') >= 0 ? String(row[ix('nickname')] || '').trim() : '';
      item.title = String(row[ix('title')] || '').trim() || item.title;
      item.emoji = String(row[ix('emoji')] || '').trim() || item.emoji;
      item.status = ix('status') >= 0 ? String(row[ix('status')] || '').trim() : '';
      item.is_deleted = ix('is_deleted') >= 0 ? normalizeBool_(row[ix('is_deleted')]) : false;
    });
  }

  const skuToAsin = {};
  pgReadSkuRows_().forEach(function(row) {
    if (row.sku && row.asin) skuToAsin[row.sku] = row.asin;
    const item = ensure(row.asin);
    if (!item) return;
    if (row.title && item.title === item.asin) item.title = row.title;
    if (row.sku && item.skus.indexOf(row.sku) < 0) item.skus.push(row.sku);
  });

  readTransactionRows_().forEach(function(tx) {
    const asin = tx.asin || skuToAsin[tx.sku] || '';
    const item = ensure(asin);
    if (!item) return;
    if (tx.sku && item.skus.indexOf(tx.sku) < 0) item.skus.push(tx.sku);
    const date = pgDateKey_(tx.date);
    if (date && (!item.first_sale_date || date < item.first_sale_date)) item.first_sale_date = date;
    if (date && (!item.last_sale_date || date > item.last_sale_date)) item.last_sale_date = date;
    item.total_units += tx.type === '返金' ? -Math.abs(tx.qty) : tx.qty;
  });

  return Object.keys(items).map(function(key) {
    const item = items[key];
    const endedWords = /終売|廃版|撤退|停止|終了|closed|retired/i;
    item.is_active = !item.is_deleted && !endedWords.test(item.status || '');
    return item;
  }).filter(function(item) {
    // product_lifecycle にはリサーチ中の競合ASINも入るため、
    // 自社SKUまたは実販売履歴で裏付けられる商品だけをカルテ対象にする。
    return item.skus.length > 0 || !!item.first_sale_date;
  }).sort(function(a, b) {
    return String(b.last_sale_date || '').localeCompare(String(a.last_sale_date || '')) || a.title.localeCompare(b.title, 'ja');
  });
}

function pgReadAdDaily_(asin, fromDate, toDate) {
  const sheet = getReportSheet_(SHEET_AD_PRODUCT_DAILY, REQUIRED_HEADERS_AD_PRODUCT_DAILY);
  const values = sheet.getDataRange().getValues();
  const result = {};
  if (values.length < 2) return result;
  const h = values[0], ix = function(name) { return h.indexOf(name); };
  values.slice(1).forEach(function(row) {
    if (String(row[ix('asin')] || '').trim().toUpperCase() !== asin) return;
    const date = pgDateKey_(row[ix('date')]);
    if (!date || date < fromDate || date > toDate) return;
    if (!result[date]) result[date] = { spend: 0, sales: 0, impressions: 0, clicks: 0, orders: 0, units: 0 };
    ['spend','sales','impressions','clicks','orders','units'].forEach(function(k) { result[date][k] += Number(row[ix(k)]) || 0; });
  });
  return result;
}

function getProductGrowthData_(asinValue, daysValue, endDateValue) {
  const asin = pgAsin_(asinValue);
  const days = Math.max(7, Math.min(365, Number(daysValue) || 30));
  const end = parseDate_(endDateValue) || new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  const fromDate = pgDateKey_(start), toDate = pgDateKey_(end);

  const skuToAsin = buildSkuToAsinMap_();
  const meta = readLifecycleMeta_();
  const reorder = readReorderRows_();
  const manual = readManualCostFallbackMap_();
  const txRows = readTransactionRows_().map(function(tx) {
    if (!tx.asin) tx.asin = skuToAsin[tx.sku] || '';
    return tx;
  });
  const productTx = txRows.filter(function(tx) { return tx.asin === asin; });
  const skus = Array.from(new Set(productTx.map(function(tx) { return tx.sku; }).filter(Boolean)));
  const costById = {};
  skus.forEach(function(sku) {
    const ledger = buildCogsLedgerBySku_(sku, reorder, txRows, {
      productId: meta[asin] ? meta[asin].productId : asin,
      fallbackCost: meta[asin] ? meta[asin].currentLandedCost : null,
      manualFallback: manual[sku] || null
    });
    Object.keys(ledger.perTxCost).forEach(function(id) { costById[id] = ledger.perTxCost[id]; });
  });

  const daily = {};
  for (let d = new Date(start.getTime()); d <= end; d.setDate(d.getDate() + 1)) {
    const key = pgDateKey_(d);
    daily[key] = { date: key, sales: 0, units: 0, net: 0, cogs: 0, gross_profit: 0, missing_cost_units: 0, ad_spend: 0, ad_sales: 0, ad_impressions: 0, ad_clicks: 0, ad_orders: 0, ad_units: 0 };
  }
  productTx.forEach(function(tx) {
    const date = pgDateKey_(tx.date);
    if (!daily[date]) return;
    const sign = tx.type === '返金' ? -1 : 1;
    const c = costById[tx.id];
    daily[date].sales += tx.type === '返金' ? 0 : tx.salesTaxin;
    daily[date].units += sign * Math.abs(tx.qty);
    daily[date].net += tx.net;
    if (c && c.amount !== null) daily[date].cogs += sign * Math.abs(c.amount);
    else daily[date].missing_cost_units += Math.abs(tx.qty);
  });
  const ad = pgReadAdDaily_(asin, fromDate, toDate);
  Object.keys(daily).forEach(function(date) {
    daily[date].gross_profit = daily[date].net - daily[date].cogs;
    if (ad[date]) {
      daily[date].ad_spend = ad[date].spend;
      daily[date].ad_sales = ad[date].sales;
      daily[date].ad_impressions = ad[date].impressions;
      daily[date].ad_clicks = ad[date].clicks;
      daily[date].ad_orders = ad[date].orders;
      daily[date].ad_units = ad[date].units;
    }
  });
  const points = Object.keys(daily).sort().map(function(k) { return daily[k]; });
  const totals = points.reduce(function(a, p) {
    ['sales','units','net','cogs','gross_profit','missing_cost_units','ad_spend','ad_sales','ad_impressions','ad_clicks','ad_orders','ad_units'].forEach(function(k) { a[k] += p[k]; });
    return a;
  }, { sales:0,units:0,net:0,cogs:0,gross_profit:0,missing_cost_units:0,ad_spend:0,ad_sales:0,ad_impressions:0,ad_clicks:0,ad_orders:0,ad_units:0 });
  return { asin: asin, title: meta[asin] ? meta[asin].title : asin, from_date: fromDate, to_date: toDate, days: days, skus: skus, points: points, totals: totals };
}

function getProductActions_(asinValue, includeArchived) {
  const asin = pgAsin_(asinValue);
  const ref = pgEnsureSheet_(PG_ACTION_SHEET, PG_ACTION_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const actions = values.slice(1).map(function(row) {
    return pgHydrateProductAction_(ref.headers, row, asin);
  }).filter(function(obj) {
    return pgActionAppliesToAsin_(obj, asin) && (includeArchived || obj.status !== 'archived');
  });
  return pgAttachAdvertisingContexts_(actions)
    .sort(function(a, b) { return String(b.action_at).localeCompare(String(a.action_at)); });
}

// スマホ秘書用。ASINを限定せず、product_actions を正本のまま横断参照する。
function getAllProductActions_(includeArchived) {
  const ref = pgEnsureSheet_(PG_ACTION_SHEET, PG_ACTION_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const actions = values.slice(1).map(function(row) { return pgHydrateProductAction_(ref.headers, row, ''); }).filter(function(obj) {
    return obj.action_id && (includeArchived || obj.status !== 'archived');
  });
  return pgAttachAdvertisingContexts_(actions).sort(function(a, b) {
    return String(b.action_at).localeCompare(String(a.action_at)) || String(b.updated_at).localeCompare(String(a.updated_at));
  });
}

// スマホから変更できる範囲を評価状態・結果・次回評価日に限定する。
function updateProductActionReview_(input) {
  input = input || {};
  const id = String(input.action_id || '').trim();
  const status = String(input.status || '').trim();
  const allowed = ['実施済み', '評価待ち', '効果あり', '効果なし'];
  if (!id) throw new Error('action_id が必要です。');
  if (allowed.indexOf(status) < 0) throw new Error('更新できない評価状態です。');
  const evaluationDate = pgDateKey_(input.evaluation_date);
  if (status === '評価待ち' && !evaluationDate) throw new Error('次回評価日を指定してください。');
  const result = String(input.result || '').trim().slice(0, 2000);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ref = pgEnsureSheet_(PG_ACTION_SHEET, PG_ACTION_HEADERS);
    const values = ref.sheet.getDataRange().getValues();
    const col = {};
    ref.headers.forEach(function(h, i) { col[h] = i; });
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][col.action_id] || '').trim() !== id) continue;
      if (String(values[r][col.status] || '') === 'archived') throw new Error('アーカイブ済みアクションは更新できません。');
      ref.sheet.getRange(r + 1, col.status + 1).setValue(status);
      ref.sheet.getRange(r + 1, col.result + 1).setValue(result);
      if (evaluationDate) ref.sheet.getRange(r + 1, col.evaluation_date + 1).setValue(evaluationDate).setNumberFormat('@STRING@');
      ref.sheet.getRange(r + 1, col.updated_at + 1).setValue(new Date().toISOString());
      return { action_id:id, status:status, result:result, evaluation_date:evaluationDate || pgDateKey_(values[r][col.evaluation_date]) };
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('アクションが見つかりません。');
}

function saveProductAction_(input, images) {
  input = input || {};
  images = Array.isArray(images) ? images.slice(0, 10) : [];
  const asin = pgAsin_(input.asin);
  const actionAt = pgDateKey_(input.action_at);
  if (!actionAt) throw new Error('実施日を入力してください。');
  const title = String(input.title || '').trim();
  if (!title) throw new Error('アクションのタイトルを入力してください。');
  const ref = pgEnsureSheet_(PG_ACTION_SHEET, PG_ACTION_HEADERS);
  const now = new Date().toISOString();
  const actionId = String(input.action_id || '').trim() || ('ACT-' + Utilities.getUuid());
  const existingAttachments = Array.isArray(input.attachments) ? input.attachments.slice(0, 10) : [];
  const driveIds = saveImagesToDrive_(images, actionId, 'growth_action');
  if (driveIds.length !== images.length) throw new Error('添付画像のDrive保存に失敗しました。DRIVE_FOLDER_IDを確認してください。');
  const newAttachments = driveIds.map(function(id, i) {
    return { file_id: id, name: images[i].originalName || ('image_' + (i + 1)), mime_type: images[i].mimeType || 'image/jpeg', order: existingAttachments.length + i };
  });
  const attachments = existingAttachments.concat(newAttachments).slice(0, 10).map(function(x, i) {
    return { file_id: String(x.file_id || x.fileId || ''), name: String(x.name || ''), mime_type: String(x.mime_type || ''), order: i };
  }).filter(function(x) { return x.file_id; });
  const tags = Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(/[、,]/).map(function(x) { return x.trim(); }).filter(Boolean);
  const targetAsins = pgNormalizeActionAsins_(asin, input.target_asins);
  const actionScope = targetAsins.length > 1 ? String(input.action_scope || 'selected_variations').trim() : 'single';
  const record = {
    action_id: actionId,
    product_id: String(input.product_id || '').trim(),
    asin: asin,
    sku: String(input.sku || '').trim(),
    action_at: actionAt,
    action_type: String(input.action_type || '商品ページ改善').trim(),
    title: title,
    hypothesis: String(input.hypothesis || '').trim(),
    action_detail: String(input.action_detail || '').trim(),
    expected_metric: String(input.expected_metric || '').trim(),
    expected_direction: String(input.expected_direction || '').trim(),
    evaluation_date: pgDateKey_(input.evaluation_date),
    status: String(input.status || '実施済み').trim(),
    result: String(input.result || '').trim(),
    tags_json: JSON.stringify(tags),
    related_url: String(input.related_url || '').trim(),
    attachments_json: JSON.stringify(attachments),
    show_on_chart: input.show_on_chart !== false,
    action_scope: actionScope,
    target_asins_json: JSON.stringify(targetAsins),
    variation_group_key: String(input.variation_group_key || '').trim().toUpperCase(),
    created_at: String(input.created_at || now),
    updated_at: now
  };
  const data = ref.sheet.getDataRange().getValues();
  const idIdx = ref.headers.indexOf('action_id');
  let rowNum = 0;
  for (let i = 1; i < data.length; i++) if (String(data[i][idIdx]) === actionId) { rowNum = i + 1; break; }
  const row = ref.headers.map(function(h) { return record[h] !== undefined ? record[h] : ''; });
  if (rowNum) ref.sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  else ref.sheet.appendRow(row);
  const saved = Object.assign({}, record, {
    tags: tags,
    attachments: attachments,
    target_asins: targetAsins,
    is_shared: targetAsins.length > 1,
    shared_product_count: targetAsins.length
  });
  delete saved.tags_json; delete saved.attachments_json; delete saved.target_asins_json;
  return saved;
}

function pgAdvertisingMetricSnapshot_(report) {
  if (!report || !Array.isArray(report.rows)) return null;
  const totals = report.rows.reduce(function(sum, row) {
    ['impressions','clicks','spend_yen','orders','sales_yen'].forEach(function(key) {
      const value = Number(row[key]);
      if (isFinite(value)) sum[key] += value;
    });
    return sum;
  }, { impressions:0, clicks:0, spend_yen:0, orders:0, sales_yen:0 });
  totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : null;
  totals.cpc_yen = totals.clicks > 0 ? totals.spend_yen / totals.clicks : null;
  totals.conversion_rate = totals.clicks > 0 ? totals.orders / totals.clicks : null;
  totals.acos = totals.sales_yen > 0 ? totals.spend_yen / totals.sales_yen : null;
  totals.roas = totals.spend_yen > 0 ? totals.sales_yen / totals.spend_yen : null;
  return {
    aggregation_scope: 'RETURNED_CSV_ROWS_NOT_ACCOUNT_UNIVERSE',
    row_count: report.rows.length,
    click_metrics_available: !!(report.stats && report.stats.click_metrics_available),
    totals: totals
  };
}

function pgCentralAdvertisingPeriodSnapshot_(asin, fromDate, toDate, captureMode) {
  const from = pgDateKey_(fromDate), to = pgDateKey_(toDate);
  if (!from || !to || from > to) return null;
  const start = new Date(from + 'T00:00:00+09:00');
  const end = new Date(to + 'T00:00:00+09:00');
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const growth = getProductGrowthData_(asin, Math.min(365, Math.max(7, days)), to);
  const totals = growth.points.filter(function(point) {
    return point.date >= from && point.date <= to;
  }).reduce(function(sum, point) {
    [
      'sales','units','gross_profit','ad_spend','ad_sales',
      'ad_impressions','ad_clicks','ad_orders','ad_units'
    ].forEach(function(key) { sum[key] += Number(point[key]) || 0; });
    return sum;
  }, {
    sales:0,units:0,gross_profit:0,ad_spend:0,ad_sales:0,
    ad_impressions:0,ad_clicks:0,ad_orders:0,ad_units:0
  });
  totals.profit_after_ad = totals.gross_profit - totals.ad_spend;
  totals.acos = totals.ad_sales > 0 ? totals.ad_spend / totals.ad_sales : null;
  totals.roas = totals.ad_spend > 0 ? totals.ad_sales / totals.ad_spend : null;
  totals.cpc_yen = totals.ad_clicks > 0 ? totals.ad_spend / totals.ad_clicks : null;
  totals.ad_cvr = totals.ad_clicks > 0 ? totals.ad_orders / totals.ad_clicks : null;
  totals.tacos = totals.sales > 0 ? totals.ad_spend / totals.sales : null;
  return {
    source: 'CENTRAL_DAILY_ASIN',
    capture_mode: captureMode || 'CAPTURED_WITH_SNAPSHOT',
    period_from: from,
    period_to: to,
    day_count: days,
    totals: totals
  };
}

function pgAllAdvertisingCandidates_(session) {
  const out = [];
  const seen = {};
  const families = session && session.analysis && Array.isArray(session.analysis.families)
    ? session.analysis.families : [];
  families.forEach(function(family) {
    ['selected_candidates','suppressed_candidates'].forEach(function(key) {
      (Array.isArray(family[key]) ? family[key] : []).forEach(function(candidate) {
        const id = String(candidate.candidate_id || '');
        if (!id || seen[id]) return;
        seen[id] = true;
        out.push(candidate);
      });
    });
  });
  return out;
}

function pgAdvertisingSnapshotFolder_(actionId) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID が未設定です。');
  const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const folder = function(parent, name) {
    const iterator = parent.getFoldersByName(name);
    return iterator.hasNext() ? iterator.next() : parent.createFolder(name);
  };
  return folder(folder(root, 'advertising_action_snapshots'), actionId);
}

function saveAdvertisingAdjustmentAction_(input, images, contextInput) {
  input = input || {};
  contextInput = contextInput || {};
  images = Array.isArray(images) ? images.slice(0, 10) : [];
  const asin = pgAsin_(input.asin);
  const sessionId = String(contextInput.analysis_session_id || '').trim();
  if (!sessionId) throw new Error('広告分析sessionが必要です。');
  const session = getAdvertisingKeywordAnalysis_(sessionId);
  if (!session || String(session.preview.metadata.asin || '').trim().toUpperCase() !== asin) {
    throw new Error('広告分析sessionとアクションのASINが一致しません。');
  }
  const requestedIds = Array.from(new Set((Array.isArray(contextInput.candidate_ids)
    ? contextInput.candidate_ids : []).map(function(id) { return String(id || '').trim(); }).filter(Boolean)));
  if (!requestedIds.length) throw new Error('今回の変更に含める分析候補を1件以上選択してください。');
  const candidates = pgAllAdvertisingCandidates_(session);
  const candidateMap = {};
  candidates.forEach(function(candidate) { candidateMap[String(candidate.candidate_id)] = candidate; });
  const unknownIds = requestedIds.filter(function(id) { return !candidateMap[id]; });
  if (unknownIds.length) throw new Error('分析sessionに存在しないcandidate IDが含まれています。');
  const allowedModes = ['NO_DETAIL','FREE_TEXT','SCREENSHOT','STRUCTURED'];
  const detailMode = String(contextInput.execution_detail_mode || 'NO_DETAIL').trim().toUpperCase();
  if (allowedModes.indexOf(detailMode) < 0) throw new Error('実施内容の記録方式が不正です。');
  const actionId = String(input.action_id || '').trim() || ('ACT-' + Utilities.getUuid());
  const now = new Date().toISOString();
  const beforeSnapshot = {
    schema_version: 'advertising_action_before_snapshot_v1',
    snapshot_role: 'BEFORE',
    captured_at: now,
    action_id: actionId,
    asin: asin,
    analysis_session_id: session.session_id,
    advertising_period: {
      from: session.preview.metadata.period_from,
      to: session.preview.metadata.period_to
    },
    coverage: {
      file_scope_status: session.preview.metadata.file_scope_status,
      universe_coverage: session.preview.metadata.universe_coverage,
      returned_target_count: session.preview.metadata.returned_target_count,
      returned_search_term_count: session.preview.metadata.returned_search_term_count
    },
    source: {
      policy_version: session.policy_version,
      parser_version: session.preview.parser_version,
      target_file_id: session.target_file_id || null,
      target_file_sha256: session.preview.metadata.target_file_sha256 || null,
      search_term_file_id: session.search_term_file_id || null,
      search_term_file_sha256: session.preview.metadata.search_term_file_sha256 || null,
      analysis_result_file_id: session.result_drive_file_id || null
    },
    selected_candidate_ids: requestedIds,
    selected_candidates: requestedIds.map(function(id) { return candidateMap[id]; }),
    advertising_efficiency: {
      warning: 'CSVの返却行だけを集計した変更前snapshot。広告アカウント・キャンペーン全体とは限らない。',
      target_rows: pgAdvertisingMetricSnapshot_(session.preview.reports.target),
      search_term_rows: pgAdvertisingMetricSnapshot_(session.preview.reports.search_term)
    },
    central_period: pgCentralAdvertisingPeriodSnapshot_(
      asin,
      session.preview.metadata.period_from,
      session.preview.metadata.period_to,
      'CAPTURED_WITH_BEFORE_SNAPSHOT'
    ),
    central_context: session.analysis.central_context || null
  };
  let snapshotFile = null;
  try {
    snapshotFile = pgAdvertisingSnapshotFolder_(actionId).createFile(Utilities.newBlob(
      JSON.stringify(beforeSnapshot),
      'application/json',
      'before_snapshot.json'
    ));
    const saved = saveProductAction_(Object.assign({}, input, {
      action_id: actionId,
      asin: asin,
      action_type: '広告調整'
    }), images);
    const ref = pgEnsureSheet_(PG_AD_ACTION_CONTEXT_SHEET, PG_AD_ACTION_CONTEXT_HEADERS);
    const context = {
      context_id: 'ADCTX-' + Utilities.getUuid(),
      action_id: actionId,
      asin: asin,
      analysis_session_id: session.session_id,
      candidate_ids_json: JSON.stringify(requestedIds),
      execution_detail_mode: detailMode,
      before_snapshot_file_id: snapshotFile.getId(),
      after_snapshot_file_id: '',
      evaluation_status: 'WAITING_FOR_AFTER',
      comparison_json: '',
      created_at: now,
      updated_at: now
    };
    ref.sheet.appendRow(ref.headers.map(function(header) {
      return context[header] !== undefined ? context[header] : '';
    }));
    saved.advertising_context = pgHydrateAdvertisingActionContext_(
      ref.headers,
      ref.headers.map(function(header) { return context[header] !== undefined ? context[header] : ''; })
    );
    return saved;
  } catch (error) {
    if (snapshotFile && typeof snapshotFile.setTrashed === 'function') {
      try { snapshotFile.setTrashed(true); } catch (cleanupError) { Logger.log(cleanupError.message); }
    }
    throw error;
  }
}

function pgFindAdvertisingActionContext_(actionId) {
  const id = String(actionId || '').trim();
  if (!id) throw new Error('actionIdが必要です。');
  const ref = pgEnsureSheet_(PG_AD_ACTION_CONTEXT_SHEET, PG_AD_ACTION_CONTEXT_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  const actionIndex = ref.headers.indexOf('action_id');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][actionIndex] || '').trim() !== id) continue;
    return {
      ref: ref,
      row_number: i + 1,
      context: pgHydrateAdvertisingActionContext_(ref.headers, values[i])
    };
  }
  throw new Error('広告調整アクションのcontextが見つかりません。');
}

function pgReadAdvertisingSnapshotFile_(fileId) {
  try {
    return JSON.parse(DriveApp.getFileById(String(fileId || '')).getBlob().getDataAsString('UTF-8'));
  } catch (error) {
    throw new Error('広告調整snapshotを読み込めません: ' + error.message);
  }
}

function pgAdvertisingEvaluationWarnings_(beforeSnapshot, afterSession) {
  const warnings = [];
  const beforeFrom = String(beforeSnapshot.advertising_period.from || '');
  const beforeTo = String(beforeSnapshot.advertising_period.to || '');
  const afterFrom = String(afterSession.preview.metadata.period_from || '');
  const afterTo = String(afterSession.preview.metadata.period_to || '');
  if (afterFrom <= beforeTo) warnings.push({
    code: 'PERIOD_OVERLAP',
    message: '変更前期間と変更後期間が重なっています。重複期間の影響を含む比較です。'
  });
  const days = function(from, to) {
    return Math.round((new Date(to + 'T00:00:00+09:00').getTime()
      - new Date(from + 'T00:00:00+09:00').getTime()) / 86400000) + 1;
  };
  if (days(beforeFrom, beforeTo) !== days(afterFrom, afterTo)) warnings.push({
    code: 'UNEQUAL_PERIOD_LENGTH',
    message: '変更前後の期間日数が異なります。合計値は日数差の影響を受けます。'
  });
  const beforeSource = beforeSnapshot.source || {};
  const afterMeta = afterSession.preview.metadata || {};
  if (beforeSource.target_file_sha256 && beforeSource.target_file_sha256 === afterMeta.target_file_sha256) warnings.push({
    code: 'SAME_TARGET_FILE',
    message: 'Target CSVが変更前snapshotと同一です。'
  });
  if (beforeSource.search_term_file_sha256
    && beforeSource.search_term_file_sha256 === afterMeta.search_term_file_sha256) warnings.push({
    code: 'SAME_SEARCH_TERM_FILE',
    message: 'Search Term CSVが変更前snapshotと同一です。'
  });
  return warnings;
}

function attachAdvertisingActionAfterSnapshot_(actionId, afterSessionId) {
  const found = pgFindAdvertisingActionContext_(actionId);
  const context = found.context;
  if (context.after_snapshot_file_id) throw new Error('このアクションには変更後snapshotが既に登録されています。');
  const sessionId = String(afterSessionId || '').trim();
  if (!sessionId) throw new Error('変更後の広告分析sessionが必要です。');
  if (sessionId === String(context.analysis_session_id || '')) {
    throw new Error('変更前と同じ広告分析sessionは変更後snapshotに登録できません。');
  }
  const afterSession = getAdvertisingKeywordAnalysis_(sessionId);
  if (String(afterSession.preview.metadata.asin || '').trim().toUpperCase()
    !== String(context.asin || '').trim().toUpperCase()) {
    throw new Error('変更後sessionと広告調整アクションのASINが一致しません。');
  }
  const beforeSnapshot = pgReadAdvertisingSnapshotFile_(context.before_snapshot_file_id);
  const beforeTo = String(beforeSnapshot.advertising_period.to || '');
  const afterTo = String(afterSession.preview.metadata.period_to || '');
  if (!afterTo || afterTo <= beforeTo) {
    throw new Error('変更後期間は変更前期間より後の日付を含む必要があります。対象期間を確認してください。');
  }
  const beforeSource = beforeSnapshot.source || {};
  const afterMeta = afterSession.preview.metadata || {};
  const hasCommonReport = Boolean(
    (beforeSource.target_file_sha256 && afterMeta.target_file_sha256)
    || (beforeSource.search_term_file_sha256 && afterMeta.search_term_file_sha256)
  );
  if (!hasCommonReport) {
    throw new Error('変更前後で共通するCSV種別がありません。同じ種類のTargetまたはSearch Term CSVを選択してください。');
  }
  const identicalSources = [];
  if (beforeSource.target_file_sha256 && afterMeta.target_file_sha256) {
    identicalSources.push(beforeSource.target_file_sha256 === afterMeta.target_file_sha256);
  }
  if (beforeSource.search_term_file_sha256 && afterMeta.search_term_file_sha256) {
    identicalSources.push(beforeSource.search_term_file_sha256 === afterMeta.search_term_file_sha256);
  }
  if (identicalSources.length && identicalSources.every(Boolean)) {
    throw new Error('変更前と完全に同じ広告CSVです。新しい期間のCSVを選択してください。');
  }
  const afterCentral = pgCentralAdvertisingPeriodSnapshot_(
    context.asin,
    afterSession.preview.metadata.period_from,
    afterSession.preview.metadata.period_to,
    'CAPTURED_WITH_AFTER_SNAPSHOT'
  );
  const beforeCentral = beforeSnapshot.central_period || pgCentralAdvertisingPeriodSnapshot_(
    context.asin,
    beforeSnapshot.advertising_period.from,
    beforeSnapshot.advertising_period.to,
    'RECONSTRUCTED_AT_AFTER_LINK'
  );
  const warnings = pgAdvertisingEvaluationWarnings_(beforeSnapshot, afterSession);
  if (!beforeSnapshot.central_period) warnings.push({
    code: 'CENTRAL_BEFORE_RECONSTRUCTED',
    message: '変更前のCentral日次実績は、変更後snapshot接続時点の保存データから再集計しています。'
  });
  const now = new Date().toISOString();
  const comparison = {
    schema_version: 'advertising_action_comparison_v1',
    action_id: String(actionId),
    asin: String(context.asin),
    joined_at: now,
    interpretation_scope: 'BUNDLED_ADJUSTMENT_BEFORE_AFTER_NOT_SINGLE_KEYWORD_CAUSALITY',
    warning: '複数の広告変更をまとめた前後比較です。個別キーワードの因果効果は断定しません。',
    warnings: warnings,
    before: {
      analysis_session_id: String(context.analysis_session_id),
      period_from: beforeSnapshot.advertising_period.from,
      period_to: beforeSnapshot.advertising_period.to,
      advertising_efficiency: beforeSnapshot.advertising_efficiency,
      central_period: beforeCentral
    },
    after: {
      analysis_session_id: afterSession.session_id,
      period_from: afterSession.preview.metadata.period_from,
      period_to: afterSession.preview.metadata.period_to,
      advertising_efficiency: {
        warning: 'CSVの返却行だけを集計した変更後snapshot。広告アカウント・キャンペーン全体とは限らない。',
        target_rows: pgAdvertisingMetricSnapshot_(afterSession.preview.reports.target),
        search_term_rows: pgAdvertisingMetricSnapshot_(afterSession.preview.reports.search_term)
      },
      central_period: afterCentral
    }
  };
  let afterFile = null;
  try {
    afterFile = pgAdvertisingSnapshotFolder_(String(actionId)).createFile(Utilities.newBlob(
      JSON.stringify({
        schema_version: 'advertising_action_after_snapshot_v1',
        snapshot_role: 'AFTER',
        captured_at: now,
        action_id: String(actionId),
        asin: String(context.asin),
        analysis_session_id: afterSession.session_id,
        source_analysis_result_file_id: afterSession.result_drive_file_id || null,
        comparison: comparison
      }),
      'application/json',
      'after_snapshot.json'
    ));
    const col = {};
    found.ref.headers.forEach(function(header, index) { col[header] = index + 1; });
    found.ref.sheet.getRange(found.row_number, col.after_snapshot_file_id).setValue(afterFile.getId());
    found.ref.sheet.getRange(found.row_number, col.evaluation_status).setValue('READY');
    found.ref.sheet.getRange(found.row_number, col.comparison_json).setValue(JSON.stringify(comparison));
    found.ref.sheet.getRange(found.row_number, col.updated_at).setValue(now);
    const updatedRow = found.ref.sheet.getRange(
      found.row_number, 1, 1, found.ref.headers.length
    ).getValues()[0];
    return pgHydrateAdvertisingActionContext_(found.ref.headers, updatedRow);
  } catch (error) {
    if (afterFile && typeof afterFile.setTrashed === 'function') {
      try { afterFile.setTrashed(true); } catch (cleanupError) { Logger.log(cleanupError.message); }
    }
    throw error;
  }
}

function archiveProductAction_(actionId) {
  const id = String(actionId || '').trim();
  if (!id) throw new Error('action_idが必要です。');
  const ref = pgEnsureSheet_(PG_ACTION_SHEET, PG_ACTION_HEADERS);
  const data = ref.sheet.getDataRange().getValues();
  const idIdx = ref.headers.indexOf('action_id'), statusIdx = ref.headers.indexOf('status'), updatedIdx = ref.headers.indexOf('updated_at');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) !== id) continue;
    ref.sheet.getRange(i + 1, statusIdx + 1).setValue('archived');
    ref.sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date().toISOString());
    return { action_id: id, status: 'archived' };
  }
  throw new Error('アクションが見つかりません。');
}

function pgImageUrls_(p) {
  const out = [];
  const add = function(value) {
    const raw = String(value || '').trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : 'https://m.media-amazon.com/images/I/' + raw;
    if (out.indexOf(url) < 0) out.push(url);
  };
  if (Array.isArray(p.images)) p.images.forEach(function(img) { add(typeof img === 'string' ? img : (img.l || img.m || img.s)); });
  if (!out.length) String(p.imagesCSV || '').split(',').forEach(add);
  return out;
}

function pgReadLatestSnapshot_(asinValue) {
  const asin = pgAsin_(asinValue);
  const ref = pgEnsureSheet_(LF_SNAPSHOT_SHEET, PG_SNAPSHOT_HEADERS);
  const data = ref.sheet.getDataRange().getValues();
  const found = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    ref.headers.forEach(function(h, c) { obj[h] = data[i][c]; });
    if (String(obj.own_asin || '').trim().toUpperCase() !== asin) continue;
    ['bullets_json','image_urls_json','aplus_json','category_tree_json','variations_json','videos_json','dimensions_json','fees_json','market_json'].forEach(function(k) {
      obj[k.replace(/_json$/, '')] = pgParseJson_(obj[k], k === 'aplus_json' || k === 'dimensions_json' || k === 'fees_json' || k === 'market_json' ? {} : []);
      delete obj[k];
    });
    found.push(obj);
  }
  found.sort(function(a, b) { return String(b.checked_at || b.captured_at).localeCompare(String(a.checked_at || a.captured_at)); });
  return found[0] || null;
}

function getListingSnapshot_(asinValue) {
  return pgReadLatestSnapshot_(asinValue);
}

function pgSaveRawJson_(asin, snapshotId, json) {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID が未設定です。');
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const name = 'keepa_own_' + asin + '_' + snapshotId + '.json';
  return folder.createFile(Utilities.newBlob(JSON.stringify(json), 'application/json', name)).getId();
}

function pgKeepaMinuteToIso_(value) {
  const minute = Number(value);
  if (!isFinite(minute)) return '';
  return new Date((minute + PG_KEEPA_START_MINUTE) * 60000).toISOString();
}

function pgParseKeepaHistorySeries_(series) {
  const input = Array.isArray(series) ? series : [];
  const byTime = {};
  let malformed = input.length % 2;
  for (let i = 0; i + 1 < input.length; i += 2) {
    const minute = Number(input[i]), raw = Number(input[i + 1]);
    if (!isFinite(minute) || !isFinite(raw)) { malformed++; continue; }
    const at = pgKeepaMinuteToIso_(minute);
    if (!at) { malformed++; continue; }
    byTime[at] = { at:at, value:raw >= 0 ? raw : null, available:raw >= 0, raw_value:raw };
  }
  return {
    points:Object.keys(byTime).sort().map(function(at) { return byTime[at]; }),
    malformed_count:malformed
  };
}

// BUY_BOX_SHIPPING (csv[18]) は [時刻, 商品価格, 送料] の3要素構造。
// 画面で比較する価格は商品価格と送料の合計に正規化する。
function pgParseKeepaPriceShippingSeries_(series) {
  const input = Array.isArray(series) ? series : [];
  const byTime = {};
  let malformed = input.length % 3;
  for (let i = 0; i + 2 < input.length; i += 3) {
    const minute = Number(input[i]), price = Number(input[i + 1]), shipping = Number(input[i + 2]);
    if (!isFinite(minute) || !isFinite(price) || !isFinite(shipping)) { malformed++; continue; }
    const at = pgKeepaMinuteToIso_(minute);
    if (!at) { malformed++; continue; }
    const available = price >= 0 && shipping >= 0;
    byTime[at] = {
      at:at,
      value:available ? price + shipping : null,
      available:available,
      raw_price:price,
      raw_shipping:shipping
    };
  }
  return {
    points:Object.keys(byTime).sort().map(function(at) { return byTime[at]; }),
    malformed_count:malformed
  };
}

function pgKeepaSeriesSummary_(key, series, parserKind) {
  const parsed = parserKind === 'price_shipping'
    ? pgParseKeepaPriceShippingSeries_(series)
    : pgParseKeepaHistorySeries_(series);
  const valid = parsed.points.map(function(p) { return p.value; }).filter(function(v) { return v !== null && isFinite(v); });
  return {
    series_key:key,
    point_count:parsed.points.length,
    first_at:parsed.points.length ? parsed.points[0].at : '',
    last_at:parsed.points.length ? parsed.points[parsed.points.length - 1].at : '',
    min_value:valid.length ? Math.min.apply(null, valid) : '',
    max_value:valid.length ? Math.max.apply(null, valid) : '',
    missing_count:parsed.points.filter(function(p) { return !p.available; }).length,
    malformed_count:parsed.malformed_count
  };
}

function pgKeepaTrialFolder_() {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID が未設定です。');
  const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const folders = root.getFoldersByName('keepa_history_trial');
  return folders.hasNext() ? folders.next() : root.createFolder('keepa_history_trial');
}

function pgWriteKeepaTrialPreview_(rows) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(PG_KEEPA_TRIAL_SHEET);
  if (!sheet) sheet = ss.insertSheet(PG_KEEPA_TRIAL_SHEET);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, PG_KEEPA_TRIAL_HEADERS.length).setValues([PG_KEEPA_TRIAL_HEADERS]);
  if (rows.length) sheet.getRange(2, 1, rows.length, PG_KEEPA_TRIAL_HEADERS.length).setValues(rows.map(function(row) {
    return PG_KEEPA_TRIAL_HEADERS.map(function(h) { return row[h] !== undefined ? row[h] : ''; });
  }));
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, PG_KEEPA_TRIAL_HEADERS.length);
}

function pgKeepaTokenStatus_(apiKey) {
  const response = UrlFetchApp.fetch('https://api.keepa.com/token?key=' + encodeURIComponent(apiKey), { muteHttpExceptions:true });
  if (response.getResponseCode() !== 200) throw new Error('Keepaトークン確認エラー (HTTP ' + response.getResponseCode() + ')');
  return JSON.parse(response.getContentText());
}

function pgMarketHistoryFolders_() {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID が未設定です。');
  const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const parentIt = root.getFoldersByName('product_market_history');
  const parent = parentIt.hasNext() ? parentIt.next() : root.createFolder('product_market_history');
  const ensure = function(name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  };
  return { raw:ensure('raw'), normalized:ensure('normalized') };
}

function pgNormalizeKeepaMarketHistory_(product, meta) {
  const csv = Array.isArray(product.csv) ? product.csv : [];
  const parsed = {
    new_price:pgParseKeepaHistorySeries_(csv[1]).points,
    sales_rank:pgParseKeepaHistorySeries_(csv[3]).points,
    new_fba:pgParseKeepaHistorySeries_(csv[10]).points,
    new_offer_count:pgParseKeepaHistorySeries_(csv[11]).points,
    buy_box:pgParseKeepaPriceShippingSeries_(csv[18]).points,
    monthly_sold:pgParseKeepaHistorySeries_(product.monthlySoldHistory).points
  };
  const categories = {};
  Object.keys(product.salesRanks || {}).forEach(function(categoryId) {
    categories[categoryId] = pgParseKeepaHistorySeries_(product.salesRanks[categoryId]).points;
  });
  const all = [];
  Object.keys(parsed).forEach(function(k) { parsed[k].forEach(function(p) { all.push(p.at); }); });
  const checkedAt = meta.checked_at || new Date().toISOString();
  return {
    schema_version:'product_market_history_v1',asin:pgAsin_(product.asin),
    from_date:meta.from_date || (all.length ? all.sort()[0].slice(0, 10) : ''),
    to_date:meta.to_date || checkedAt.slice(0, 10),checked_at:checkedAt,
    source:'keepa',request_kind:meta.request_kind || 'history+buybox',series:parsed,categories:categories,
    coverage:Object.keys(parsed).reduce(function(result, key) {
      const points = parsed[key];
      result[key] = { point_count:points.length,first_at:points.length ? points[0].at : '',last_at:points.length ? points[points.length - 1].at : '',missing_count:points.filter(function(p) { return !p.available; }).length };
      return result;
    }, {}),
    keepa:{ tokens_consumed:Number(meta.tokens_consumed) || 0,tokens_left:Number(meta.tokens_left) || 0 },
    raw_file_id:meta.raw_file_id || ''
  };
}

function pgMarketSeriesIndex_(normalized) {
  const result = {};
  Object.keys(normalized.series || {}).forEach(function(key) {
    const points = normalized.series[key] || [];
    result[key] = { point_count:points.length,first_at:points.length ? points[0].at : '',last_at:points.length ? points[points.length - 1].at : '',latest_value:(function() { for (let i=points.length-1;i>=0;i--) if (points[i].available) return points[i].value; return null; })() };
  });
  return result;
}

function pgSaveNormalizedMarketHistory_(normalized, rawFileId, payloadBytes, tokensConsumed, tokensLeft) {
  const folders = pgMarketHistoryFolders_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const historyId = 'MH-' + normalized.asin + '-' + stamp;
  const name = 'market_' + normalized.asin + '_365d_' + stamp + '.json';
  const normalizedFile = folders.normalized.createFile(Utilities.newBlob(JSON.stringify(normalized), 'application/json', name));
  const index = pgMarketSeriesIndex_(normalized);
  const pointCount = Object.keys(normalized.series || {}).reduce(function(n, k) { return n + (normalized.series[k] || []).length; }, 0);
  const row = {
    history_id:historyId,asin:normalized.asin,from_date:normalized.from_date,to_date:normalized.to_date,
    checked_at:normalized.checked_at,source:'keepa',request_kind:normalized.request_kind,
    series_json:JSON.stringify(index),point_count:pointCount,raw_file_id:rawFileId || '',
    normalized_file_id:normalizedFile.getId(),payload_bytes:Number(payloadBytes) || 0,
    tokens_consumed:Number(tokensConsumed) || 0,tokens_left:Number(tokensLeft) || 0,status:'ok',error:''
  };
  const ref = pgEnsureSheet_(PG_MARKET_HISTORY_SHEET, PG_MARKET_HISTORY_HEADERS);
  ref.sheet.appendRow(PG_MARKET_HISTORY_HEADERS.map(function(h) { return row[h] !== undefined ? row[h] : ''; }));
  return { history_id:historyId,normalized_file_id:normalizedFile.getId(),data:normalized };
}

function pgSliceMarketPoints_(points, fromDate, toDate) {
  const input = Array.isArray(points) ? points : [];
  let preceding = null;
  const within = [];
  input.forEach(function(point) {
    const date = String(point.at || '').slice(0, 10);
    if (!date) return;
    if (date < fromDate) preceding = point;
    else if (date <= toDate) within.push(point);
  });
  if (preceding) within.unshift(Object.assign({}, preceding, { at:fromDate + 'T00:00:00.000Z', carried:true }));
  return within;
}

function getProductMarketHistory_(asinValue, daysValue, endDateValue) {
  const asin = pgAsin_(asinValue);
  const days = Math.max(7, Math.min(365, Number(daysValue) || 30));
  const end = parseDate_(endDateValue) || new Date();
  const start = new Date(end.getTime()); start.setDate(start.getDate() - days + 1);
  const fromDate = pgDateKey_(start), toDate = pgDateKey_(end);
  const ref = pgEnsureSheet_(PG_MARKET_HISTORY_SHEET, PG_MARKET_HISTORY_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  const rows = values.slice(1).map(function(row) { const obj={}; ref.headers.forEach(function(h,i){obj[h]=row[i];}); return obj; })
    .filter(function(row) { return String(row.asin || '').trim().toUpperCase() === asin && row.status === 'ok' && row.normalized_file_id; })
    .sort(function(a,b) { return String(b.checked_at).localeCompare(String(a.checked_at)); });
  if (!rows.length) return null;
  const latest = rows[0];
  const data = JSON.parse(DriveApp.getFileById(String(latest.normalized_file_id)).getBlob().getDataAsString('UTF-8'));
  const result = Object.assign({}, data, { from_date:fromDate,to_date:toDate,days:days,history_id:latest.history_id,normalized_file_id:latest.normalized_file_id });
  result.series = {};
  Object.keys(data.series || {}).forEach(function(key) { result.series[key] = pgSliceMarketPoints_(data.series[key], fromDate, toDate); });
  result.categories = {};
  Object.keys(data.categories || {}).forEach(function(key) { result.categories[key] = pgSliceMarketPoints_(data.categories[key], fromDate, toDate); });
  return result;
}

function pgStoreKeepaMarketResponse_(json, meta) {
  const product = json.products && json.products[0];
  if (!product) throw new Error('Keepaで商品が見つかりませんでした。');
  const normalized = pgNormalizeKeepaMarketHistory_(product, meta);
  return pgSaveNormalizedMarketHistory_(normalized, meta.raw_file_id, meta.payload_bytes, meta.tokens_consumed, meta.tokens_left);
}

function refreshProductMarketHistory_(asinValue, daysValue) {
  const asin = pgAsin_(asinValue), days = Math.max(30, Math.min(365, Number(daysValue) || 365));
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定です。');
  const before = pgKeepaTokenStatus_(apiKey), tokensBefore = Number(before.tokensLeft);
  if (isFinite(tokensBefore) && tokensBefore < 10) throw new Error('Keepaトークンが10未満のため更新を中止しました。残り: ' + tokensBefore);
  const params = ['key='+encodeURIComponent(apiKey),'domain=5','asin='+encodeURIComponent(asin),'history=1','days='+days,'stats='+days,'rating=1','buybox=1'];
  const response = UrlFetchApp.fetch('https://api.keepa.com/product?' + params.join('&'), { muteHttpExceptions:true });
  const text = response.getContentText();
  if (response.getResponseCode() !== 200) throw new Error('Keepa市場履歴エラー (HTTP ' + response.getResponseCode() + '): ' + text.slice(0, 300));
  const json = JSON.parse(text), folders = pgMarketHistoryFolders_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const raw = folders.raw.createFile(Utilities.newBlob(text, 'application/json', 'keepa_' + asin + '_' + stamp + '.json'));
  return pgStoreKeepaMarketResponse_(json, { checked_at:new Date().toISOString(),from_date:'',to_date:pgDateKey_(new Date()),request_kind:'history+buybox',raw_file_id:raw.getId(),payload_bytes:raw.getSize(),tokens_consumed:Number(json.tokensConsumed)||0,tokens_left:Number(json.tokensLeft)||0 }).data;
}

/**
 * PERFORMANCE TIMELINE Phase 0: Keepa履歴を1 ASINだけ試験取得する。
 * includeBuybox は試験Aで csv[18] が得られなかった場合だけ true にする。
 */
function previewKeepaHistoryTrial_(asinValue, daysValue, includeBuybox) {
  const asin = pgAsin_(asinValue || 'B0FXTQPGSB');
  const days = Math.max(30, Math.min(365, Number(daysValue) || 365));
  const useBuybox = includeBuybox === true;
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定です。');
  const before = pgKeepaTokenStatus_(apiKey);
  const tokensBefore = Number(before.tokensLeft);
  if (isFinite(tokensBefore) && tokensBefore < 10) throw new Error('Keepaトークンが10未満のため試験を中止しました。残り: ' + tokensBefore);

  const params = [
    'key=' + encodeURIComponent(apiKey), 'domain=5', 'asin=' + encodeURIComponent(asin),
    'history=1', 'days=' + days, 'stats=' + days, 'rating=1'
  ];
  if (useBuybox) params.push('buybox=1');
  const started = Date.now();
  const response = UrlFetchApp.fetch('https://api.keepa.com/product?' + params.join('&'), { muteHttpExceptions:true });
  const durationMs = Date.now() - started;
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) throw new Error('Keepa履歴試験エラー (HTTP ' + code + '): ' + text.slice(0, 300));
  const json = JSON.parse(text), product = json.products && json.products[0];
  if (!product) throw new Error('Keepaで商品が見つかりませんでした: ' + asin);

  const fetchedAt = new Date().toISOString();
  const requestKind = useBuybox ? 'B:history+buybox' : 'A:history';
  const payloadBytes = Utilities.newBlob(text).getBytes().length;
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const rawFile = pgKeepaTrialFolder_().createFile(Utilities.newBlob(text, 'application/json', 'keepa_history_trial_' + asin + '_' + requestKind.charAt(0) + '_' + stamp + '.json'));
  const seriesDefs = [
    { key:'new_price', index:1, note:'新品価格' },
    { key:'sales_rank', index:3, note:'主売れ筋ランキング' },
    { key:'new_fba', index:10, note:'新品FBA価格' },
    { key:'new_offer_count', index:11, note:'新品出品者数' },
    { key:'buy_box', index:18, note:'Buy Box価格' }
  ];
  const csv = Array.isArray(product.csv) ? product.csv : [];
  const summaries = seriesDefs.map(function(def) {
    const summary = pgKeepaSeriesSummary_(def.key, csv[def.index]);
    summary.note = def.note + (summary.malformed_count ? ' / 不正要素 ' + summary.malformed_count : '');
    return summary;
  });
  if (product.monthlySoldHistory) {
    const monthly = pgKeepaSeriesSummary_('monthly_sold', product.monthlySoldHistory);
    monthly.note = 'Amazon過去1か月購入表示';
    summaries.push(monthly);
  }
  Object.keys(product.salesRanks || {}).slice(0, 10).forEach(function(categoryId) {
    const sub = pgKeepaSeriesSummary_('subcategory_rank:' + categoryId, product.salesRanks[categoryId]);
    sub.note = 'サブカテゴリランキング';
    summaries.push(sub);
  });

  const tokensConsumed = Number(json.tokensConsumed);
  const tokensLeft = Number(json.tokensLeft);
  const rows = summaries.map(function(summary) {
    const required = summary.series_key === 'sales_rank';
    return {
      asin:asin,fetched_at:fetchedAt,request_kind:requestKind,series_key:summary.series_key,
      point_count:summary.point_count,first_at:summary.first_at,last_at:summary.last_at,
      min_value:summary.min_value,max_value:summary.max_value,missing_count:summary.missing_count,
      payload_bytes:payloadBytes,duration_ms:durationMs,tokens_before:isFinite(tokensBefore) ? tokensBefore : '',
      tokens_consumed:isFinite(tokensConsumed) ? tokensConsumed : '',tokens_left:isFinite(tokensLeft) ? tokensLeft : '',
      raw_file_id:rawFile.getId(),verdict:summary.point_count ? 'OK' : (required ? '要確認' : '未取得'),note:summary.note
    };
  });
  pgWriteKeepaTrialPreview_(rows);
  const byKey = {};
  summaries.forEach(function(s) { byKey[s.series_key] = s; });
  const result = {
    asin:asin,days:days,request_kind:requestKind,payload_bytes:payloadBytes,duration_ms:durationMs,
    tokens_before:isFinite(tokensBefore) ? tokensBefore : null,
    tokens_consumed:isFinite(tokensConsumed) ? tokensConsumed : null,
    tokens_left:isFinite(tokensLeft) ? tokensLeft : null,
    raw_file_id:rawFile.getId(),series:summaries,
    next_step:byKey.buy_box && byKey.buy_box.point_count ? '試験Aのデータで本番設計へ進めます。' : (useBuybox ? 'Buy Box履歴は未取得です。他系列で本番設計を進めます。' : 'csv[18]が空のため、試験B（includeBuybox=true）を検討してください。')
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// claspからPhase 0の試験Aを引数事故なく1回実行するための固定ラッパー。
function previewKeepaHistoryTrialB0FXTQPGSB() {
  return previewKeepaHistoryTrial_('B0FXTQPGSB', 365, false);
}

function refreshOwnListingSnapshot_(asinValue) {
  const asin = pgAsin_(asinValue);
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) throw new Error('KEEPA_API_KEY が未設定です。');
  const url = 'https://api.keepa.com/product?key=' + encodeURIComponent(apiKey) + '&domain=5&asin=' + asin + '&stats=30&rating=1&aplus=1&videos=1&history=0';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Keepa APIエラー (HTTP ' + response.getResponseCode() + ')');
  const json = JSON.parse(response.getContentText());
  const p = json.products && json.products[0];
  if (!p) throw new Error('Keepaで商品が見つかりませんでした: ' + asin);
  const price = getKeepaCurrentValue_(p, 18) || getKeepaCurrentValue_(p, 1) || getKeepaCurrentValue_(p, 0);
  const rating10x = getKeepaCurrentValue_(p, 16);
  const reviewCount = getKeepaCurrentValue_(p, 17);
  const normalizedForHash = { title:p.title||'', features:p.features||[], description:p.description||'', images:pgImageUrls_(p), price:price, rating:rating10x, reviews:reviewCount, monthlySold:p.monthlySold||p.monthlySoldLastKnown||0 };
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(normalizedForHash));
  const hash = Utilities.base64EncodeWebSafe(digest);
  const now = new Date().toISOString();
  const ref = pgEnsureSheet_(LF_SNAPSHOT_SHEET, PG_SNAPSHOT_HEADERS);
  const latest = pgReadLatestSnapshot_(asin);
  if (latest && latest.content_hash === hash) {
    const data = ref.sheet.getDataRange().getValues(), idIdx = ref.headers.indexOf('snapshot_id'), checkedIdx = ref.headers.indexOf('checked_at'), tokenIdx = ref.headers.indexOf('keepa_tokens_left');
    for (let i = 1; i < data.length; i++) if (String(data[i][idIdx]) === String(latest.snapshot_id)) {
      ref.sheet.getRange(i + 1, checkedIdx + 1).setValue(now);
      if (tokenIdx >= 0) ref.sheet.getRange(i + 1, tokenIdx + 1).setValue(Number(json.tokensLeft) || 0);
      break;
    }
    latest.checked_at = now;
    latest.keepa_tokens_left = Number(json.tokensLeft) || 0;
    latest.unchanged = true;
    return latest;
  }
  const snapshotId = 'LST-' + Utilities.getUuid();
  const rawFileId = pgSaveRawJson_(asin, snapshotId, json);
  const record = {
    snapshot_id:snapshotId,page_project_id:'',own_asin:asin,captured_at:now,checked_at:now,source:'keepa',content_hash:hash,
    title:p.title||'',bullets_json:JSON.stringify(Array.isArray(p.features)?p.features:[]),description:p.description||'',
    image_urls_json:JSON.stringify(pgImageUrls_(p)),aplus_json:JSON.stringify(p.aplus || p.aPlus || {}),price:price||'',
    rating:rating10x !== null ? rating10x / 10 : '',review_count:reviewCount === null ? '' : reviewCount,
    brand:p.brand||'',manufacturer:p.manufacturer||'',monthly_sold:Number(p.monthlySold||p.monthlySoldLastKnown||0),
    category_tree_json:JSON.stringify(Array.isArray(p.categoryTree)?p.categoryTree:[]),
    variations_json:JSON.stringify(Array.isArray(p.variations)?p.variations:[]),videos_json:JSON.stringify(Array.isArray(p.videos)?p.videos:[]),
    dimensions_json:JSON.stringify({ packageHeight:p.packageHeight||0,packageLength:p.packageLength||0,packageWidth:p.packageWidth||0,packageWeight:p.packageWeight||0,itemHeight:p.itemHeight||0,itemLength:p.itemLength||0,itemWidth:p.itemWidth||0,itemWeight:p.itemWeight||0 }),
    fees_json:JSON.stringify(p.fbaFees||{}),market_json:JSON.stringify({ buyBoxPrice:getKeepaCurrentValue_(p,18),newPrice:getKeepaCurrentValue_(p,1),amazonPrice:getKeepaCurrentValue_(p,0) }),
    keepa_tokens_left:Number(json.tokensLeft)||0,raw_file_id:rawFileId
  };
  ref.sheet.appendRow(ref.headers.map(function(h) { return record[h] !== undefined ? record[h] : ''; }));
  return pgReadLatestSnapshot_(asin);
}

function pgMonthKeys_(monthsValue, endPeriodValue) {
  const months = Math.max(3, Math.min(36, Number(monthsValue) || 12));
  const match = String(endPeriodValue || '').match(/^(\d{4})-(\d{2})$/);
  const end = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    out.push(Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM'));
  }
  return out;
}

function pgInventoryByPeriod_(asin, periods) {
  const out = {};
  try {
    const sheet = getReportSheet_(SHEET_INVENTORY_SNAPSHOT, REQUIRED_HEADERS_INVENTORY_SNAPSHOT);
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return out;
    const h = values[0], ix = function(name) { return h.indexOf(name); };
    values.slice(1).forEach(function(row) {
      if (String(row[ix('asin')] || '').trim().toUpperCase() !== asin) return;
      const date = pgDateKey_(row[ix('snapshot_date')]);
      const period = date.slice(0, 7);
      if (periods.indexOf(period) < 0) return;
      if (!out[period] || date > out[period].snapshot_date) out[period] = {
        snapshot_date: date,
        available: Number(row[ix('available')]) || 0,
        inbound: Number(row[ix('inbound')]) || 0,
        daily_t7: Number(row[ix('daily_t7')]) || 0,
        days_remain: Number(row[ix('days_remain')]) || 0,
        alert: String(row[ix('alert')] || '')
      };
    });
  } catch (e) { Logger.log('pgInventoryByPeriod_: ' + e.message); }
  return out;
}

function pgAdBusinessByPeriods_(asin, periods) {
  const ad = {}, business = {};
  try {
    secRows_(SHEET_AD_PRODUCT_DAILY).forEach(function(row) {
      if (String(row.asin || '').trim().toUpperCase() !== asin) return;
      const period = String(row.period_key || pgDateKey_(row.date).slice(0, 7));
      if (periods.indexOf(period) < 0) return;
      const x = ad[period] || (ad[period] = { spend:0,sales:0,impressions:0,clicks:0,orders:0,units:0 });
      ['spend','sales','impressions','clicks','orders','units'].forEach(function(k) { x[k] += Number(row[k]) || 0; });
    });
    secRows_(SHEET_BUSINESS_REPORT).forEach(function(row) {
      if (String(row.asin || '').trim().toUpperCase() !== asin) return;
      const period = String(row.period_key || '');
      if (periods.indexOf(period) < 0) return;
      business[period] = {
        sessions:Number(row.sessions)||0,page_views:Number(row.page_views)||0,
        unit_session_rate:Number(row.unit_session_rate)||0,ordered_units:Number(row.ordered_units)||0,
        ordered_sales:Number(row.ordered_sales)||0,date_from:pgDateKey_(row.date_from),date_to:pgDateKey_(row.date_to)
      };
    });
  } catch (e) { Logger.log('pgAdBusinessByPeriods_: ' + e.message); }
  return { ad:ad, business:business };
}

function getProductMonthlyData_(asinValue, monthsValue, endPeriodValue) {
  const asin = pgAsin_(asinValue);
  const periods = pgMonthKeys_(monthsValue, endPeriodValue);
  const actuals = calculateMovingAverageActuals_();
  const inventory = pgInventoryByPeriod_(asin, periods);
  const adBusiness = pgAdBusinessByPeriods_(asin, periods);
  const actions = getProductActions_(asin, false);
  const points = periods.map(function(period) {
    const s = actuals.byPeriodAsin[period + '__' + asin] || {};
    const netUnits = (Number(s.qty) || 0) - (Number(s.returnQty) || 0);
    const fullyReturned = Math.abs(netUnits) < 0.000001 && ((Number(s.qty) || 0) + (Number(s.returnQty) || 0) > 0);
    const hasGross = !!s.hasCost || fullyReturned;
    const gross = hasGross ? (Number(s.net) || 0) - (Number(s.cogs) || 0) : null;
    const ad = adBusiness.ad[period] || {};
    const biz = adBusiness.business[period] || null;
    const sessions = biz ? Number(biz.sessions) || 0 : 0;
    const orderedUnits = biz ? Number(biz.ordered_units) || 0 : 0;
    const cvrRaw = biz ? Number(biz.unit_session_rate) || 0 : 0;
    const cvr = cvrRaw > 1 ? cvrRaw / 100 : cvrRaw;
    const sales = Number(s.salesTaxin) || 0;
    const units = Number(s.qty) || 0;
    const adSpend = Number(ad.spend) || 0;
    const adSales = Number(ad.sales) || 0;
    const inv = inventory[period] || null;
    return {
      period: period, sales: sales, units: units, returns: Number(s.returnQty) || 0,
      net: Number(s.net) || 0, cogs: hasGross ? Number(s.cogs) || 0 : null,
      gross_profit: gross, gross_margin: gross !== null && sales ? gross / sales : null,
      average_price: units ? sales / units : null,
      ad_spend: adSpend, ad_sales: adSales, ad_impressions: Number(ad.impressions) || 0,
      ad_clicks: Number(ad.clicks) || 0, ad_orders: Number(ad.orders) || 0, ad_units: Number(ad.units) || 0,
      acos: adSales ? adSpend / adSales : null, roas: adSpend ? adSales / adSpend : null,
      tacos: sales ? adSpend / sales : null, profit_after_ad: gross !== null ? gross - adSpend : null,
      sessions: sessions, page_views: biz ? Number(biz.page_views) || 0 : 0,
      cvr: biz ? cvr : null, ordered_units: orderedUnits,
      ordered_sales: biz ? Number(biz.ordered_sales) || 0 : 0, has_business: !!biz,
      business_range: biz ? { date_from: String(biz.date_from || ''), date_to: String(biz.date_to || '') } : null,
      inventory: inv,
      action_count: actions.filter(function(a) { return String(a.action_at || '').slice(0, 7) === period; }).length,
      actions: actions.filter(function(a) { return String(a.action_at || '').slice(0, 7) === period; }).map(function(a) { return { action_id:a.action_id, action_at:a.action_at, action_type:a.action_type, title:a.title, status:a.status }; })
    };
  });
  const meta = actuals.asinMeta[asin] || {};
  return { asin:asin, title:meta.title || asin, months:periods.length, from_period:periods[0], to_period:periods[periods.length - 1], points:points };
}

function pgContextImageParts_(images, snapshot, actions) {
  const parts = [], maxImages = 6, maxBytes = 12 * 1024 * 1024;
  let bytes = 0;
  const add = function(base64, mimeType) {
    if (!base64 || parts.length >= maxImages) return;
    const estimated = Math.floor(String(base64).length * 0.75);
    if (bytes + estimated > maxBytes) return;
    bytes += estimated;
    parts.push({ inlineData:{ mimeType:mimeType || 'image/jpeg', data:String(base64).replace(/^data:[^;]+;base64,/, '') } });
  };
  (Array.isArray(images) ? images.slice(0, 4) : []).forEach(function(img) { add(img.base64, img.mimeType); });
  if (snapshot && Array.isArray(snapshot.image_urls) && snapshot.image_urls[0] && parts.length < maxImages) {
    try { const blob=UrlFetchApp.fetch(snapshot.image_urls[0]).getBlob(); add(Utilities.base64Encode(blob.getBytes()), blob.getContentType()); } catch (e) { Logger.log('Keepa画像読込失敗: ' + e.message); }
  }
  for (let i = 0; i < actions.length && parts.length < maxImages; i++) {
    const attachments = Array.isArray(actions[i].attachments) ? actions[i].attachments : [];
    if (!attachments[0] || !attachments[0].file_id) continue;
    try { const blob=DriveApp.getFileById(attachments[0].file_id).getBlob(); add(Utilities.base64Encode(blob.getBytes()), blob.getContentType()); } catch (e) { Logger.log('アクション画像読込失敗: ' + e.message); }
  }
  return parts;
}

function consultProductGrowthMaika_(input, images) {
  input = input || {};
  const asin = pgAsin_(input.asin);
  const question = String(input.question || '').trim().slice(0, 3000);
  if (!question) throw new Error('マイカへの相談内容を入力してください。');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未設定');
  const settings = secGetSettings_();
  const daily = getProductGrowthData_(asin, 30, input.endDate || '');
  const monthly = getProductMonthlyData_(asin, 12, input.endPeriod || '');
  const actions = getProductActions_(asin, false).slice(0, 20);
  const snapshot = getListingSnapshot_(asin);
  const context = {
    product:{ asin:asin, title:monthly.title },
    daily_30d:daily,
    monthly_12m:monthly,
    latest_listing:snapshot ? {
      title:snapshot.title, bullets:snapshot.bullets, price:snapshot.price, rating:snapshot.rating,
      review_count:snapshot.review_count, brand:snapshot.brand, monthly_sold:snapshot.monthly_sold,
      dimensions:snapshot.dimensions, fees:snapshot.fees, checked_at:snapshot.checked_at
    } : null,
    recent_actions:actions.map(function(a) { return { action_at:a.action_at,action_type:a.action_type,title:a.title,hypothesis:a.hypothesis,action_detail:a.action_detail,status:a.status,result:a.result,tags:a.tags }; })
  };
  const prompt = [
    'あなたはAmazon物販事業HAKSAI Centralの秘書「' + settings.assistant_name + '」です。',
    'オーナーを「' + settings.owner_name + '」と呼び、' + settings.custom_instruction,
    '以下は一つの自社商品のカルテです。相談に、商品経営の実務家として答えてください。',
    'ルール:',
    '- 入力にない事実を作らない。事実・推定・提案を明確に分ける。',
    '- 日次値と月次値を混同しない。欠損は欠損として扱う。',
    '- 売上変化は可能なら セッション×CVR×平均単価、利益は粗利・広告費・在庫に分解する。',
    '- 添付画像がある場合、画像から読めた事実と解釈を分ける。',
    '- 数字の期間を明記し、実行可能な次の一手と評価方法を提案する。',
    'JSONだけを返す。形式:',
    '{"answer":"結論を含む読みやすい本文","facts":["根拠"],"hypotheses":["仮説"],"missing_information":["不足情報"],"recommended_action":{"action_type":"商品ページ改善|広告調整|価格変更|在庫・発注|レビュー対策|その他","title":"短いタイトル","hypothesis":"仮説","action_detail":"具体的な実施内容","expected_metric":"評価指標","expected_direction":"増加|減少|維持|検証","evaluation_days":7},"risks":["リスク"]}',
    '商品カルテ:', JSON.stringify(context),
    'オーナーの相談:', question
  ].join('\n');
  const parts = pgContextImageParts_(images, snapshot, actions);
  parts.push({ text:prompt });
  const model = GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const response = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY, {
    method:'post', contentType:'application/json', muteHttpExceptions:true,
    payload:JSON.stringify({ contents:[{ parts:parts }], generationConfig:{ temperature:0.25, maxOutputTokens:4096, responseMimeType:'application/json' } })
  });
  if (response.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 300));
  const parsed = JSON.parse(response.getContentText());
  const text = parsed.candidates[0].content.parts[0].text;
  const result = JSON.parse(String(text).replace(/```json|```/g, '').trim());
  result.asin = asin;
  result.generated_at = new Date().toISOString();
  result.context_summary = { daily_from:daily.from_date,daily_to:daily.to_date,monthly_from:monthly.from_period,monthly_to:monthly.to_period,actions:actions.length,images:parts.length - 1 };
  return result;
}

function pgConsultFolder_() {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID が未設定です。');
  const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const it = root.getFoldersByName('product_consultations');
  return it.hasNext() ? it.next() : root.createFolder('product_consultations');
}

function pgConsultObjects_() {
  const ref = pgEnsureSheet_(PG_CONSULT_SHEET, PG_CONSULT_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).map(function(row, i) {
    const obj = { _row:i + 2 };
    ref.headers.forEach(function(h, c) { obj[h] = row[c]; });
    obj.message_count = Number(obj.message_count) || 0;
    return obj;
  }).filter(function(x) { return x.session_id; });
}

function getProductConsultations_(asinValue) {
  const asin = pgAsin_(asinValue);
  return pgConsultObjects_().filter(function(x) { return String(x.asin).toUpperCase() === asin && x.status !== 'archived'; })
    .sort(function(a,b) { return String(b.updated_at).localeCompare(String(a.updated_at)); })
    .map(function(x) { delete x._row; return x; });
}

function pgReadConversationFile_(fileId) {
  if (!fileId) return null;
  try { return JSON.parse(DriveApp.getFileById(String(fileId)).getBlob().getDataAsString('UTF-8')); }
  catch (e) { throw new Error('相談履歴ファイルを読み込めません: ' + e.message); }
}

function getProductConsultation_(sessionId) {
  const id = String(sessionId || '').trim();
  const index = pgConsultObjects_().find(function(x) { return String(x.session_id) === id; });
  if (!index) throw new Error('相談セッションが見つかりません。');
  const conversation = pgReadConversationFile_(index.drive_file_id);
  if (!conversation) throw new Error('相談履歴が空です。');
  return conversation;
}

function pgWriteConversationFile_(conversation, fileId) {
  const text = JSON.stringify(conversation);
  if (text.length > 8 * 1024 * 1024) throw new Error('相談履歴が大きくなりすぎました。新しい相談を開始してください。');
  if (fileId) {
    DriveApp.getFileById(String(fileId)).setContent(text);
    return String(fileId);
  }
  const safeAsin = String(conversation.asin || 'unknown').replace(/[^A-Z0-9_-]/gi, '_');
  return pgConsultFolder_().createFile(Utilities.newBlob(text, 'application/json', safeAsin + '_' + conversation.session_id + '.json')).getId();
}

function pgUpsertConsultIndex_(conversation) {
  const ref = pgEnsureSheet_(PG_CONSULT_SHEET, PG_CONSULT_HEADERS);
  const rows = pgConsultObjects_();
  const found = rows.find(function(x) { return String(x.session_id) === String(conversation.session_id); });
  const record = {
    session_id:conversation.session_id,asin:conversation.asin,title:conversation.title || '商品相談',status:conversation.status || 'active',
    summary:conversation.summary || '',important_conclusion:conversation.important_conclusion || '',drive_file_id:conversation.drive_file_id,
    message_count:(conversation.messages || []).length,created_at:conversation.created_at,updated_at:conversation.updated_at
  };
  const row = ref.headers.map(function(h) { return record[h] !== undefined ? record[h] : ''; });
  if (found) ref.sheet.getRange(found._row, 1, 1, row.length).setValues([row]); else ref.sheet.appendRow(row);
}

function pgContextNotes_(asinValue) {
  const asin = pgAsin_(asinValue);
  const ref = pgEnsureSheet_(PG_CONTEXT_NOTE_SHEET, PG_CONTEXT_NOTE_HEADERS);
  const values = ref.sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).map(function(row) { const x={};ref.headers.forEach(function(h,i){x[h]=row[i];});return x; })
    .filter(function(x) { return String(x.asin || '').toUpperCase() === asin && String(x.status || 'active') === 'active'; })
    .sort(function(a,b) { return String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)); });
}

function saveProductContextNote_(input) {
  input = input || {};
  const asin = pgAsin_(input.asin);
  const content = String(input.content || '').trim().slice(0, 1000);
  if (!content) throw new Error('補足内容が空です。');
  const ref = pgEnsureSheet_(PG_CONTEXT_NOTE_SHEET, PG_CONTEXT_NOTE_HEADERS);
  const now = new Date().toISOString(), noteId = String(input.note_id || '').trim() || ('NOTE-' + Utilities.getUuid());
  const record = { note_id:noteId,asin:asin,note_type:String(input.note_type || 'user_reported_fact'),content:content,status:'active',source_session_id:String(input.source_session_id || ''),created_at:now,updated_at:now,resolved_at:'' };
  ref.sheet.appendRow(ref.headers.map(function(h) { return record[h] !== undefined ? record[h] : ''; }));
  return record;
}

function pgPercent_(value) { return value === null || value === undefined ? null : Number((Number(value) * 100).toFixed(2)); }

function pgAiMonthlyContext_(monthly) {
  return {
    asin:monthly.asin,title:monthly.title,from_period:monthly.from_period,to_period:monthly.to_period,
    points:monthly.points.map(function(p) { return {
      period:p.period,sales_yen:p.sales,units:p.units,returns:p.returns,gross_profit_yen:p.gross_profit,
      gross_margin_percent:pgPercent_(p.gross_margin),average_price_yen:p.average_price,
      ad_spend_yen:p.ad_spend,ad_sales_yen:p.ad_sales,acos_percent:pgPercent_(p.acos),roas:p.roas,
      tacos_percent:pgPercent_(p.tacos),profit_after_ad_yen:p.profit_after_ad,
      sessions:p.has_business ? p.sessions : null,page_views:p.has_business ? p.page_views : null,
      cvr_percent:p.has_business ? pgPercent_(p.cvr) : null,ordered_units:p.has_business ? p.ordered_units : null,
      inventory:p.inventory,actions:p.actions
    }; })
  };
}

function pgAiDailyContext_(daily) {
  return { asin:daily.asin,title:daily.title,from_date:daily.from_date,to_date:daily.to_date,totals:daily.totals,
    recent_days:daily.points.slice(-14).map(function(p){return{date:p.date,sales_yen:p.sales,units:p.units,gross_profit_yen:p.gross_profit,ad_spend_yen:p.ad_spend,ad_sales_yen:p.ad_sales};}) };
}

function pgConsultImageParts_(currentImages, conversation, snapshot) {
  const parts=[], max=6, maxBytes=12*1024*1024;let bytes=0;
  const add=function(base64,mime){if(!base64||parts.length>=max)return;const size=Math.floor(String(base64).length*.75);if(bytes+size>maxBytes)return;bytes+=size;parts.push({inlineData:{mimeType:mime||'image/jpeg',data:String(base64).replace(/^data:[^;]+;base64,/,'')}});};
  (Array.isArray(currentImages)?currentImages.slice(0,4):[]).forEach(function(img){add(img.base64,img.mimeType);});
  const prior=[];(conversation.messages||[]).slice(0,-1).reverse().forEach(function(m){(m.attachments||[]).forEach(function(a){if(prior.length<3&&a.file_id)prior.push(a);});});
  prior.forEach(function(a){if(parts.length>=max)return;try{const b=DriveApp.getFileById(a.file_id).getBlob();add(Utilities.base64Encode(b.getBytes()),b.getContentType());}catch(e){Logger.log('過去相談画像読込失敗: '+e.message);}});
  if(snapshot&&snapshot.image_urls&&snapshot.image_urls[0]&&parts.length<max)try{const b=UrlFetchApp.fetch(snapshot.image_urls[0]).getBlob();add(Utilities.base64Encode(b.getBytes()),b.getContentType());}catch(e){Logger.log('商品画像読込失敗: '+e.message);}
  return parts;
}

function pgToneInstruction_(settings) {
  const map={warm:'温かく親しみのある口調',crisp:'簡潔で端的な口調',playful:'明るく遊び心があるが、軽薄ではない口調',formal:'落ち着いた丁寧な口調'};
  return map[String(settings.tone||'')] || map.warm;
}

function sendProductConsultationMessage_(input, images) {
  input=input||{};images=Array.isArray(images)?images.slice(0,4):[];
  const asin=pgAsin_(input.asin), text=String(input.text||input.question||'').trim().slice(0,4000);
  if(!text)throw new Error('メッセージを入力してください。');
  if(!GEMINI_API_KEY)throw new Error('GEMINI_API_KEY 未設定');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    let index=null,conversation=null;const sessionId=String(input.session_id||'').trim();
    if(sessionId){index=pgConsultObjects_().find(function(x){return String(x.session_id)===sessionId;});if(!index)throw new Error('相談セッションが見つかりません。');if(String(index.asin).toUpperCase()!==asin)throw new Error('相談商品が一致しません。');conversation=pgReadConversationFile_(index.drive_file_id);}
    if(!conversation){const now=new Date().toISOString();conversation={session_id:'CONSULT-'+Utilities.getUuid(),asin:asin,title:'',status:'active',summary:'',important_conclusion:'',messages:[],created_at:now,updated_at:now,drive_file_id:''};}
    const imageIds=saveImagesToDrive_(images,conversation.session_id,'consult');
    if(imageIds.length!==images.length)throw new Error('相談画像のDrive保存に失敗しました。');
    const attachments=imageIds.map(function(id,i){return{file_id:id,name:images[i].originalName||('image_'+(i+1)),mime_type:images[i].mimeType||'image/jpeg'};});
    conversation.messages.push({message_id:'MSG-'+Utilities.getUuid(),role:'user',content:text,attachments:attachments,created_at:new Date().toISOString()});

    const settings=secGetSettings_(),daily=getProductGrowthData_(asin,30,input.endDate||''),monthly=getProductMonthlyData_(asin,12,input.endPeriod||''),actions=getProductActions_(asin,false).slice(0,20),snapshot=getListingSnapshot_(asin),notes=pgContextNotes_(asin).slice(0,20);
    const history=conversation.messages.slice(-10).map(function(m){return{role:m.role,content:m.content,created_at:m.created_at};});
    const context={settings:{lead_time_days:Number(settings.lead_time_days)||45},daily:pgAiDailyContext_(daily),monthly:pgAiMonthlyContext_(monthly),listing:snapshot?{title:snapshot.title,bullets:snapshot.bullets,price_yen:snapshot.price,rating:snapshot.rating,review_count:snapshot.review_count,monthly_sold:snapshot.monthly_sold,checked_at:snapshot.checked_at}:null,recent_actions:actions.map(function(a){return{action_at:a.action_at,action_type:a.action_type,title:a.title,hypothesis:a.hypothesis,detail:a.action_detail,status:a.status,result:a.result};}),product_notes:notes.map(function(n){return{note_type:n.note_type,content:n.content,created_at:n.created_at};})};
    const prompt=[
      'あなたはAmazon物販事業HAKSAI Centralの秘書「'+settings.assistant_name+'」。ガッキーの仕事を長く隣で見てきた相談相手です。',
      'オーナーを「'+settings.owner_name+'」と呼ぶ。口調は'+pgToneInstruction_(settings)+'。',
      '人格設定: '+settings.custom_instruction,
      'これは一回完結の診断ではなく継続会話です。ガッキーの反論や補足で前提が変わったら、以前の結論に固執せず、何が変わったかを明示してください。',
      '商品相談専用ルール:',
      '- 一般論より「この商品で何が起きているか」を話す。過去アクションとガッキーの判断過程を尊重する。',
      '- シートとガッキーの発言が食い違う場合は両方を明示し、会話中の最新補足を今回の前提にする。ただし正本データが更新済みとは断定しない。',
      '- 前回回答を繰り返さず、新情報によって結論がどう変わったかを話す。重要な不足情報がある場合だけ一度に一つ質問する。',
      '- どの商品にも使える定型文だけで終わらない。画像がある場合は画像固有の事実へ触れる。',
      '- 複数案を短く比較し、なぜ推奨案なのか、なぜ他案ではないのかを説明する。',
      '- 数値キーの *_percent は既に百分率。cvr_percent=58.73 は58.73%であり0.5873%ではない。*_yenは円。',
      '- 事実、ユーザー申告、推定、提案を混ぜない。入力にない事実を作らない。',
      'JSONのみ。形式:',
      '{"maika_message":"自然な会話本文","analysis":{"facts":[],"hypotheses":[],"alternatives":[],"missing_information":[],"risks":[]},"recommended_action":nullまたは{"action_type":"商品ページ改善|広告調整|価格変更|在庫・発注|レビュー対策|その他","title":"","hypothesis":"","action_detail":"","expected_metric":"","expected_direction":"増加|減少|維持|検証","evaluation_days":7},"detected_notes":[{"note_type":"user_reported_fact","content":"今後も覚える価値があるユーザー補足"}],"conversation_summary":"ここまでの会話を300字以内で更新","important_conclusion":"現時点の結論を150字以内","session_title":"相談タイトル"}',
      '過去会話の要約: '+String(conversation.summary||''),
      '直近会話: '+JSON.stringify(history),
      '最新商品コンテキスト: '+JSON.stringify(context),
      '最後のユーザーメッセージ: '+text
    ].join('\n');
    const parts=pgConsultImageParts_(images,conversation,snapshot);parts.push({text:prompt});
    const model=GEMINI_MODEL||'gemini-3.1-flash-lite';
    const response=UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+GEMINI_API_KEY,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({contents:[{parts:parts}],generationConfig:{temperature:0.5,maxOutputTokens:4096,responseMimeType:'application/json'}})});
    if(response.getResponseCode()!==200)throw new Error('Gemini HTTP '+response.getResponseCode()+': '+response.getContentText().slice(0,300));
    const parsed=JSON.parse(response.getContentText()),raw=parsed.candidates[0].content.parts[0].text,result=JSON.parse(String(raw).replace(/```json|```/g,'').trim());
    const assistantMessage={message_id:'MSG-'+Utilities.getUuid(),role:'assistant',content:String(result.maika_message||''),analysis:result.analysis||{},recommended_action:result.recommended_action||null,detected_notes:Array.isArray(result.detected_notes)?result.detected_notes:[],created_at:new Date().toISOString()};
    conversation.messages.push(assistantMessage);conversation.summary=String(result.conversation_summary||conversation.summary||'').slice(0,1000);conversation.important_conclusion=String(result.important_conclusion||'').slice(0,500);conversation.title=String(result.session_title||conversation.title||text.slice(0,40)).slice(0,80);conversation.updated_at=new Date().toISOString();
    conversation.drive_file_id=pgWriteConversationFile_(conversation,conversation.drive_file_id||(index&&index.drive_file_id));pgUpsertConsultIndex_(conversation);
    return {session_id:conversation.session_id,title:conversation.title,summary:conversation.summary,message:assistantMessage,message_count:conversation.messages.length,updated_at:conversation.updated_at,context_summary:{notes:notes.length,history:history.length,images:parts.length-1}};
  } finally { lock.releaseLock(); }
}

/**
 * Keepa関連機能の稼働状況を読み取り専用で監査する。
 *
 * Apps Scriptエディタから auditKeepaOperations() を実行する。
 * シート・トリガー・プロパティは一切変更せず、結果を実行ログへJSONで出力する。
 */

const KOA_VERSION = '2026-07-18.v1';
const KOA_KEEP_HANDLERS = [
  'runKeepaBatch',
  'runKeepaStage1_5',
  'autoSetKeepaStatus',
  'runKeepaStage2',
  'runSellerStorefrontBatch'
];

function auditKeepaOperations() {
  const now = new Date();
  const separation = koaReadSeparationState_();
  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );
  const triggers = koaReadTriggers_();
  const candidates = koaAuditCandidates_(ss, now);
  const schedules = koaAuditSchedule_(ss);
  const sellers = koaAuditSellers_(ss, now);
  const listingSnapshots = koaAuditSimpleSheet_(ss, 'listing_snapshots', ['checked_at', 'captured_at'], 'own_asin', 'source', now);
  const marketHistory = koaAuditMarketHistory_(ss, now);
  const historyTrial = koaAuditSimpleSheet_(ss, 'keepa_history_trial_preview', ['fetched_at'], 'asin', 'request_kind', now);
  const lifecycle = koaAuditLifecycle_(ss, now);
  const token = koaReadTokenState_();

  let systems = [
    koaSystem_('product_finder_discovery', 'Keepa Product Finder 自動候補収集', triggers, 'runKeepaBatch', candidates.latest_legacy_fetched_at, candidates.legacy_source_rows, candidates.total_rows, now),
    koaSystem_('title_brand_enrichment', 'Stage 1.5 タイトル・ブランド補完', triggers, 'runKeepaStage1_5', candidates.latest_fetched_at, candidates.total_rows - candidates.missing_title, candidates.total_rows, now),
    koaSystem_('automatic_status', 'キーワードルールによる自動GO/NG', triggers, 'autoSetKeepaStatus', '', candidates.rows_with_status_reason, candidates.total_rows, now),
    koaSystem_('stage2_scoring', 'Stage 2 詳細取得・簡易スコア', triggers, 'runKeepaStage2', candidates.latest_fetched_at, candidates.rows_with_score, candidates.go_rows, now),
    koaSystem_('seller_storefront', '競合セラーストアフロント収集', triggers, 'runSellerStorefrontBatch', sellers.latest_fetched_at, candidates.seller_source_rows, sellers.total_rows, now),
    koaOnDemandSystem_('listing_snapshot', '商品カルテ Keepaページスナップショット', listingSnapshots.latest_at, listingSnapshots.rows_30d, listingSnapshots.total_rows, now),
    koaOnDemandSystem_('market_history', '商品カルテ Keepa市場履歴', marketHistory.latest_at, marketHistory.rows_30d, marketHistory.total_rows, now),
    {
      key: 'competitor_and_ad_hoc',
      label: '競合分析・広告ターゲット探索',
      classification: '不明',
      reason: '永続実行ログがないため、コードの存在だけでは利用実績を判定できません。',
      trigger_count: 0,
      latest_evidence_at: ''
    }
  ];

  if (separation.active) {
    systems = systems.map(function(system, index) {
      if (index > 4) return system;
      system.classification = '分離済み';
      system.reason = '旧自動リサーチは別スプレッドシートへアーカイブされ、本番ブックから切り離されています。';
      system.trigger_count = 0;
      return system;
    });
  }

  const warnings = koaWarnings_(triggers, candidates, schedules, sellers, marketHistory, token, separation);
  const recommendations = koaRecommendations_(systems, warnings, candidates, schedules);
  const report = {
    audit_version: KOA_VERSION,
    generated_at: now.toISOString(),
    read_only: true,
    legacy_pipeline_separation: separation,
    summary: koaSummary_(systems, triggers, candidates, listingSnapshots, marketHistory, token),
    systems: systems,
    triggers: triggers,
    sheets: {
      keepa_research_candidates: candidates,
      keepa_batch_schedule: schedules,
      keepa_seller_master: sellers,
      listing_snapshots: listingSnapshots,
      product_market_history_index: marketHistory,
      keepa_history_trial_preview: historyTrial,
      product_lifecycle_keepa_usage: lifecycle
    },
    keepa_token: token,
    warnings: warnings,
    recommendations: recommendations,
    limitations: [
      'ScriptAppからはトリガーの登録有無と種類は取得できますが、直近の成功・失敗実行履歴は取得できません。',
      'Stage 1.5、Stage 2、自動ステータスは行ごとの更新日時を保存していないため、最終成功日時を厳密には判定できません。',
      '競合分析と広告ターゲット探索は専用実行ログを保存していないため、現在の利用頻度は判定できません。'
    ]
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function koaReadTriggers_() {
  const rows = ScriptApp.getProjectTriggers().map(function(trigger) {
    const handler = koaSafeCall_(function() { return trigger.getHandlerFunction(); });
    return {
      handler: handler,
      event_type: koaSafeCall_(function() { return trigger.getEventType(); }),
      trigger_source: koaSafeCall_(function() { return trigger.getTriggerSource(); }),
      source_id: koaSafeCall_(function() { return trigger.getTriggerSourceId(); }),
      unique_id: koaSafeCall_(function() { return trigger.getUniqueId(); }),
      keepa_related: KOA_KEEP_HANDLERS.indexOf(handler) >= 0 || /keepa/i.test(handler)
    };
  });
  const byHandler = {};
  rows.forEach(function(row) { byHandler[row.handler] = (byHandler[row.handler] || 0) + 1; });
  return {
    total_count: rows.length,
    keepa_trigger_count: rows.filter(function(row) { return row.keepa_related; }).length,
    by_handler: byHandler,
    keepa_triggers: rows.filter(function(row) { return row.keepa_related; })
  };
}

function koaSafeCall_(callback) {
  try {
    const value = callback();
    return value === null || value === undefined ? '' : String(value);
  } catch (e) {
    return '';
  }
}

function koaSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return { exists:false, name:name, headers:[], rows:[], duplicate_headers:[] };
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { exists:true, name:name, headers:[], rows:[], duplicate_headers:[] };
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const seen = {}, duplicateHeaders = [];
  headers.forEach(function(header) {
    if (!header) return;
    if (seen[header] && duplicateHeaders.indexOf(header) < 0) duplicateHeaders.push(header);
    seen[header] = true;
  });
  const rows = values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== '' && value !== null; });
  }).map(function(row) {
    const obj = {};
    headers.forEach(function(header, index) { if (header) obj[header] = row[index]; });
    return obj;
  });
  return { exists:true, name:name, headers:headers.filter(Boolean), rows:rows, duplicate_headers:duplicateHeaders };
}

function koaAuditCandidates_(ss, now) {
  const data = koaSheet_(ss, 'keepa_research_candidates');
  if (!data.exists) return {
    exists:false, total_rows:0, unique_asins:0, duplicate_asin_rows:0,
    latest_fetched_at:'', latest_fetched_days_ago:null, latest_legacy_fetched_at:'',
    status_counts:{}, source_counts:{}, missing_title:0, missing_brand:0, go_rows:0,
    go_pending_score:0, rows_with_score:0, rows_with_status_reason:0,
    offer_count_blank:0, offer_count_zero:0, fba_count_blank:0, fba_count_zero:0,
    seller_source_rows:0, legacy_source_rows:0, headers:[], duplicate_headers:[]
  };
  const statusCounts = {}, sourceCounts = {}, asinCounts = {};
  let missingTitle = 0, missingBrand = 0, goRows = 0, goPendingScore = 0;
  let rowsWithScore = 0, rowsWithStatusReason = 0;
  let offerBlank = 0, offerZero = 0, fbaBlank = 0, fbaZero = 0;
  let sellerRows = 0, legacyRows = 0;
  let latest = null, latestLegacy = null;
  data.rows.forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    if (asin) asinCounts[asin] = (asinCounts[asin] || 0) + 1;
    const status = String(row.status || '').trim() || '(blank)';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const rawSource = String(row.source || row.source_pipeline || '').trim();
    const source = rawSource || 'legacy_product_finder';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    if (!String(row.title || '').trim()) missingTitle++;
    if (!String(row.brand || '').trim()) missingBrand++;
    if (status === 'GO') {
      goRows++;
      if (koaBlank_(row.score)) goPendingScore++;
    }
    if (!koaBlank_(row.score)) rowsWithScore++;
    if (String(row.status_reason || '').trim()) rowsWithStatusReason++;
    if (koaBlank_(row.offer_count)) offerBlank++; else if (Number(row.offer_count) === 0) offerZero++;
    if (koaBlank_(row.fba_count)) fbaBlank++; else if (Number(row.fba_count) === 0) fbaZero++;
    if (rawSource === 'seller_storefront') sellerRows++;
    if (!rawSource) legacyRows++;
    const fetched = koaDate_(row.fetched_at);
    if (fetched && (!latest || fetched > latest)) latest = fetched;
    if (!rawSource && fetched && (!latestLegacy || fetched > latestLegacy)) latestLegacy = fetched;
  });
  const duplicateRows = Object.keys(asinCounts).reduce(function(sum, asin) { return sum + Math.max(0, asinCounts[asin] - 1); }, 0);
  return {
    exists:true,
    total_rows:data.rows.length,
    unique_asins:Object.keys(asinCounts).length,
    duplicate_asin_rows:duplicateRows,
    latest_fetched_at:koaIso_(latest),
    latest_fetched_days_ago:koaDaysAgo_(latest, now),
    latest_legacy_fetched_at:koaIso_(latestLegacy),
    latest_legacy_fetched_days_ago:koaDaysAgo_(latestLegacy, now),
    status_counts:statusCounts,
    source_counts:sourceCounts,
    missing_title:missingTitle,
    missing_brand:missingBrand,
    go_rows:goRows,
    go_pending_score:goPendingScore,
    rows_with_score:rowsWithScore,
    rows_with_status_reason:rowsWithStatusReason,
    offer_count_blank:offerBlank,
    offer_count_zero:offerZero,
    fba_count_blank:fbaBlank,
    fba_count_zero:fbaZero,
    seller_source_rows:sellerRows,
    legacy_source_rows:legacyRows,
    headers:data.headers,
    duplicate_headers:data.duplicate_headers
  };
}

function koaAuditSchedule_(ss) {
  const data = koaSheet_(ss, 'keepa_batch_schedule');
  if (!data.exists) return { exists:false, total_rows:0, hours:[], duplicate_hours:[], invalid_selection_json:0, headers:[] };
  const hours = [], counts = {};
  let invalid = 0;
  data.rows.forEach(function(row) {
    const hour = String(row.hour === undefined ? '' : row.hour).trim();
    if (hour) { hours.push(hour); counts[hour] = (counts[hour] || 0) + 1; }
    try { JSON.parse(String(row.selection_json || '')); } catch (e) { invalid++; }
  });
  return {
    exists:true,
    total_rows:data.rows.length,
    hours:hours,
    duplicate_hours:Object.keys(counts).filter(function(hour) { return counts[hour] > 1; }),
    invalid_selection_json:invalid,
    headers:data.headers,
    duplicate_headers:data.duplicate_headers
  };
}

function koaAuditSellers_(ss, now) {
  const data = koaSheet_(ss, 'keepa_seller_master');
  if (!data.exists) return { exists:false, total_rows:0, status_counts:{}, pending_rows:0, latest_fetched_at:'', latest_fetched_days_ago:null, headers:[] };
  const statuses = {};
  let latest = null;
  data.rows.forEach(function(row) {
    const status = String(row.status || '').trim() || '(blank)';
    statuses[status] = (statuses[status] || 0) + 1;
    const date = koaDate_(row.last_fetched_at);
    if (date && (!latest || date > latest)) latest = date;
  });
  return {
    exists:true,
    total_rows:data.rows.length,
    status_counts:statuses,
    pending_rows:Number(statuses['未取得'] || 0),
    latest_fetched_at:koaIso_(latest),
    latest_fetched_days_ago:koaDaysAgo_(latest, now),
    headers:data.headers,
    duplicate_headers:data.duplicate_headers
  };
}

function koaAuditSimpleSheet_(ss, name, dateFields, asinField, groupField, now) {
  const data = koaSheet_(ss, name);
  if (!data.exists) return { exists:false, total_rows:0, unique_asins:0, latest_at:'', latest_days_ago:null, rows_7d:0, rows_30d:0, group_counts:{}, headers:[] };
  const asins = {}, groups = {};
  let latest = null, rows7 = 0, rows30 = 0;
  data.rows.forEach(function(row) {
    const asin = String(row[asinField] || '').trim().toUpperCase();
    if (asin) asins[asin] = true;
    const group = String(row[groupField] || '').trim() || '(blank)';
    groups[group] = (groups[group] || 0) + 1;
    let date = null;
    dateFields.some(function(field) { date = koaDate_(row[field]); return !!date; });
    if (date) {
      if (!latest || date > latest) latest = date;
      const age = koaDaysAgo_(date, now);
      if (age !== null && age <= 7) rows7++;
      if (age !== null && age <= 30) rows30++;
    }
  });
  return {
    exists:true,
    total_rows:data.rows.length,
    unique_asins:Object.keys(asins).length,
    latest_at:koaIso_(latest),
    latest_days_ago:koaDaysAgo_(latest, now),
    rows_7d:rows7,
    rows_30d:rows30,
    group_counts:groups,
    headers:data.headers,
    duplicate_headers:data.duplicate_headers
  };
}

function koaAuditMarketHistory_(ss, now) {
  const base = koaAuditSimpleSheet_(ss, 'product_market_history_index', ['checked_at'], 'asin', 'status', now);
  if (!base.exists) return base;
  const data = koaSheet_(ss, 'product_market_history_index');
  let tokens = 0, points = 0;
  data.rows.forEach(function(row) {
    tokens += Number(row.tokens_consumed) || 0;
    points += Number(row.point_count) || 0;
  });
  base.tokens_consumed_recorded = tokens;
  base.point_count_recorded = points;
  return base;
}

function koaAuditLifecycle_(ss, now) {
  const data = koaSheet_(ss, 'product_lifecycle');
  if (!data.exists) return { exists:false, total_rows:0, rows_with_keepa_data:0, keepa_usage_rate:0, latest_keepa_card_updated_at:'', source_counts:{} };
  let withKeepa = 0, latest = null;
  const sources = {};
  data.rows.forEach(function(row) {
    const raw = row.keepa_data;
    const hasKeepa = raw && String(raw).trim() !== '' && String(raw).trim() !== '{}' && String(raw).trim() !== '[]';
    if (!hasKeepa) return;
    withKeepa++;
    const source = String(row.source || '').trim() || '(blank)';
    sources[source] = (sources[source] || 0) + 1;
    const date = koaDate_(row.updated_at);
    if (date && (!latest || date > latest)) latest = date;
  });
  return {
    exists:true,
    total_rows:data.rows.length,
    rows_with_keepa_data:withKeepa,
    keepa_usage_rate:data.rows.length ? Number((withKeepa / data.rows.length).toFixed(3)) : 0,
    latest_keepa_card_updated_at:koaIso_(latest),
    latest_keepa_card_updated_days_ago:koaDaysAgo_(latest, now),
    source_counts:sources
  };
}

function koaReadTokenState_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('KEEPA_API_KEY');
  if (!apiKey) return { configured:false, checked:false, error:'KEEPA_API_KEY が未設定です。' };
  try {
    const response = UrlFetchApp.fetch('https://api.keepa.com/token?key=' + encodeURIComponent(apiKey), { muteHttpExceptions:true });
    const code = response.getResponseCode();
    const json = JSON.parse(response.getContentText() || '{}');
    if (code !== 200) return { configured:true, checked:true, http_status:code, error:String(json.error || response.getContentText()).slice(0, 300) };
    return {
      configured:true,
      checked:true,
      http_status:code,
      tokens_left:Number(json.tokensLeft || 0),
      refill_in_ms:Number(json.refillIn || 0),
      refill_rate:Number(json.refillRate || 0),
      timestamp:json.timestamp || ''
    };
  } catch (e) {
    return { configured:true, checked:false, error:e.message };
  }
}

function koaSystem_(key, label, triggers, handler, latestAt, processedRows, denominator, now) {
  const triggerCount = Number(triggers.by_handler[handler] || 0);
  const latest = koaDate_(latestAt);
  const age = koaDaysAgo_(latest, now);
  let classification = '不明', reason = '登録トリガーも更新日時の証拠も確認できません。';
  if (triggerCount > 0 && age !== null && age <= 7) {
    classification = '現役'; reason = '登録トリガーがあり、7日以内のデータ更新証拠があります。';
  } else if (triggerCount > 0) {
    classification = '登録あり・要確認'; reason = 'トリガーはありますが、最近の成功を日時から確認できません。';
  } else if (age !== null && age <= 30) {
    classification = '補助'; reason = 'トリガーはありませんが、30日以内の更新証拠があります。手動または別経路で利用されています。';
  } else if (Number(processedRows || 0) > 0 || Number(denominator || 0) > 0) {
    classification = '休眠'; reason = '保存データはありますが、現在の自動実行または最近の更新を確認できません。';
  }
  return {
    key:key, label:label, handler:handler, classification:classification, reason:reason,
    trigger_count:triggerCount, latest_evidence_at:koaIso_(latest), latest_evidence_days_ago:age,
    processed_or_evidence_rows:Number(processedRows || 0), target_or_total_rows:Number(denominator || 0)
  };
}

function koaOnDemandSystem_(key, label, latestAt, recentRows, totalRows, now) {
  const latest = koaDate_(latestAt), age = koaDaysAgo_(latest, now);
  let classification = '不明', reason = '保存データがありません。';
  if (age !== null && age <= 30) { classification = '現役'; reason = '30日以内に画面または手動操作から取得されています。'; }
  else if (Number(totalRows || 0) > 0) { classification = '休眠'; reason = '保存データはありますが、30日以内の更新がありません。'; }
  return { key:key, label:label, classification:classification, reason:reason, trigger_count:0, latest_evidence_at:koaIso_(latest), latest_evidence_days_ago:age, rows_30d:Number(recentRows || 0), total_rows:Number(totalRows || 0) };
}

function koaWarnings_(triggers, candidates, schedules, sellers, marketHistory, token, separation) {
  const out = [];
  if (!candidates.exists && !separation.active) out.push({ severity:'high', code:'candidate_sheet_missing', message:'keepa_research_candidates が存在しません。' });
  if (candidates.duplicate_headers && candidates.duplicate_headers.length) out.push({ severity:'high', code:'candidate_duplicate_headers', message:'候補シートに重複ヘッダーがあります。', values:candidates.duplicate_headers });
  if (candidates.duplicate_asin_rows > 0) out.push({ severity:'medium', code:'candidate_duplicate_asins', message:'候補シートに重複ASIN行があります。', count:candidates.duplicate_asin_rows });
  if (candidates.go_pending_score > 0) out.push({ severity:'medium', code:'stage2_pending', message:'GO判定済みでStage 2未処理の候補があります。', count:candidates.go_pending_score });
  if (candidates.offer_count_zero > 0) out.push({ severity:'high', code:'offer_count_unreliable', message:'現行Stage 2はoffersを取得せずoffer_countを数えるため、0が実測値とは限りません。', zero_rows:candidates.offer_count_zero, blank_rows:candidates.offer_count_blank });
  if (candidates.fba_count_zero > 0) out.push({ severity:'high', code:'fba_count_not_measured', message:'現行Stage 2のfba_countは0固定です。0を実測値として利用しないでください。', zero_rows:candidates.fba_count_zero, blank_rows:candidates.fba_count_blank });
  if ((!schedules.exists || schedules.total_rows === 0) && !separation.active) out.push({ severity:'medium', code:'schedule_missing', message:'Keepa Product Finderの時間別スケジュールがありません。' });
  if (schedules.invalid_selection_json > 0) out.push({ severity:'high', code:'schedule_invalid_json', message:'selection_jsonを解析できないスケジュールがあります。', count:schedules.invalid_selection_json });
  if ((triggers.by_handler.runKeepaStage2 || 0) > 0 && (triggers.by_handler.runSellerStorefrontBatch || 0) > 0) out.push({ severity:'medium', code:'minute45_contention', message:'Stage 2とセラーバッチがどちらも45分付近に設定される設計です。トークン・実行時間の競合に注意してください。' });
  if ((triggers.by_handler.runKeepaBatch || 0) > 0 && (triggers.by_handler.runKeepaBatch || 0) !== 10) out.push({ severity:'low', code:'finder_trigger_count_unexpected', message:'setupKeepaHourlyTriggersの設計値は10本ですが、登録数が異なります。', count:triggers.by_handler.runKeepaBatch });
  if (sellers.pending_rows > 0 && !(triggers.by_handler.runSellerStorefrontBatch || 0)) out.push({ severity:'medium', code:'seller_pending_without_trigger', message:'未取得セラーがありますが、セラーバッチのトリガーがありません。', count:sellers.pending_rows });
  if (!token.configured || token.error) out.push({ severity:'high', code:'token_unavailable', message:token.error || 'Keepaトークン状態を確認できません。' });
  if (marketHistory.exists && marketHistory.group_counts && marketHistory.group_counts.error) out.push({ severity:'medium', code:'market_history_errors', message:'市場履歴インデックスにエラー行があります。', count:marketHistory.group_counts.error });
  return out;
}

function koaReadSeparationState_() {
  const props = PropertiesService.getScriptProperties();
  const archiveId = props.getProperty('LEGACY_KEEPA_ARCHIVE_SPREADSHEET_ID') || '';
  const archiveUrl = props.getProperty('LEGACY_KEEPA_ARCHIVE_URL') || '';
  const separatedAt = props.getProperty('LEGACY_KEEPA_SEPARATED_AT') || '';
  return {
    active:!!archiveId,
    archive_spreadsheet_id:archiveId,
    archive_url:archiveUrl,
    separated_at:separatedAt,
    version:props.getProperty('LEGACY_KEEPA_SEPARATION_VERSION') || ''
  };
}

function koaRecommendations_(systems, warnings, candidates, schedules) {
  const out = [];
  if (warnings.some(function(w) { return w.code === 'offer_count_unreliable' || w.code === 'fba_count_not_measured'; })) {
    out.push({ priority:1, action:'Stage 2のoffer_count・fba_countを判断材料から外す', reason:'未取得値が0として保存されており、スコアを誤らせる可能性があります。' });
  }
  const registeredUnproven = systems.filter(function(system) { return system.classification === '登録あり・要確認'; });
  if (registeredUnproven.length) out.push({ priority:2, action:'登録済みだが成功未確認のトリガーを実行履歴画面で確認する', targets:registeredUnproven.map(function(x) { return x.handler; }) });
  if (candidates.go_pending_score > 0) out.push({ priority:3, action:'GOかつ未採点候補を確認する', count:candidates.go_pending_score, note:'Stage 2の数値不具合を直すまでは一括実行しません。' });
  if (schedules.invalid_selection_json > 0) out.push({ priority:4, action:'壊れたKeepaスケジュールJSONを修正する', count:schedules.invalid_selection_json });
  out.push({ priority:5, action:'監査結果を見て各処理を現役・補助・休眠・廃止候補へ最終分類する', reason:'この関数は削除・停止・再実行を行いません。' });
  return out.sort(function(a, b) { return a.priority - b.priority; });
}

function koaSummary_(systems, triggers, candidates, snapshots, history, token) {
  const counts = {};
  systems.forEach(function(system) { counts[system.classification] = (counts[system.classification] || 0) + 1; });
  return {
    classification_counts:counts,
    keepa_trigger_count:triggers.keepa_trigger_count,
    candidate_rows:candidates.total_rows,
    candidate_unique_asins:candidates.unique_asins,
    go_rows:candidates.go_rows,
    go_pending_score:candidates.go_pending_score,
    listing_snapshot_asins:snapshots.unique_asins,
    market_history_asins:history.unique_asins,
    tokens_left:token.tokens_left === undefined ? null : token.tokens_left
  };
}

function koaBlank_(value) {
  return value === '' || value === null || value === undefined;
}

function koaDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function koaIso_(date) {
  return date && !isNaN(date.getTime()) ? date.toISOString() : '';
}

function koaDaysAgo_(date, now) {
  if (!date || isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

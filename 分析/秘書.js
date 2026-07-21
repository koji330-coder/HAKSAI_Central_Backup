/** HAKSAI Central 秘書 — ルール検出、Gemini整形、カード・設定・記憶管理 */
const SEC_MAX_CARDS_DEFAULT = 20;
const SEC_LEAD_TIME_DEFAULT = 45;
const SEC_SETTINGS_SHEET = 'secretary_settings';
const SEC_CARDS_SHEET = 'action_cards';
const SEC_RUN_LOG_SHEET = 'sec_run_log';
const SEC_CARD_HEADERS = [
  'card_id','created_date','priority','category','asin','title','body','next_action',
  'route','impact_note','status','status_updated_at','dismiss_reason','snooze_until',
  'event_key','event_fingerprint','source_detail','facts_json',
  'source','review_run_id','dedupe_key','evidence_json','why_now','uncertainties_json'
];
const SEC_RUN_LOG_HEADERS = [
  'run_at','run_kind','detected','eligible','generated','mode','dropped_keys_json',
  'detected_by_type_json','duration_ms','error'
];

function secRows_(name) {
  const reportNames = new Set(['business_report_period', 'ad_product_daily', 'inventory_snapshot']);
  const ss = reportNames.has(name) ? getReportSpreadsheet_() : getSpreadsheet_();
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function(row) {
    return Object.fromEntries(headers.map(function(key, i) { return [key, row[i]]; }));
  });
}

function secNum_(value) {
  const n = Number(String(value == null ? '' : value).replace(/[%,\s]/g, ''));
  return isFinite(n) ? n : 0;
}

function secDate_(value) {
  if (typeof apDate_ === 'function') return apDate_(value);
  if (value instanceof Date) return value;
  const match = String(value || '').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return match ? new Date(+match[1], +match[2] - 1, +match[3]) : new Date(value);
}

function secJson_(value, fallback) {
  fallback = fallback === undefined ? {} : fallback;
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (error) { return fallback; }
}

function secToday_(date) {
  return Utilities.formatDate(date || new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function secHash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ''));
  return bytes.slice(0, 8).map(function(b) { return (b + 256).toString(16).slice(-2); }).join('');
}

function secEnsureCardsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SEC_CARDS_SHEET);
  if (!sh) sh = ss.insertSheet(SEC_CARDS_SHEET);
  const current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  if (!current.some(Boolean)) {
    sh.getRange(1, 1, 1, SEC_CARD_HEADERS.length).setValues([SEC_CARD_HEADERS]);
  } else {
    SEC_CARD_HEADERS.forEach(function(header) {
      if (current.indexOf(header) < 0) {
        sh.getRange(1, current.length + 1).setValue(header);
        current.push(header);
      }
    });
  }
  return sh;
}

function secEnsureRunLogSheet_() {
  const ss = getReportSpreadsheet_();
  let sh = ss.getSheetByName(SEC_RUN_LOG_SHEET);
  if (!sh) sh = ss.insertSheet(SEC_RUN_LOG_SHEET);
  const current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  if (!current.some(Boolean)) {
    sh.getRange(1, 1, 1, SEC_RUN_LOG_HEADERS.length).setValues([SEC_RUN_LOG_HEADERS]);
  } else {
    SEC_RUN_LOG_HEADERS.forEach(function(header) {
      if (current.indexOf(header) < 0) {
        sh.getRange(1, current.length + 1).setValue(header);
        current.push(header);
      }
    });
  }
  return sh;
}

function secAppendRunLog_(entry) {
  try {
    entry = entry || {};
    const sh = secEnsureRunLogSheet_();
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const rowObj = {
      run_at: entry.run_at || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
      run_kind: entry.run_kind || 'auto',
      detected: secNum_(entry.detected),
      eligible: secNum_(entry.eligible),
      generated: secNum_(entry.generated),
      mode: entry.mode || '',
      dropped_keys_json: JSON.stringify(entry.dropped_keys || []),
      detected_by_type_json: JSON.stringify(entry.detected_by_type || {}),
      duration_ms: secNum_(entry.duration_ms),
      error: String(entry.error || '').slice(0, 300)
    };
    const row = headers.map(function(header) {
      return Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : '';
    });
    const targetRow = sh.getLastRow() + 1;
    const runAtCol = headers.indexOf('run_at');
    if (runAtCol >= 0) sh.getRange(targetRow, runAtCol + 1).setNumberFormat('@STRING@');
    sh.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  } catch (error) {
    Logger.log('sec_run_log 追記失敗: ' + error);
  }
}

function secDefaultSettings_() {
  return {
    assistant_name: 'ハク', owner_name: 'オーナー', tone: 'warm',
    custom_instruction: '率直で気が利く。数字を根拠に、次の一手を短く伝える。',
    max_cards: SEC_MAX_CARDS_DEFAULT, lead_time_days: SEC_LEAD_TIME_DEFAULT,
    min_ad_spend: 500, policy_version: 1, updated_at: ''
  };
}

function secSettingsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SEC_SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SEC_SETTINGS_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
    const defaults = secDefaultSettings_();
    const rows = Object.keys(defaults).map(function(key) { return [key, String(defaults[key])]; });
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  return sh;
}

function secGetSettings_() {
  const settings = secDefaultSettings_();
  const sh = secSettingsSheet_();
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function(row) {
      if (row[0]) settings[String(row[0])] = row[1];
    });
  }
  settings.max_cards = Math.max(1, Math.min(100, secNum_(settings.max_cards) || SEC_MAX_CARDS_DEFAULT));
  settings.lead_time_days = Math.max(1, secNum_(settings.lead_time_days) || SEC_LEAD_TIME_DEFAULT);
  settings.min_ad_spend = Math.max(0, secNum_(settings.min_ad_spend));
  settings.policy_version = Math.max(1, secNum_(settings.policy_version) || 1);
  return settings;
}

function secSaveSettings_(incoming) {
  incoming = incoming || {};
  const allowed = ['assistant_name','owner_name','tone','custom_instruction','max_cards','lead_time_days','min_ad_spend'];
  const current = secGetSettings_();
  allowed.forEach(function(key) {
    if (incoming[key] !== undefined) current[key] = String(incoming[key]).trim();
  });
  current.assistant_name = current.assistant_name.slice(0, 20) || 'ハク';
  current.owner_name = current.owner_name.slice(0, 20) || 'オーナー';
  current.custom_instruction = current.custom_instruction.slice(0, 500);
  current.max_cards = Math.max(1, Math.min(100, secNum_(current.max_cards) || 20));
  current.lead_time_days = Math.max(1, Math.min(180, secNum_(current.lead_time_days) || 45));
  current.min_ad_spend = Math.max(0, secNum_(current.min_ad_spend));
  current.policy_version = secNum_(current.policy_version) + 1;
  current.updated_at = new Date().toISOString();
  const sh = secSettingsSheet_();
  const rows = Object.keys(current).map(function(key) { return [key, String(current[key])]; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return current;
}

function secDetectEvents_() {
  const settings = secGetSettings_();
  const events = [];
  const names = {};
  const homeStock = secHomeStockMap_();
  const lifecycleRows = secRows_('product_lifecycle');
  lifecycleRows.forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    if (!asin) return;
    names[asin] = {
      title: String(row.title || '').slice(0, 40),
      subtitle: String(row.subtitle || '').trim().slice(0, 50),
      parent_asin: String(row.parent_asin || '').trim(),
      sim: typeof csaParseJsonObject_ === 'function' ? csaParseJsonObject_(row.cost_simulation) : {}
    };
  });

  const latest = {};
  secRows_('inventory_snapshot').forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    const date = secDate_(row.snapshot_date);
    if (!asin || !date || isNaN(date.getTime())) return;
    if (!latest[asin] || date > latest[asin]._date) latest[asin] = { _date: date, row: row };
  });
  Object.keys(latest).forEach(function(asin) {
    const row = latest[asin].row;
    const days = secNum_(row.days_remain), available = secNum_(row.available), inbound = secNum_(row.inbound);
    const daily = secNum_(row.daily_t7);
    const suggested = Math.max(0, Math.ceil(daily * settings.lead_time_days - available - inbound));
    if (available > 0 && days > 0 && days < settings.lead_time_days && inbound === 0) {
      const home = homeStock[asin] || { qty:0, updated_at:'' };
      const localLeadDays = secDaysUntilHomeReplenishment_();
      if (home.qty > 0) {
        // 自宅在庫は海外発注対象にしない。次の週末作業＋納品3日までFBAが持つなら通知も不要。
        if (days <= localLeadDays) {
          events.push({ type:'home_replenishment', event_key:'home_replenishment:' + asin, asin:asin,
            name:((names[asin] || {}).title || asin) + ((names[asin] || {}).subtitle ? ' / ' + names[asin].subtitle : ''), priority:days <= 3 ? 'P1' : 'P2', category:'在庫',
            detail:'FBA残り' + days + '日／自宅在庫' + home.qty + '個。次の週末作業＋納品を見込むと約' + localLeadDays + '日必要。海外発注ではなく、自宅在庫からFBAへ補充する。',
            next_action:'週末のFBA納品へ追加する', route:'home-inventory',
            facts:{ variant:(names[asin] || {}).subtitle || '', available:available, inbound:inbound, daily_t7:daily, days_remain:days, home_stock:home.qty, home_replenishment_lead_days:localLeadDays, overseas_order_required:false, home_stock_updated_at:home.updated_at } });
        }
        return;
      }
      events.push({ type:'stockout_risk', event_key:'stockout_risk:' + asin, asin:asin,
        name:((names[asin] || {}).title || asin) + ((names[asin] || {}).subtitle ? ' / ' + names[asin].subtitle : ''), priority:days <= 14 ? 'P1' : 'P2', category:'在庫',
        detail:'FBA残数' + available + '個／直近日販' + daily.toFixed(1) + '個／残り' + days + '日。入庫' + inbound + '個、標準LT' + settings.lead_time_days + '日。発注目安' + suggested + '個。' + (row.alert ? '判定: ' + row.alert : ''),
        next_action:'発注管理でロット・着地原価・最短納期を確認する', route:'reorder',
        facts:{ variant:(names[asin] || {}).subtitle || '', available:available, inbound:inbound, daily_t7:daily, days_remain:days, suggested_order:suggested } });
    }
  });

  const since14 = new Date(Date.now() - 14 * 864e5), ads = {};
  secRows_('ad_product_daily').forEach(function(row) {
    const date = secDate_(row.date);
    if (!date || isNaN(date.getTime()) || date < since14) return;
    const asin = String(row.asin || '').trim().toUpperCase();
    if (!asin) return;
    const item = ads[asin] || (ads[asin] = { spend:0, sales:0 });
    item.spend += secNum_(row.spend); item.sales += secNum_(row.sales);
  });
  Object.keys(ads).forEach(function(asin) {
    const item = ads[asin], sim = (names[asin] || {}).sim || {};
    if (item.spend < settings.min_ad_spend || !secNum_(sim.price)) return;
    const breakEvenProfit = secNum_(sim.net) + secNum_(sim.ad);
    const breakEvenAcos = breakEvenProfit / secNum_(sim.price);
    const acos = item.sales > 0 ? item.spend / item.sales : 999;
    if (breakEvenAcos >= 0 && acos > breakEvenAcos) {
      events.push({ type:'acos_over_breakeven', event_key:'acos_over_breakeven:' + asin, asin:asin,
        name:((names[asin] || {}).title || asin) + ((names[asin] || {}).subtitle ? ' / ' + names[asin].subtitle : ''), priority:'P2', category:'広告',
        detail:'14日ACoS ' + (acos*100).toFixed(1) + '% > 損益分岐 ' + (breakEvenAcos*100).toFixed(1) + '%（広告費' + Math.round(item.spend) + '円）',
        next_action:'対象広告の入札と検索語を確認する', route:'amazon-ad-plan',
        facts:{ variant:(names[asin] || {}).subtitle || '', spend_14d:Math.round(item.spend), sales_14d:Math.round(item.sales), acos:Number((acos*100).toFixed(1)), break_even_acos:Number((breakEvenAcos*100).toFixed(1)) } });
    }
  });

  const business = secRows_('business_report_period');
  const periods = [...new Set(business.map(function(r) { return String(r.period_key || ''); }).filter(Boolean))].sort();
  const current = periods[periods.length - 1], previous = periods[periods.length - 2], byAsin = {};
  business.forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    if (!asin) return;
    const slot = String(row.period_key) === current ? 'current' : String(row.period_key) === previous ? 'previous' : '';
    if (slot) (byAsin[asin] || (byAsin[asin] = {}))[slot] = row;
  });
  Object.keys(byAsin).forEach(function(asin) {
    const c = byAsin[asin].current, p = byAsin[asin].previous;
    if (!c || !p) return;
    const sessions = secNum_(c.sessions);
    const currentCvr = typeof apCvr_ === 'function' ? apCvr_(c.unit_session_rate) : secNum_(c.unit_session_rate);
    const previousCvr = typeof apCvr_ === 'function' ? apCvr_(p.unit_session_rate) : secNum_(p.unit_session_rate);
    if (sessions >= 100 && previousCvr > 0 && currentCvr < previousCvr * 0.75) {
      events.push({ type:'cvr_drop', event_key:'cvr_drop:' + asin, asin:asin,
        name:((names[asin] || {}).title || asin) + ((names[asin] || {}).subtitle ? ' / ' + names[asin].subtitle : ''), priority:'P2', category:'ページ',
        detail:'CVR ' + (previousCvr*100).toFixed(1) + '%→' + (currentCvr*100).toFixed(1) + '%（' + previous + '→' + current + '、セッション' + sessions + '）',
        next_action:'商品ページと直近レビューを点検する', route:'listing-audit',
      facts:{ variant:(names[asin] || {}).subtitle || '', previous_cvr:Number((previousCvr*100).toFixed(1)), current_cvr:Number((currentCvr*100).toFixed(1)), sessions:sessions } });
    }
  });

  secAppendResearchEvents_(events, lifecycleRows);

  // 朝礼イベントの追加
  try {
    const yesterdaySummary = secGetYesterdayActivitySummary_();
    events.push({
      type: 'daily_brief_summary',
      event_key: 'daily_brief_summary:' + secToday_(),
      asin: '',
      name: '本日の朝礼：昨日の活動サマリー',
      priority: 'P1',
      category: '朝礼',
      detail: '昨日の完了タスク: ' + yesterdaySummary.cards_done + '件／採用仕入先: ' + yesterdaySummary.adopted_sourcing + '件／進捗プロジェクト: ' + yesterdaySummary.projects_advanced + '件。',
      next_action: '今日取り組む優先タスクを決めよう！',
      route: '',
      facts: { yesterday_summary: yesterdaySummary }
    });
  } catch (e) {
    Logger.log('Detect: 朝礼イベント検出失敗: ' + e);
  }

  return events;
}

function secGetYesterdayActivitySummary_() {
  const yesterdayStr = secToday_(new Date(Date.now() - 864e5));
  
  let cardsDone = 0;
  try {
    const cards = secCardObjects_();
    cardsDone = cards.filter(function(c) {
      return c.status === 'done' && String(c.status_updated_at || '').slice(0, 10) === yesterdayStr;
    }).length;
  } catch (e) {
    Logger.log('Summary: cardsDone集計失敗: ' + e);
  }

  let adoptedSourcing = 0;
  let projectsAdvanced = 0;
  try {
    const projects = getAllPageProjects();
    projects.forEach(function(p) {
      const updatedAtDate = String(p.updated_at || '').slice(0, 10);
      if (updatedAtDate === yesterdayStr) {
        projectsAdvanced++;
        if (p.adopted_candidate_id) {
          const handoff = secJson_(p.listing_handoff, {});
          const adoptedAt = String((handoff.candidate_decision_log || {}).adopted_at || '').slice(0, 10);
          if (adoptedAt === yesterdayStr) {
            adoptedSourcing++;
          }
        }
      }
    });
  } catch (e) {
    Logger.log('Summary: projects集計失敗: ' + e);
  }

  let inboundOrdered = 0;
  try {
    const sh = secEnsureCardsSheet_().getParent().getSheetByName('reorder_history');
    if (sh) {
      const values = sh.getDataRange().getValues();
      if (values.length > 1) {
        const headers = values[0].map(String);
        const createdAtIdx = headers.indexOf('created_at');
        if (createdAtIdx >= 0) {
          values.slice(1).forEach(function(row) {
            if (String(row[createdAtIdx] || '').slice(0, 10) === yesterdayStr) {
              inboundOrdered++;
            }
          });
        }
      }
    }
  } catch (e) {
    Logger.log('Summary: reorder集計失敗: ' + e);
  }

  return {
    date: yesterdayStr,
    cards_done: cardsDone,
    adopted_sourcing: adoptedSourcing,
    projects_advanced: projectsAdvanced,
    inbound_ordered: inboundOrdered
  };
}

function secAppendResearchEvents_(events, lifecycleRows) {
  const byId = {}, byAsin = {}, usedAsins = {};
  lifecycleRows.forEach(function(row) {
    const id = String(row.id || '').trim();
    const asin = String(row.asin || '').trim().toUpperCase();
    if (id) byId[id] = row;
    if (asin) byAsin[asin] = row;
  });

  secRows_('page_projects').forEach(function(project) {
    const sourceId = String(project.source_card_id || '').trim();
    const source = byId[sourceId] || {};
    const pageDraft = secJson_(project.page_draft, {});
    const tags = secJson_(project.tags, []);
    const atlas = secIsAtlasLifecycleRow_(source) || (Array.isArray(tags) && tags.indexOf('ATLAS') >= 0)
      || !!(pageDraft && pageDraft.atlas_fact_pack);
    if (!atlas) return;

    const asin = String(source.asin || ((pageDraft.atlas_fact_pack || {}).asin) || '').trim().toUpperCase();
    if (asin) usedAsins[asin] = true;
    const sourcingState = String(project.sourcing_state || '').trim();
    const pageStatus = String(project.status || '').trim();
    const handoff = secJson_(project.listing_handoff, {});
    const needsSupplier = sourcingState === 'needs_search_brief' || sourcingState === 'supplier_needs_confirmation'
      || sourcingState === '仕入先調査中' || sourcingState === '仕入判断中'
      || (sourcingState && handoff.ready !== true && handoff.ready !== 'true');
    const hasDraft = !!(pageDraft.concept || (Array.isArray(pageDraft.title_candidates) && pageDraft.title_candidates.length));
    const action = needsSupplier ? 'ラクマート検索指示書または仕入候補確認を進める'
      : hasDraft ? 'ページ案の入稿判断と不足素材を確認する'
      : 'ページ制作パックを生成する';
      
    // 人間メモと概算シミュレーションデータの引渡し
    const extraTexts = secJson_(project.extra_texts, {});
    const userMemo = String(extraTexts.target_notes || extraTexts.free_memo || '').trim() || String(project.memo || '').trim();
    const roughSim = secJson_(project.cost_simulation || project.profit, null);

    events.push({ type:'atlas_page_project_followup', event_key:'atlas_page_project_followup:' + (project.id || sourceId || asin), asin:asin,
      name:String(project.title || source.title || asin || 'ATLASページ案件').slice(0,40), priority:'P2', category:'リサーチ',
      detail:'状態: ' + (pageStatus || '未設定') + '／仕入探索: ' + (sourcingState || '未設定') + '。' + (userMemo ? '人間メモ:「' + userMemo.slice(0, 100) + '」' : ''),
      next_action:action, route:'page-project',
      facts:{ source_card_id:sourceId, page_project_id:project.id || '', status:pageStatus, sourcing_state:sourcingState, has_page_draft:hasDraft, has_supplier_handoff:!!handoff.ready, user_memo:userMemo, cost_simulation:roughSim } });
  });

  lifecycleRows.forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    if (!asin || usedAsins[asin]) return;
    const source = String(row.source || '').trim();
    const keepa = secJson_(row.keepa_data, {});
    const screen = keepa.decision_screen || {};
    const userMemo = String(row.summary || row.weakness || '').trim();
    const roughSim = secJson_(row.cost_simulation || row.profit, null);
    if (source === 'ATLAS_SOURCING_DECISION') {
      usedAsins[asin] = true;
      events.push({ type:'atlas_sourcing_decision', event_key:'atlas_sourcing_decision:' + asin, asin:asin,
        name:String(row.title || asin).slice(0,40), priority:'P2', category:'リサーチ',
        detail:'ATLAS参入判断候補。判定: ' + (screen.result || screen.decision || '未設定') + '／月販' + secNum_(row.monthly_sales) + '。' + (userMemo ? '人間メモ:「' + userMemo.slice(0, 100) + '」' : ''),
        next_action:'参入判断データとページ勝負度を確認する', route:'sourcing-decision',
        facts:{ source:source, monthly_sold:secNum_(row.monthly_sales), price:secNum_(row.price), reviews:secNum_(row.reviews), screen_result:screen.result || screen.decision || '', user_memo:userMemo, cost_simulation:roughSim } });
    }
  });

  lifecycleRows.forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    if (!asin || usedAsins[asin]) return;
    const source = String(row.source || '').trim();
    if (source !== 'ATLAS_ASIN_RESEARCH') return;
    usedAsins[asin] = true;
    const userMemo = String(row.summary || row.weakness || '').trim();
    const roughSim = secJson_(row.cost_simulation || row.profit, null);
    events.push({ type:'atlas_manual_research', event_key:'atlas_manual_research:' + asin, asin:asin,
      name:String(row.title || asin).slice(0,40), priority:'P3', category:'リサーチ',
      detail:'手動ASINからATLASで作成したリサーチカード。月販' + secNum_(row.monthly_sales) + '。' + (userMemo ? '人間メモ:「' + userMemo.slice(0, 100) + '」' : ''),
      next_action:'リサーチカードを見てページ案へ進めるか判断する', route:'research',
      facts:{ source:source, monthly_sold:secNum_(row.monthly_sales), price:secNum_(row.price), reviews:secNum_(row.reviews), user_memo:userMemo, cost_simulation:roughSim } });
  });

}

function secIsAtlasLifecycleRow_(row) {
  row = row || {};
  const source = String(row.source || '').trim();
  if (source === 'ATLAS_SOURCING_DECISION' || source === 'ATLAS_ASIN_RESEARCH' || source === 'Seller ATLAS' || source === 'SECRETARY_COMPETITOR_ANALYSIS') return true;
  const tags = secJson_(row.tags, []);
  return Array.isArray(tags) && (tags.indexOf('ATLAS') >= 0 || tags.indexOf('競合分析') >= 0);
}

/** ASIN別の自宅在庫。FNSKUだけの行もsku_masterからASINへ解決する。 */
function secHomeStockMap_() {
  const fnskuMap={};secRows_('sku_master').forEach(function(r){const f=String(r.fnsku||'').trim(),a=String(r.asin||'').trim().toUpperCase();if(f&&a)fnskuMap[f]=a;});
  const out={};secRows_('home_inventory_items').forEach(function(r){const fn=String(r.fnsku||'').trim(),asin=String(r.asin||fnskuMap[fn]||'').trim().toUpperCase(),qty=Math.max(0,secNum_(r.qty));if(!asin||!qty)return;const x=out[asin]||(out[asin]={qty:0,updated_at:''});x.qty+=qty;if(String(r.updated_at||'')>String(x.updated_at))x.updated_at=r.updated_at;});return out;
}

/** 土日は当日、平日は次の土曜に作業し、Amazon納品まで安全寄りに3日を加える。 */
function secDaysUntilHomeReplenishment_(date) {
  const day=(date||new Date()).getDay();const daysUntilWeekend=(day===0||day===6)?0:6-day;return daysUntilWeekend+3;
}

function secCardObjects_() {
  const sh = secEnsureCardsSheet_();
  if (sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues(), headers = values[0].map(String);
  return values.slice(1).map(function(row, index) {
    const obj = Object.fromEntries(headers.map(function(key, i) { return [key, row[i]]; }));
    obj._row = index + 2;
    return obj;
  });
}

function secMemory_() {
  const cards = secCardObjects_();
  const dismissed = cards.filter(function(c) { return c.status === 'dismissed'; });
  const reasons = {}, categories = {};
  dismissed.forEach(function(card) {
    const reason = String(card.dismiss_reason || '').trim();
    if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
    const category = String(card.category || 'その他');
    categories[category] = (categories[category] || 0) + 1;
  });
  const top = function(map) {
    return Object.keys(map).map(function(key) { return { label:key, count:map[key] }; })
      .sort(function(a,b) { return b.count-a.count; }).slice(0,5);
  };
  return {
    total_cards: cards.length,
    completed: cards.filter(function(c) { return c.status === 'done'; }).length,
    dismissed: dismissed.length,
    snoozed: cards.filter(function(c) { return c.status === 'snoozed'; }).length,
    feedback_count: dismissed.filter(function(c) { return String(c.dismiss_reason || '').trim(); }).length,
    top_dismiss_reasons: top(reasons), dismissed_categories: top(categories),
    recent_feedback: dismissed.filter(function(c) { return c.dismiss_reason; }).slice(-5).reverse().map(function(c) {
      return { title:c.title, reason:c.dismiss_reason, date:c.status_updated_at };
    })
  };
}

function secRecentFeedbackText_() {
  return secMemory_().recent_feedback.map(function(x) { return '「' + x.title + '」却下理由: ' + x.reason; }).join('\n');
}

function secCallGemini_(events, settings) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未設定');
  const toneMap = { warm:'温かく親しみのある口調', crisp:'簡潔で端的な口調', playful:'少し遊び心のある口調', formal:'落ち着いた丁寧な口調' };
  const policy = [
    'あなたはAmazon物販事業HAKSAI Centralの秘書「' + settings.assistant_name + '」。',
    'オーナーを「' + settings.owner_name + '」と呼ぶ。' + (toneMap[settings.tone] || toneMap.warm) + 'で話す。',
    settings.custom_instruction,
    '欠品、赤字広告、粗利インパクト、ページ改善、リサーチの順で優先する。',
    '数値の根拠を残し、具体的な一手にする。水増ししない。入力イベントにない事実を作らない。',
    '=== リサーチ・ページ作成案件の特別ルール ===',
    '1. ユーザー（オーナー）が書いた人間メモ (user_memo) が検出イベントのfactsに含まれる場合、オーナーが悩んでいる点や懸念に寄り添い、それを考慮した（または解決する）提案をしてください。',
    '2. ページ作成や仕入調査が停滞している案件（statusが「構成前」「素材追加中」などの停滞案件）に対しては、心理的負担を極限まで下げるため、作業を小さく分解した（スモールステップの）具体的なnext_actionを提案してください（例：全体を作るのではなく、「まずはメイン画像1枚の構成だけ決める」「仕入先候補のURLを1個見つけて保存する」など）。特定のフレーズ（「まずは差別化画像1枚〜」等）をそのままコピペして使い回すのではなく、商品の特徴や状況に応じて毎回異なる内容にしてください。一度に全ての原稿や画像を完成させるような重いNext Actionは厳禁です。',
    '3. 検出イベントのfacts.cost_simulationに自動利益シミュレーション結果（planned_monthly_sales, expected_monthly_profit, profit_rate等）がある場合、その「堅実予測（競合の10%シェア）」に基づき、「堅実シミュレーション（予測月販〇個）で月間利益約〇円（利益率〇%）」と具体的な数字を根拠にして提案してください。楽観的な競合月販の数字だけで煽ってはいません。',
    '=== 特別な朝礼カード (daily_brief_summary) ===',
    'もし type が "daily_brief_summary" のイベントがある場合、これは「本日の朝礼カード」です。他のカードとは異なり、以下のルールで作成してください。',
    '1. 昨日の完了タスク数やプロジェクト進捗数など、facts.yesterday_summary にある昨日の実績値を具体的に引き合いに出して、オーナーの昨日の頑張りをしっかり褒めちぎってください。',
    '2. 秘書の名前（settings.assistant_name）として、口調（playfulならギャル風など）を最大限に活かし、「〇〇おはよー！昨日もお疲れ❤️」「進捗マジ神✨」などと、オーナーのモチベーションを高める挨拶で始めてください。',
    '3. 今日まず取り組むべき優先度の高い行動を、明るくエンジンをかけるための1分スピーチ風にまとめて next_action や body に配置してください。',
    '各カードは入力のevent_keyを必ずそのまま返す。最大' + settings.max_cards + '件。',
    'JSON配列のみ: {event_key,priority,category,asin,title,body,next_action,route,impact_note}'
  ].join('\n');
  const prompt = policy + '\n\n検出イベント:\n' + JSON.stringify(events) +
    '\n\n最近の却下理由（同じ失敗を避ける）:\n' + secRecentFeedbackText_();
  const model = GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const response = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY, {
    method:'post', contentType:'application/json', muteHttpExceptions:true,
    payload:JSON.stringify({ contents:[{ parts:[{ text:prompt }] }], generationConfig:{ temperature:0.25, responseMimeType:'application/json' } })
  });
  if (response.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + response.getResponseCode() + ': ' + response.getContentText().slice(0,200));
  const parsed = JSON.parse(response.getContentText());
  const text = parsed.candidates[0].content.parts[0].text;
  const cards = JSON.parse(String(text).replace(/```json|```/g, '').trim());
  if (!Array.isArray(cards)) throw new Error('Gemini応答が配列ではありません。');
  const eventMap = Object.fromEntries(events.map(function(e) { return [e.event_key, e]; }));
  return cards.filter(function(card) { return eventMap[card.event_key]; }).slice(0, settings.max_cards).map(function(card) {
    const event = eventMap[card.event_key];
    return Object.assign({}, event, card, { asin:event.asin, event_key:event.event_key, source_detail:event.detail });
  });
}

function secEligibleEvents_(events) {
  const cards = secCardObjects_(), now = new Date(), activeKeys = new Set();
  cards.forEach(function(card) {
    if (card.status === 'open') activeKeys.add(String(card.event_key));
    if (card.status === 'snoozed' && secDate_(card.snooze_until) > now) activeKeys.add(String(card.event_key));
  });
  return events.filter(function(event) {
    if (activeKeys.has(event.event_key)) return false;
    const fingerprint = secHash_(event.detail);
    const sameDismissal = cards.slice().reverse().find(function(card) {
      return card.event_key === event.event_key && card.status === 'dismissed';
    });
    return !sameDismissal || String(sameDismissal.event_fingerprint) !== fingerprint;
  });
}

function secPrioritizeEvents_(events, limit) {
  const rank = { P1:0, P2:1, P3:2 };
  const groups = {};
  events.forEach(function(event) { (groups[event.category] || (groups[event.category] = [])).push(event); });
  Object.keys(groups).forEach(function(category) {
    groups[category].sort(function(a,b) {
      const priority = (Object.prototype.hasOwnProperty.call(rank, a.priority) ? rank[a.priority] : 9)
        - (Object.prototype.hasOwnProperty.call(rank, b.priority) ? rank[b.priority] : 9);
      if (priority) return priority;
      if (category === '在庫') return secNum_((a.facts || {}).days_remain) - secNum_((b.facts || {}).days_remain);
      return 0;
    });
  });
  const order = ['朝礼','在庫','広告','ページ','価格','リサーチ','その他'];
  const result = [];
  // まず各カテゴリを巡回し、在庫だけで枠が埋まらないようにする。
  while (result.length < limit) {
    let added = false;
    order.forEach(function(category) {
      if (result.length < limit && groups[category] && groups[category].length) {
        result.push(groups[category].shift()); added = true;
      }
    });
    if (!added) break;
  }
  return result;
}

function secSupersedeOpenCards_() {
  const sh = secEnsureCardsSheet_();
  if (sh.getLastRow() < 2) return 0;
  const values = sh.getDataRange().getValues(), headers = values[0].map(String);
  const statusCol = headers.indexOf('status'), updatedCol = headers.indexOf('status_updated_at');
  let count = 0;
  for (let r=1; r<values.length; r++) {
    if (values[r][statusCol] !== 'open' && values[r][statusCol] !== 'snoozed') continue;
    sh.getRange(r+1, statusCol+1).setValue('replaced');
    sh.getRange(r+1, updatedCol+1).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
    count++;
  }
  return count;
}

function runDailyBrief(opts) {
  const t0 = Date.now();
  opts = opts || {};
  if (opts.refresh) secSupersedeOpenCards_();
  const settings = secGetSettings_();
  const detected = secDetectEvents_();
  const events = secPrioritizeEvents_(secEligibleEvents_(detected), settings.max_cards);
  const detectedByType = {};
  detected.forEach(function(event) {
    const type = String(event.type || 'unknown');
    detectedByType[type] = (detectedByType[type] || 0) + 1;
  });
  let cards = [], mode = 'gemini', droppedKeys = [], errorMessage = '';
  if (events.length) {
    try {
      cards = secCallGemini_(events, settings);
      const returnedKeys = new Set(cards.map(function(card) { return String(card.event_key); }));
      droppedKeys = events.map(function(event) { return event.event_key; })
        .filter(function(key) { return !returnedKeys.has(String(key)); });
    }
    catch (error) {
      mode = 'fallback'; Logger.log('秘書Gemini失敗: ' + error);
      errorMessage = String(error).slice(0, 300);
      droppedKeys = [];
      cards = events.map(function(event) { return Object.assign({}, event, {
        title:event.name.slice(0,30), body:event.detail, impact_note:'', source_detail:event.detail
      }); });
    }
  }
  const sh = secEnsureCardsSheet_(), today = secToday_();
  const rows = cards.map(function(card) {
    return [Utilities.getUuid(), today, card.priority || 'P3', card.category || 'その他', card.asin || '',
      card.title || card.name || card.asin, card.body || card.detail, card.next_action || '詳細確認',
      card.route || '', card.impact_note || '', 'open', '', '', '', card.event_key,
      secHash_(card.source_detail || card.detail), card.source_detail || card.detail || '', JSON.stringify(card.facts || {}),
      'rule', '', card.event_key || '', '[]', '', '[]'];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, SEC_CARD_HEADERS.length).setValues(rows);
  const result = { generated:rows.length, detected:detected.length, eligible:events.length, mode:mode, date:today };
  secAppendRunLog_({
    run_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    run_kind: opts.refresh ? 'refresh' : 'auto',
    detected: detected.length,
    eligible: events.length,
    generated: rows.length,
    mode: mode,
    dropped_keys: droppedKeys,
    detected_by_type: detectedByType,
    duration_ms: Date.now() - t0,
    error: errorMessage
  });
  Logger.log(JSON.stringify(result));
  return result;
}

function secretaryProductReview_(data) {
  const query = String(data.query || data.asin || '').trim();
  if (!query) throw new Error('ASINまたは商品名が必要です。');
  return generateProductAiMarkdownFromSidebar({
    query:query, includeVariations:data.includeVariations !== false,
    periodMonths:Number(data.periodMonths || 6), writeToDrive:false
  });
}

function secretaryPortfolioReview_(data) {
  const result = generateResearchReviewMarkdown({
    mode:String(data.mode || 'compact'), periodMonths:Number(data.periodMonths || 3),
    topSellingLimit:Number(data.topSellingLimit || 10),
    topResearchDetailLimit:Number(data.topResearchDetailLimit || 20),
    writeToDrive:false, includeStockRisk:true, includeWeakProducts:true
  });
  try {
    const settings = secGetSettings_();
    const toneMap = { warm:'温かく親しみのある口調', crisp:'簡潔で端的な口調', playful:'少し遊び心のある口調', formal:'落ち着いた丁寧な口調' };
    const toneText = toneMap[settings.tone] || toneMap.warm;
    let markdown = result.markdown || result || '';
    const systemPrompt = [
      '# 秘書ロールプレイ指示書 (Mica Chat Prompt)',
      'あなたはAmazon物販事業HAKSAI Centralの秘書「' + settings.assistant_name + '」です。',
      'オーナーを「' + settings.owner_name + '」と呼んで対話してください。',
      '口調：' + toneText + 'で話してください。',
      'カスタム指示：' + settings.custom_instruction,
      '上記の「あなた（秘書）」になりきって、以下の店舗最新データ（売上・広告・在庫状況）を踏まえ、オーナーからの相談に答えたり、アドバイスを提供してください。',
      '---',
      ''
    ].join('\n');
    if (typeof result === 'object') {
      result.markdown = systemPrompt + markdown;
      return result;
    } else {
      return systemPrompt + result;
    }
  } catch(e) {
    Logger.log('プロンプト埋め込み失敗: ' + e);
  }
  return result;
}

function secretaryPageImprovement_(data) {
  const base64 = String(data.base64 || '').replace(/^data:application\/pdf;base64,/, '');
  if (!base64) throw new Error('PDFがありません。');
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > PI_CONFIG.MAX_PDF_MB * 1024 * 1024) throw new Error('PDFが大きすぎます。');
  const name = String(data.filename || 'amazon-page.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const temp = DriveApp.getFolderById(PI_CONFIG.CENTRAL_FOLDER_ID)
    .createFile(Utilities.newBlob(bytes, 'application/pdf', name));
  try { return piGeneratePageImprovementFromPdf(temp.getId(), data.context || {}); }
  finally { temp.setTrashed(true); }
}

function secDateKeyOffset_(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function secProductActionHistory_() {
  const today = secToday_(), recentFrom = secDateKeyOffset_(-3), evaluatedFrom = secDateKeyOffset_(-14);
  const names = {};
  secRows_('product_lifecycle').forEach(function(row) {
    const asin = String(row.asin || '').trim().toUpperCase();
    if (!asin) return;
    names[asin] = {
      title:String(row.title || '').trim(),
      subtitle:String(row.subtitle || '').trim()
    };
  });
  const actions = typeof getAllProductActions_ === 'function' ? getAllProductActions_(false) : [];
  const enriched = actions.map(function(action) {
    const asin = String(action.asin || '').trim().toUpperCase(), product = names[asin] || {};
    const targetAsins = Array.isArray(action.target_asins) && action.target_asins.length
      ? action.target_asins.map(function(value) { return String(value || '').trim().toUpperCase(); }).filter(Boolean)
      : [asin].filter(Boolean);
    const sharedProducts = targetAsins.map(function(targetAsin) {
      const target = names[targetAsin] || {};
      return { asin:targetAsin, title:target.title || targetAsin, subtitle:target.subtitle || '' };
    });
    const attachments = Array.isArray(action.attachments) ? action.attachments : [];
    const tags = Array.isArray(action.tags) ? action.tags : [];
    return Object.assign({}, action, {
      product_title:product.title || asin,
      product_subtitle:product.subtitle || '',
      shared_product_count:targetAsins.length,
      shared_products:sharedProducts,
      shared_summary:targetAsins.length > 1 ? ('バリエーション共通・' + targetAsins.length + '商品') : '',
      attachment_count:attachments.length,
      from_maika:tags.indexOf('マイカ提案') >= 0
    });
  });
  const recent = enriched.filter(function(action) {
    return action.action_at >= recentFrom && action.action_at <= today && ['実施済み','評価待ち','効果あり','効果なし'].indexOf(String(action.status)) >= 0;
  }).slice(0, 6);
  const due = enriched.filter(function(action) {
    return action.evaluation_date && action.evaluation_date <= today && ['実施済み','評価待ち'].indexOf(String(action.status)) >= 0;
  }).sort(function(a,b) { return String(a.evaluation_date).localeCompare(String(b.evaluation_date)); }).slice(0, 10);
  const recentlyEvaluated = enriched.filter(function(action) {
    return ['効果あり','効果なし'].indexOf(String(action.status)) >= 0 && String(action.updated_at || '').slice(0,10) >= evaluatedFrom;
  }).slice(0, 6);
  const attachmentCount = recent.reduce(function(sum, action) { return sum + Number(action.attachment_count || 0); }, 0);
  const maikaCount = recent.filter(function(action) { return action.from_maika; }).length;
  let praise = '';
  if (recent.length) {
    const types = {};
    recent.forEach(function(action) { const type=String(action.action_type||'改善');types[type]=(types[type]||0)+1; });
    const typeText = Object.keys(types).map(function(type){return type + (types[type]>1?'×'+types[type]:'');}).join('、');
    praise = '直近3日で' + recent.length + '件（' + typeText + '）を実行して記録できてるね。';
    if (attachmentCount) praise += ' スクショも' + attachmentCount + '枚残ってるから、数字が動いた理由をあとでちゃんと振り返れるよ。';
    if (maikaCount) praise += ' マイカの提案から' + maikaCount + '件、実行まで進めてくれたのも嬉しい👏';
  } else if (recentlyEvaluated.length) {
    praise = '最近の施策を' + recentlyEvaluated.length + '件、効果まで振り返れてるね。実行して終わりにせず、結果を残せているのがすごく良いよ。';
  }
  return {
    recent:recent,
    due_for_review:due,
    recently_evaluated:recentlyEvaluated,
    praise_message:praise,
    summary:{ recent_count:recent.length, due_count:due.length, evaluated_count:recentlyEvaluated.length, attachment_count:attachmentCount, maika_adopted_count:maikaCount },
    generated_at:new Date().toISOString()
  };
}

function getSecretaryState_() {
  const today = secToday_();
  const allCards = secCardObjects_();
  const morningCards = allCards.filter(function(card) { return card.category === '朝礼'; });
  const latestMorningCard = morningCards.length > 0 ? morningCards[morningCards.length - 1] : null;

  const cards = allCards.filter(function(card) {
    if (card.category === '朝礼') {
      return latestMorningCard && card.card_id === latestMorningCard.card_id;
    }
    if (card.status === 'open') return true;
    return card.status === 'snoozed' && (!card.snooze_until || String(card.snooze_until).slice(0,10) <= today);
  }).reverse();
  return { cards:cards, settings:secGetSettings_(), memory:secMemory_(), action_history:secProductActionHistory_(), ai_review:typeof airGetLatestReview_ === 'function' ? airGetLatestReview_() : null, generated_at:new Date().toISOString() };
}

function updateSecretaryCard_(data) {
  const id = String(data.id || '').trim(), status = String(data.status || '').trim();
  if (!id || ['done','snoozed','dismissed','open'].indexOf(status) < 0) throw new Error('invalid secretary card update');
  const sh = secEnsureCardsSheet_(), values = sh.getDataRange().getValues(), headers = values[0].map(String);
  const col = Object.fromEntries(headers.map(function(h,i) { return [h,i]; }));
  ['card_id','status','status_updated_at','dismiss_reason','snooze_until'].forEach(function(header) {
    if (col[header] === undefined) throw new Error('action_cards に列がありません: ' + header);
  });
  for (let r=1; r<values.length; r++) {
    if (String(values[r][col.card_id] || '').trim() !== id) continue;
    const updates = {
      status: status,
      status_updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
      dismiss_reason: values[r][col.dismiss_reason] || '',
      snooze_until: values[r][col.snooze_until] || ''
    };
    if (status === 'dismissed') updates.dismiss_reason = String(data.reason || '').slice(0,300);
    if (status === 'snoozed') {
      const until = new Date(); until.setDate(until.getDate() + Math.max(1, Math.min(30, secNum_(data.days) || 1)));
      updates.snooze_until = secToday_(until);
    }
    Object.keys(updates).forEach(function(key) {
      sh.getRange(r+1, col[key]+1).setValue(updates[key]);
    });
    return { id:id, status:status };
  }
  throw new Error('card not found: ' + id);
}

function setupSecretaryDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'runDailyBrief'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runDailyBrief').timeBased().everyDays(1).atHour(5).create();
  return { status:'ok', hour:5 };
}

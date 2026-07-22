/**
 * React版リサーチ司令室向けの読み取り専用集約API。
 * product_lifecycle を正本とし、page_projects の最新案件を接続する。
 */
function getResearchCommandCenterData_() {
  const now = new Date();
  const ss = getSpreadsheet_();
  const lifecycle = rccRows_(ss, 'product_lifecycle');
  const projects = rccRows_(ss, 'page_projects');
  const pageByCard = {};

  projects.forEach(function(project) {
    const cardId = String(project.source_card_id || project.card_id || '').trim();
    if (!cardId) return;
    const current = pageByCard[cardId];
    if (!current || rccDateMs_(project.updated_at) >= rccDateMs_(current.updated_at)) pageByCard[cardId] = project;
  });

  const cards = lifecycle.filter(rccIsResearchCard_).map(function(card) {
    const id = String(card.id || '').trim();
    const asin = String(card.asin || '').trim().toUpperCase();
    const source = String(card.source || '').trim() || '(blank)';
    const sourceInfo = rccSourceInfo_(source);
    const statusRaw = String(card.status || '').trim();
    const status = rccStatus_(statusRaw, card);
    const pack = rccJson_(card.keepa_data, {});
    const facts = pack.product_facts || {};
    const screen = pack.decision_screen || {};
    const project = pageByCard[id] || null;
    const archived = rccBool_(card.is_deleted);
    const launched = rccBool_(card.is_launched) || rccHasOwnAsin_(card.own_listing);
    const hasSupplier = rccHasSupplier_(card, project);
    const hasImages = rccHasImages_(card, project);
    const stage = rccStage_(archived, launched, project, hasSupplier, screen);
    const price = rccNumber_(facts.price != null ? facts.price : card.price);
    const monthlySales = rccNumber_(facts.monthly_sold != null ? facts.monthly_sold : card.monthly_sales);
    const reviews = rccNumber_(facts.review_count != null ? facts.review_count : card.reviews);
    const title = String(card.title || facts.title || '').trim();
    const presence = {
      asin:!!asin,
      price:price > 0,
      monthly_sales:monthlySales > 0,
      product_facts:Object.keys(facts).length > 0,
      images:hasImages,
      supplier:hasSupplier
    };
    const coreFields = ['asin','price','monthly_sales','product_facts'];
    const missing = coreFields.filter(function(field) { return !presence[field]; });
    const completeness = Object.keys(presence).filter(function(field) { return presence[field]; }).length;
    const decision = String(screen.result || screen.decision || screen.final_decision || '').trim();

    return {
      id:id,
      asin:asin,
      title:title || '名称未設定のリサーチメモ',
      category:String(card.category || '').trim(),
      source:source,
      source_group:sourceInfo.group,
      source_label:sourceInfo.label,
      status_raw:statusRaw,
      status:status,
      stage:stage,
      stage_label:rccStageLabel_(stage),
      decision:decision,
      price:price,
      monthly_sales:monthlySales,
      reviews:reviews,
      memo:String(card.summary || card.weakness || '').trim(),
      updated_at:rccIso_(card.updated_at),
      updated_days_ago:rccDaysAgo_(card.updated_at, now),
      completeness_score:Math.round(completeness / Object.keys(presence).length * 100),
      missing_core:missing,
      has_images:hasImages,
      has_supplier:hasSupplier,
      is_legacy:sourceInfo.group === 'legacy' || sourceInfo.group === 'seed',
      next_action:rccNextAction_(stage, sourceInfo.group, asin, missing, project, screen, hasSupplier),
      page_project:project ? {
        id:String(project.id || ''),
        status:String(project.status || '').trim() || '未設定',
        sourcing_state:String(project.sourcing_state || '').trim(),
        updated_at:rccIso_(project.updated_at)
      } : null
    };
  }).sort(function(a, b) {
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });

  const sourceCounts = {}, stageCounts = {};
  cards.forEach(function(card) {
    sourceCounts[card.source_group] = (sourceCounts[card.source_group] || 0) + 1;
    stageCounts[card.stage] = (stageCounts[card.stage] || 0) + 1;
  });

  return {
    generated_at:now.toISOString(),
    read_only:true,
    terminology:{ external_tool:'ATLAS', canonical_card_sheet:'product_lifecycle', canonical_page_sheet:'page_projects' },
    summary:{
      total:cards.length,
      active:cards.filter(function(card) { return card.stage !== 'archived'; }).length,
      ready_for_page:cards.filter(function(card) { return !card.page_project && card.missing_core.length === 0 && card.stage !== 'archived'; }).length,
      linked_page_projects:cards.filter(function(card) { return !!card.page_project; }).length,
      needs_supplier:cards.filter(function(card) { return card.stage === 'page_production' && !card.has_supplier; }).length,
      updated_within_30d:cards.filter(function(card) { return card.updated_days_ago != null && card.updated_days_ago <= 30; }).length
    },
    source_counts:sourceCounts,
    stage_counts:stageCounts,
    cards:cards
  };
}

function rccRows_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  return values.slice(1).filter(function(row) { return row.some(function(value) { return value !== '' && value != null; }); }).map(function(row) {
    const item = {};
    headers.forEach(function(header, index) { if (header) item[header] = row[index]; });
    return item;
  });
}

function rccIsResearchCard_(card) {
  const source = String(card.source || '').trim();
  const pack = rccJson_(card.keepa_data, {});
  return String(card.origin_type || '').trim() === 'research' ||
    ['ATLAS_SOURCING_DECISION','ATLAS_ASIN_RESEARCH','Seller ATLAS','SECRETARY_COMPETITOR_ANALYSIS'].indexOf(source) >= 0 ||
    (pack.decision_screen && pack.decision_screen.pipeline === 'sourcing-decision');
}

function rccSourceInfo_(source) {
  if (source === 'ATLAS_SOURCING_DECISION') return { group:'atlas', label:'ATLAS選定' };
  if (source === 'Seller ATLAS') return { group:'atlas', label:'ATLAS（旧連携）' };
  if (source === 'ATLAS_ASIN_RESEARCH') return { group:'asin_research', label:'ASIN即時リサーチ' };
  if (source === 'SECRETARY_COMPETITOR_ANALYSIS') return { group:'secretary', label:'マイカ・競合分析' };
  if (source === 'graduated_seed') return { group:'seed', label:'販売実績からの種' };
  if (source === 'Amazon') return { group:'legacy', label:'旧Amazon起点' };
  return { group:'legacy', label:source === '(blank)' ? '旧カード' : source };
}

function rccStatus_(status, card) {
  if (rccBool_(card.is_deleted) || status === 'stop') return 'closed';
  if (rccBool_(card.is_launched)) return 'launched';
  if (status === 'go') return 'promising';
  if (status === 'wait') return 'hold';
  return 'reviewing';
}

function rccStage_(archived, launched, project, hasSupplier, screen) {
  if (archived) return 'archived';
  if (launched) return 'launched';
  if (project) return 'page_production';
  if (hasSupplier) return 'supplier_materials';
  if (screen && Object.keys(screen).length) return 'screened';
  return 'research_pool';
}

function rccStageLabel_(stage) {
  return ({ research_pool:'候補を検討中', screened:'一次判定済み', supplier_materials:'仕入・素材確認', page_production:'ページ制作中', launched:'販売中', archived:'終了' })[stage] || stage;
}

function rccNextAction_(stage, sourceGroup, asin, missing, project, screen, hasSupplier) {
  if (stage === 'archived') return '記録として保管';
  if (stage === 'launched') return '商品カルテで販売後を振り返る';
  if (project) {
    if (!hasSupplier) return '仕入先候補と素材を確認する';
    if (String(project.status || '') === '構成前') return 'ページ構成の叩き台を作る';
    return 'ページ制作の続きを進める';
  }
  if (sourceGroup === 'seed') return '気づきを商品アイデアへ具体化する';
  if (!asin && sourceGroup === 'legacy') return 'ASINか競合商品を紐づける';
  if (screen && String(screen.result || '').indexOf('INSUFFICIENT') >= 0) return '判定に足りないデータを補う';
  if (missing.length) return '不足している判断材料を補う';
  return '商品化するか判断し、ページ制作へ送る';
}

function rccHasSupplier_(card, project) {
  if (String(card.supplier_1688_url || '').trim()) return true;
  if (!project) return false;
  const extra = rccJson_(project.extra_texts, {});
  return !!String(extra.supplier_url || '').trim() || Object.keys(rccJson_(project.sourcing_brief, {})).length > 0 || Object.keys(rccJson_(project.sourcing_comparison, {})).length > 0;
}

function rccHasImages_(card, project) {
  const cardImages = rccJson_(card.image_drive_ids, []);
  if (String(card.image_drive_id || '').trim() || (Array.isArray(cardImages) && cardImages.length)) return true;
  if (!project) return false;
  const images = rccJson_(project.image_drive_ids, []), extras = rccJson_(project.extra_image_ids, []);
  return (Array.isArray(images) && images.length > 0) || (Array.isArray(extras) && extras.length > 0);
}

function rccHasOwnAsin_(value) {
  const own = rccJson_(value, {});
  if (Array.isArray(own)) return own.some(function(item) { return !!String(item && item.asin || '').trim(); });
  return !!String(own.asin || '').trim();
}

function rccJson_(value, fallback) { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '')); } catch (e) { return fallback; } }
function rccNumber_(value) { const n = Number(String(value == null ? '' : value).replace(/,/g, '')); return isFinite(n) ? n : 0; }
function rccBool_(value) { return value === true || value === 1 || ['true','1','yes'].indexOf(String(value || '').trim().toLowerCase()) >= 0; }
function rccDateMs_(value) { const date = value instanceof Date ? value : new Date(value || 0); return isNaN(date.getTime()) ? 0 : date.getTime(); }
function rccIso_(value) { const ms = rccDateMs_(value); return ms ? new Date(ms).toISOString() : ''; }
function rccDaysAgo_(value, now) { const ms = rccDateMs_(value); return ms ? Math.max(0, Math.floor((now.getTime() - ms) / 86400000)) : null; }

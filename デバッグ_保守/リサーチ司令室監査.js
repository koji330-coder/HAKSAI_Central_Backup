/**
 * product_lifecycle と page_projects を読み、React版リサーチ司令室の設計材料を集計する。
 * シート・トリガー・プロパティは変更しない。
 */

const RCA_VERSION = '2026-07-18.v1';
const RCA_RESEARCH_SOURCES = [
  'ATLAS_SOURCING_DECISION',
  'ATLAS_ASIN_RESEARCH',
  'Seller ATLAS',
  'SECRETARY_COMPETITOR_ANALYSIS'
];

function auditResearchCommandCenterData() {
  const now = new Date();
  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );
  const lifecycle = rcaRows_(ss, 'product_lifecycle');
  const pageProjects = rcaRows_(ss, 'page_projects');
  const researchCards = lifecycle.rows.filter(rcaIsResearchCard_);
  const pageByCard = {};
  pageProjects.rows.forEach(function(project) {
    const cardId = String(project.source_card_id || '').trim();
    if (!cardId) return;
    if (!pageByCard[cardId] || rcaDate_(project.updated_at) > rcaDate_(pageByCard[cardId].updated_at)) {
      pageByCard[cardId] = project;
    }
  });

  const sourceCounts = {}, statusCounts = {}, originCounts = {}, decisionCounts = {}, stageCounts = {};
  const asinRows = {}, fieldCounts = {};
  const fields = [
    'asin','title','category','price','monthly_sales','reviews','human_memo','keepa_data',
    'product_facts','page_facts','decision_screen','images','supplier','page_project'
  ];
  fields.forEach(function(field) { fieldCounts[field] = 0; });
  let active = 0, archived = 0, launched = 0, updated30d = 0, linkedPages = 0;
  const normalized = researchCards.map(function(card) {
    const id = String(card.id || '').trim();
    const asin = String(card.asin || '').trim().toUpperCase();
    const source = String(card.source || '').trim() || '(blank)';
    const status = String(card.status || '').trim() || '(blank)';
    const origin = String(card.origin_type || '').trim() || '(blank)';
    const pack = rcaJson_(card.keepa_data, {});
    const pf = pack.product_facts || {};
    const pg = pack.page_facts || {};
    const screen = pack.decision_screen || {};
    const linkedPage = pageByCard[id] || null;
    const isArchived = rcaBool_(card.is_deleted);
    const isLaunched = rcaBool_(card.is_launched) || rcaHasOwnAsin_(card.own_listing);
    const hasSupplier = rcaHasSupplier_(card, linkedPage);
    const hasImages = rcaHasImages_(card, linkedPage);
    const updatedAt = rcaDate_(card.updated_at);
    const daysAgo = rcaDaysAgo_(updatedAt, now);
    const decision = String(screen.result || screen.decision || screen.final_decision || '').trim() || '(none)';
    const stage = rcaStage_(isArchived, isLaunched, linkedPage, hasSupplier, screen);

    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    originCounts[origin] = (originCounts[origin] || 0) + 1;
    decisionCounts[decision] = (decisionCounts[decision] || 0) + 1;
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    if (isArchived) archived++; else active++;
    if (isLaunched) launched++;
    if (linkedPage) linkedPages++;
    if (daysAgo !== null && daysAgo <= 30) updated30d++;
    if (asin) (asinRows[asin] = asinRows[asin] || []).push(card);

    const presence = {
      asin:!!asin,
      title:!!String(card.title || pf.title || '').trim(),
      category:!!String(card.category || '').trim(),
      price:rcaHasPositive_(pf.price == null ? card.price : pf.price),
      monthly_sales:rcaHasPositive_(pf.monthly_sold == null ? card.monthly_sales : pf.monthly_sold),
      reviews:rcaHasNumber_(pf.review_count == null ? card.reviews : pf.review_count),
      human_memo:!!String(card.summary || card.weakness || '').trim(),
      keepa_data:Object.keys(pack).length > 0,
      product_facts:Object.keys(pf).length > 0,
      page_facts:Object.keys(pg).length > 0,
      decision_screen:Object.keys(screen).length > 0,
      images:hasImages,
      supplier:hasSupplier,
      page_project:!!linkedPage
    };
    fields.forEach(function(field) { if (presence[field]) fieldCounts[field]++; });
    const coreReady = presence.asin && presence.title && presence.price && presence.monthly_sales && presence.product_facts;
    return {
      id:id, asin:asin, title:String(card.title || pf.title || '').trim(), source:source,
      status:status, stage:stage, decision:decision, updated_at:rcaIso_(updatedAt),
      updated_days_ago:daysAgo, core_ready:coreReady, has_page_project:!!linkedPage,
      has_supplier:hasSupplier, has_images:hasImages,
      missing_core:Object.keys(presence).filter(function(key) {
        return ['asin','title','price','monthly_sales','product_facts'].indexOf(key) >= 0 && !presence[key];
      })
    };
  });

  const duplicateAsins = Object.keys(asinRows).filter(function(asin) {
    return asinRows[asin].length > 1;
  }).map(function(asin) {
    return {
      asin:asin,
      count:asinRows[asin].length,
      sources:Array.from(new Set(asinRows[asin].map(function(row) { return String(row.source || '').trim() || '(blank)'; }))),
      ids:asinRows[asin].map(function(row) { return String(row.id || ''); })
    };
  }).sort(function(a, b) { return b.count - a.count || a.asin.localeCompare(b.asin); });

  const completeness = {};
  fields.forEach(function(field) {
    completeness[field] = {
      count:fieldCounts[field],
      missing:researchCards.length - fieldCounts[field],
      rate:researchCards.length ? Number((fieldCounts[field] / researchCards.length).toFixed(3)) : 0
    };
  });
  const warnings = rcaWarnings_(researchCards, normalized, duplicateAsins, lifecycle, pageProjects);
  const report = {
    audit_version:RCA_VERSION,
    generated_at:now.toISOString(),
    read_only:true,
    terminology:{ external_tool:'ATLAS', canonical_card_sheet:'product_lifecycle', canonical_page_sheet:'page_projects' },
    summary:{
      lifecycle_total_rows:lifecycle.rows.length,
      research_card_count:researchCards.length,
      active_research_cards:active,
      archived_research_cards:archived,
      launched_cards:launched,
      linked_page_projects:linkedPages,
      updated_within_30d:updated30d,
      core_ready_cards:normalized.filter(function(row) { return row.core_ready; }).length,
      duplicate_asin_groups:duplicateAsins.length
    },
    source_counts:sourceCounts,
    status_counts:statusCounts,
    origin_type_counts:originCounts,
    decision_counts:decisionCounts,
    workflow_stage_counts:stageCounts,
    completeness:completeness,
    page_projects:{
      total_rows:pageProjects.rows.length,
      linked_to_research_cards:linkedPages,
      status_counts:rcaCountBy_(pageProjects.rows, 'status'),
      sourcing_state_counts:rcaCountBy_(pageProjects.rows, 'sourcing_state')
    },
    duplicate_asins:duplicateAsins.slice(0, 20),
    samples:{
      recent_unlinked:rcaSamples_(normalized.filter(function(row) { return !row.has_page_project && row.stage !== 'archived'; }), 10),
      missing_core:rcaSamples_(normalized.filter(function(row) { return row.missing_core.length > 0; }), 10),
      ready_for_page:rcaSamples_(normalized.filter(function(row) { return row.core_ready && !row.has_page_project && row.stage !== 'archived'; }), 10),
      linked_to_page:rcaSamples_(normalized.filter(function(row) { return row.has_page_project; }), 10)
    },
    warnings:warnings,
    ui_findings:{
      react_central_has_research_tab:false,
      existing_gas_endpoints:['getCards','getCardDetail','createPageProject','analyzeCompetitorAsin'],
      recommended_first_screen:'ATLAS・マイカ由来カードを同じ一覧で、入口・進捗・情報不足・ページ制作連携ごとに絞り込むリサーチ司令室'
    }
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function rcaRows_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return { exists:false, headers:[], rows:[] };
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const rows = values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== '' && value !== null; });
  }).map(function(row) {
    const item = {};
    headers.forEach(function(header, index) { if (header) item[header] = row[index]; });
    return item;
  });
  return { exists:true, headers:headers, rows:rows };
}

function rcaIsResearchCard_(card) {
  const origin = String(card.origin_type || '').trim();
  const source = String(card.source || '').trim();
  const pack = rcaJson_(card.keepa_data, {});
  const screen = pack.decision_screen || {};
  return origin === 'research' || RCA_RESEARCH_SOURCES.indexOf(source) >= 0 || screen.pipeline === 'sourcing-decision';
}

function rcaStage_(archived, launched, linkedPage, hasSupplier, screen) {
  if (archived) return 'archived';
  if (launched) return 'launched';
  if (linkedPage) return 'page_production';
  if (hasSupplier) return 'supplier_materials';
  if (screen && Object.keys(screen).length) return 'screened';
  return 'research_pool';
}

function rcaHasSupplier_(card, project) {
  if (String(card.supplier_1688_url || '').trim()) return true;
  if (!project) return false;
  const extra = rcaJson_(project.extra_texts, {});
  const brief = rcaJson_(project.sourcing_brief, {});
  const comparison = rcaJson_(project.sourcing_comparison, {});
  return !!String(extra.supplier_url || '').trim() || Object.keys(brief).length > 0 || Object.keys(comparison).length > 0;
}

function rcaHasImages_(card, project) {
  const cardImages = rcaJson_(card.image_drive_ids, []);
  if ((Array.isArray(cardImages) && cardImages.length) || String(card.image_drive_id || '').trim()) return true;
  if (!project) return false;
  const projectImages = rcaJson_(project.image_drive_ids, []);
  const extraImages = rcaJson_(project.extra_image_ids, []);
  return (Array.isArray(projectImages) && projectImages.length > 0) || (Array.isArray(extraImages) && extraImages.length > 0);
}

function rcaHasOwnAsin_(value) {
  const own = rcaJson_(value, {});
  if (Array.isArray(own)) return own.some(function(item) { return !!String(item && item.asin || '').trim(); });
  return !!String(own.asin || '').trim();
}

function rcaWarnings_(cards, normalized, duplicates, lifecycle, pages) {
  const out = [];
  if (!lifecycle.exists) out.push({ severity:'high', code:'lifecycle_missing', message:'product_lifecycleが存在しません。' });
  if (!pages.exists) out.push({ severity:'medium', code:'page_projects_missing', message:'page_projectsが存在しません。' });
  if (duplicates.length) out.push({ severity:'medium', code:'duplicate_asins', message:'同じASINのリサーチカードが複数あります。', count:duplicates.length });
  const missingCore = normalized.filter(function(row) { return row.missing_core.length; }).length;
  if (missingCore) out.push({ severity:'medium', code:'missing_core_facts', message:'基本判断材料が不足するカードがあります。', count:missingCore });
  const noSource = cards.filter(function(card) { return !String(card.source || '').trim(); }).length;
  if (noSource) out.push({ severity:'low', code:'missing_source', message:'入口を判定できないカードがあります。', count:noSource });
  return out;
}

function rcaSamples_(rows, limit) {
  return rows.slice().sort(function(a, b) {
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  }).slice(0, limit).map(function(row) {
    return {
      id:row.id, asin:row.asin, title:row.title.slice(0, 60), source:row.source,
      status:row.status, stage:row.stage, decision:row.decision,
      updated_at:row.updated_at, missing_core:row.missing_core
    };
  });
}

function rcaCountBy_(rows, field) {
  const out = {};
  rows.forEach(function(row) {
    const key = String(row[field] || '').trim() || '(blank)';
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

function rcaHasNumber_(value) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  return !isNaN(Number(String(value).replace(/,/g, '')));
}

function rcaHasPositive_(value) {
  if (!rcaHasNumber_(value)) return false;
  return Number(String(value).replace(/,/g, '')) > 0;
}

function rcaBool_(value) {
  if (value === true || value === 1) return true;
  return ['true','1','yes'].indexOf(String(value || '').trim().toLowerCase()) >= 0;
}

function rcaJson_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch (e) { return fallback; }
}

function rcaDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function rcaDaysAgo_(date, now) {
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function rcaIso_(date) {
  return date ? date.toISOString() : '';
}

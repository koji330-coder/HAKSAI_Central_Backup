/**
 * 旧Keepa自動リサーチをHAKSAI Centralから分離する。
 *
 * 1. previewLegacyKeepaSeparation() で対象と阻害要因を確認する。
 * 2. executeLegacyKeepaSeparation() で別スプレッドシートへコピーし、
 *    コピー検証後に旧トリガーと元シートを削除する。
 */

const LKSA_VERSION = '2026-07-18.v1';
const LKSA_ARCHIVE_PROPERTY = 'LEGACY_KEEPA_ARCHIVE_SPREADSHEET_ID';
const LKSA_TARGET_SHEETS = [
  'keepa_research_candidates',
  'keepa_batch_schedule',
  'keepa_seller_master',
  'keepa_ng_categories',
  'keepa_category_master',
  'keepa_history_trial_preview'
];
const LKSA_TARGET_HANDLERS = [
  'runKeepaBatch',
  'runKeepaStage1_5',
  'autoSetKeepaStatus',
  'runKeepaStage2',
  'runSellerStorefrontBatch',
  'convertCompletedTitlesToValues'
];

function previewLegacyKeepaSeparation() {
  const report = lksaBuildPreview_();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function executeLegacyKeepaSeparation() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const preview = lksaBuildPreview_();
    if (!preview.ready) {
      throw new Error('分離を中止しました: ' + preview.blockers.join(' / '));
    }
    if (preview.present_sheet_count === 0 && preview.target_trigger_count === 0) {
      const priorId = PropertiesService.getScriptProperties().getProperty(LKSA_ARCHIVE_PROPERTY) || '';
      const already = {
        status:'already_separated',
        version:LKSA_VERSION,
        archive_spreadsheet_id:priorId,
        archive_url:priorId ? 'https://docs.google.com/spreadsheets/d/' + priorId + '/edit' : ''
      };
      Logger.log(JSON.stringify(already, null, 2));
      return already;
    }

    const sourceSs = lksaSourceSpreadsheet_();
    const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
    const archiveName = sourceSs.getName() + ' - 旧Keepaリサーチアーカイブ ' + stamp;
    const archiveSs = SpreadsheetApp.create(archiveName);
    const archiveId = archiveSs.getId();
    const archiveUrl = archiveSs.getUrl();
    const manifestSheet = archiveSs.getSheets()[0];
    manifestSheet.setName('_archive_manifest');

    const copied = [];
    try {
      preview.sheets.forEach(function(info) {
        if (!info.exists) return;
        const sourceSheet = sourceSs.getSheetByName(info.name);
        const sourceSignature = lksaSheetSignature_(sourceSheet);
        const archiveSheet = sourceSheet.copyTo(archiveSs);
        archiveSheet.setName(info.name);
        SpreadsheetApp.flush();
        const archiveSignature = lksaSheetSignature_(archiveSheet);
        if (sourceSignature.last_row !== archiveSignature.last_row ||
            sourceSignature.last_column !== archiveSignature.last_column ||
            sourceSignature.sample_sha256 !== archiveSignature.sample_sha256) {
          throw new Error('コピー検証不一致: ' + info.name);
        }
        copied.push({
          name:info.name,
          last_row:sourceSignature.last_row,
          last_column:sourceSignature.last_column,
          sample_sha256:sourceSignature.sample_sha256,
          verified:true
        });
      });
    } catch (copyError) {
      try { DriveApp.getFileById(archiveId).setTrashed(true); } catch (trashError) {}
      throw new Error('アーカイブ作成に失敗したため、元データは変更していません: ' + copyError.message);
    }

    if (copied.length !== preview.present_sheet_count) {
      try { DriveApp.getFileById(archiveId).setTrashed(true); } catch (trashError) {}
      throw new Error('コピー件数が一致しないため、元データは変更していません。');
    }

    const moveWarnings = [];
    try {
      const sourceFile = DriveApp.getFileById(sourceSs.getId());
      const parents = sourceFile.getParents();
      if (parents.hasNext()) DriveApp.getFileById(archiveId).moveTo(parents.next());
    } catch (moveError) {
      moveWarnings.push('アーカイブはマイドライブ直下に作成されました: ' + moveError.message);
    }

    const stoppedTriggers = [];
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      const handler = String(trigger.getHandlerFunction() || '');
      if (LKSA_TARGET_HANDLERS.indexOf(handler) < 0) return;
      stoppedTriggers.push({
        handler:handler,
        unique_id:lksaSafeTriggerValue_(function() { return trigger.getUniqueId(); }),
        event_type:lksaSafeTriggerValue_(function() { return trigger.getEventType(); })
      });
      ScriptApp.deleteTrigger(trigger);
    });

    const deletedSheets = [];
    try {
      LKSA_TARGET_SHEETS.forEach(function(name) {
        const sheet = sourceSs.getSheetByName(name);
        if (!sheet) return;
        sourceSs.deleteSheet(sheet);
        deletedSheets.push(name);
      });
    } catch (deleteError) {
      lksaWriteManifest_(manifestSheet, {
        status:'partial_failure', sourceSs:sourceSs, archiveId:archiveId, archiveUrl:archiveUrl,
        copied:copied, stoppedTriggers:stoppedTriggers, deletedSheets:deletedSheets,
        warnings:moveWarnings.concat(['元シート削除中に停止: ' + deleteError.message])
      });
      throw new Error('分離処理が途中で停止しました。アーカイブは完成しています: ' + archiveUrl + ' / ' + deleteError.message);
    }

    PropertiesService.getScriptProperties().setProperties({
      LEGACY_KEEPA_ARCHIVE_SPREADSHEET_ID:archiveId,
      LEGACY_KEEPA_ARCHIVE_URL:archiveUrl,
      LEGACY_KEEPA_SEPARATED_AT:new Date().toISOString(),
      LEGACY_KEEPA_SEPARATION_VERSION:LKSA_VERSION
    }, false);

    const result = {
      status:'completed',
      version:LKSA_VERSION,
      archive_spreadsheet_id:archiveId,
      archive_url:archiveUrl,
      copied_sheets:copied,
      deleted_source_sheets:deletedSheets,
      stopped_triggers:stoppedTriggers,
      preserved_current_sheets:['product_lifecycle','page_projects','listing_snapshots','product_market_history_index'],
      warnings:moveWarnings
    };
    lksaWriteManifest_(manifestSheet, {
      status:'completed', sourceSs:sourceSs, archiveId:archiveId, archiveUrl:archiveUrl,
      copied:copied, stoppedTriggers:stoppedTriggers, deletedSheets:deletedSheets, warnings:moveWarnings
    });
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function lksaBuildPreview_() {
  const ss = lksaSourceSpreadsheet_();
  const sheets = LKSA_TARGET_SHEETS.map(function(name) {
    const sheet = ss.getSheetByName(name);
    return {
      name:name,
      exists:!!sheet,
      last_row:sheet ? sheet.getLastRow() : 0,
      last_column:sheet ? sheet.getLastColumn() : 0
    };
  });
  const triggerRows = ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      handler:String(trigger.getHandlerFunction() || ''),
      unique_id:lksaSafeTriggerValue_(function() { return trigger.getUniqueId(); }),
      event_type:lksaSafeTriggerValue_(function() { return trigger.getEventType(); })
    };
  }).filter(function(row) { return LKSA_TARGET_HANDLERS.indexOf(row.handler) >= 0; });

  const projectionAsins = lksaSourcingProjectionAsins_(ss);
  const lifecycleAsins = lksaLifecycleResearchAsins_(ss);
  const missingLifecycle = projectionAsins.filter(function(asin) { return lifecycleAsins.indexOf(asin) < 0; });
  const blockers = [];
  if (missingLifecycle.length) {
    blockers.push('sourcing-decision投影のうちproduct_lifecycleに存在しないASIN: ' + missingLifecycle.join(','));
  }
  if (!ss.getSheetByName('product_lifecycle')) blockers.push('product_lifecycleが存在しません。');

  return {
    status:'preview',
    version:LKSA_VERSION,
    generated_at:new Date().toISOString(),
    read_only:true,
    ready:blockers.length === 0,
    source_spreadsheet_id:ss.getId(),
    source_spreadsheet_name:ss.getName(),
    present_sheet_count:sheets.filter(function(row) { return row.exists; }).length,
    sheets:sheets,
    target_trigger_count:triggerRows.length,
    triggers:triggerRows,
    sourcing_projection_asins:projectionAsins,
    lifecycle_research_asin_count:lifecycleAsins.length,
    projection_asins_missing_from_lifecycle:missingLifecycle,
    blockers:blockers,
    execution_order:[
      '別スプレッドシートへ対象シートをコピー',
      '行列数と標本SHA-256を照合',
      '旧トリガーを停止',
      '元ブックから対象シートを削除',
      'アーカイブ情報をScript Propertiesとマニフェストへ保存'
    ]
  };
}

function lksaSourceSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID が未設定です。');
  return SpreadsheetApp.openById(id);
}

function lksaSourcingProjectionAsins_(ss) {
  const sheet = ss.getSheetByName('keepa_research_candidates');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const asinIndex = headers.indexOf('asin');
  const sourceIndex = headers.indexOf('source');
  const pipelineIndex = headers.indexOf('source_pipeline');
  if (asinIndex < 0) return [];
  const found = {};
  values.slice(1).forEach(function(row) {
    const source = sourceIndex >= 0 ? String(row[sourceIndex] || '').trim() : '';
    const pipeline = pipelineIndex >= 0 ? String(row[pipelineIndex] || '').trim() : '';
    if (source !== 'sourcing-decision' && pipeline !== 'sourcing-decision') return;
    const asin = String(row[asinIndex] || '').trim().toUpperCase();
    if (asin) found[asin] = true;
  });
  return Object.keys(found).sort();
}

function lksaLifecycleResearchAsins_(ss) {
  const sheet = ss.getSheetByName('product_lifecycle');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const asinIndex = headers.indexOf('asin');
  const sourceIndex = headers.indexOf('source');
  const keepaIndex = headers.indexOf('keepa_data');
  if (asinIndex < 0) return [];
  const acceptedSources = ['ATLAS_SOURCING_DECISION','ATLAS_ASIN_RESEARCH','Seller ATLAS','SECRETARY_COMPETITOR_ANALYSIS'];
  const found = {};
  values.slice(1).forEach(function(row) {
    const source = sourceIndex >= 0 ? String(row[sourceIndex] || '').trim() : '';
    const pack = keepaIndex >= 0 ? lksaJson_(row[keepaIndex], {}) : {};
    const screen = pack.decision_screen || {};
    if (acceptedSources.indexOf(source) < 0 && screen.pipeline !== 'sourcing-decision') return;
    const asin = String(row[asinIndex] || '').trim().toUpperCase();
    if (asin) found[asin] = true;
  });
  return Object.keys(found).sort();
}

function lksaSheetSignature_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const rowNumbers = [];
  for (let row = 1; row <= Math.min(lastRow, 5); row++) rowNumbers.push(row);
  for (let row = Math.max(1, lastRow - 4); row <= lastRow; row++) {
    if (rowNumbers.indexOf(row) < 0) rowNumbers.push(row);
  }
  const sample = rowNumbers.map(function(row) {
    if (lastColumn < 1) return [];
    return sheet.getRange(row, 1, 1, lastColumn).getValues()[0].map(lksaStableValue_);
  });
  const body = JSON.stringify({ last_row:lastRow, last_column:lastColumn, row_numbers:rowNumbers, sample:sample });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, body, Utilities.Charset.UTF_8);
  const hex = digest.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
  return { last_row:lastRow, last_column:lastColumn, sample_sha256:hex };
}

function lksaStableValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  if (value === null || value === undefined) return '';
  return value;
}

function lksaWriteManifest_(sheet, data) {
  const rows = [
    ['section','key','value'],
    ['meta','version',LKSA_VERSION],
    ['meta','status',data.status],
    ['meta','archived_at',new Date().toISOString()],
    ['meta','source_spreadsheet_id',data.sourceSs.getId()],
    ['meta','source_spreadsheet_name',data.sourceSs.getName()],
    ['meta','archive_spreadsheet_id',data.archiveId],
    ['meta','archive_url',data.archiveUrl]
  ];
  data.copied.forEach(function(item) { rows.push(['sheet',item.name,JSON.stringify(item)]); });
  data.stoppedTriggers.forEach(function(item) { rows.push(['trigger',item.handler,JSON.stringify(item)]); });
  data.deletedSheets.forEach(function(name) { rows.push(['deleted_source_sheet',name,'true']); });
  data.warnings.forEach(function(message, index) { rows.push(['warning',String(index + 1),message]); });
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.autoResizeColumns(1, 3);
}

function lksaSafeTriggerValue_(callback) {
  try {
    const value = callback();
    return value === null || value === undefined ? '' : String(value);
  } catch (e) {
    return '';
  }
}

function lksaJson_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch (e) { return fallback; }
}

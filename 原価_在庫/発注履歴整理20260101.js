// 2026-01-01期首在庫の登録後に、旧reorder_historyを安全に整理する一回限りのメンテナンス。
// プレビューと本番反映を分離し、反映時はバックアップ・アーカイブ・ロールバックを備える。

const RHC_PREVIEW_SHEET_20260101_ = 'reorder_history_cleanup_preview';
const RHC_LOG_SHEET_20260101_ = 'reorder_history_cleanup_log';
const RHC_PREVIEW_PROPERTY_20260101_ = 'REORDER_HISTORY_CLEANUP_PREVIEW_20260101';
const RHC_OPENING_DATE_20260101_ = '2026-01-01';
const RHC_OPENING_ID_PREFIX_20260101_ = 'opening_20260101_';
const RHC_OPENING_NOTE_MARKER_20260101_ = '[OPENING_INVENTORY:2026-01-01]';
const RHC_MANUAL_NOTE_20260101_ = '[LEGACY_MANUAL] 既存手入力（履歴整理時にSKU補完）';
const RHC_COST_FALLBACK_PREVIEW_SHEET_ = 'cost_fallback_import_preview';
const RHC_COST_FALLBACK_PREVIEW_PROPERTY_ = 'COST_FALLBACK_FROM_CLEANUP_PREVIEW';
const RHC_COST_FALLBACK_EFFECTIVE_FROM_ = '2026-01-01';
const RHC_EXPECTED_20260101_ = {
  sourceRows: 478,
  openingRows: 103,
  archiveRows: 184,
  liveRows: 191,
  repairProductIdRows: 74,
  repairSkuRows: 19,
  untouchedLiveRows: 98,
  duplicateRows: 0,
  reviewRows: 0,
  finalRows: 294
};

const RHC_SYNTHETIC_NOTE_PREFIXES_20260101_ = [
  'moving_avg_cost_issues取込',
  'missing_skus取込',
  'uncalculated取込',
  '初期原価補完候補'
];

/**
 * 最新売上年の全期間で原価未計算のSKUと、発注履歴整理プレビューのアーカイブ行を照合する。
 * 本番データは変更せず、SKU完全一致した仮原価候補だけを確認シートへ出力する。
 */
function createMissingCostFallbackPreviewFromCleanup() {
  const plan = rhcBuildCostFallbackPlan_();
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(RHC_COST_FALLBACK_PREVIEW_SHEET_);
  if (!sheet) sheet = ss.insertSheet(RHC_COST_FALLBACK_PREVIEW_SHEET_);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();

  const headers = [
    '対象期間', '判定', 'ASIN', '商品名', 'SKU', '対象売上数量', '対象売上額',
    '採用仮原価', '候補入荷日', '元行', '元処理', '元分類', '元ID',
    '候補数', '候補原価一覧', '適用開始日', '登録メモ'
  ];
  const rows = plan.items.map(function(item) {
    return [
      plan.periodLabel, item.decision, item.asin, item.title, item.sku,
      item.orderQty, item.net, item.unitCost || '', item.sourceDate,
      item.sourceRow || '', item.sourceAction, item.sourceCategory, item.sourceId,
      item.candidateCount, item.candidateCosts.join(', '),
      item.unitCost ? RHC_COST_FALLBACK_EFFECTIVE_FROM_ : '', item.note
    ];
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21').setFontColor('#e8d5a3').setFontWeight('bold');
  if (rows.length) {
    sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat('¥#,##0');
    sheet.getRange(2, 8, rows.length, 1).setNumberFormat('¥#,##0.00');
    sheet.getRange(2, 16, rows.length, 1).setNumberFormat('@');
    const colors = plan.items.map(function(item) {
      if (item.decision === '採用予定') return ['#d9ead3'];
      if (item.decision === '既存仮原価あり') return ['#fff2cc'];
      return ['#f4cccc'];
    });
    sheet.getRange(2, 2, colors.length, 1).setBackgrounds(colors);
  }
  sheet.autoResizeColumns(1, headers.length);
  sheet.setColumnWidth(4, 280);
  sheet.setColumnWidth(15, 220);
  sheet.setColumnWidth(17, 440);

  PropertiesService.getDocumentProperties().setProperty(
    RHC_COST_FALLBACK_PREVIEW_PROPERTY_,
    JSON.stringify({
      fingerprint: plan.fingerprint,
      targetYear: plan.targetYear,
      generatedAt: new Date().toISOString(),
      registerCount: plan.registerItems.length
    })
  );

  const message = [
    '仮原価候補プレビューを作成しました。',
    '',
    '対象期間: ' + plan.periodLabel,
    '原価未計算SKU: ' + plan.items.length + '件',
    'SKU一致・採用予定: ' + plan.registerItems.length + '件',
    '候補なし: ' + plan.noCandidateCount + '件',
    '既存仮原価あり: ' + plan.existingCount + '件',
    '',
    RHC_COST_FALLBACK_PREVIEW_SHEET_ + ' を確認してください。'
  ].join('\n');
  Logger.log(message);
  return rhcPublicCostFallbackPlan_(plan);
}

/**
 * 直前の確認シートと同一内容であることを検査し、採用予定行を仮原価シートへ登録する。
 */
function applyMissingCostFallbacksFromCleanupPreview() {
  const previewRaw = PropertiesService.getDocumentProperties().getProperty(RHC_COST_FALLBACK_PREVIEW_PROPERTY_);
  if (!previewRaw) throw new Error('先に createMissingCostFallbackPreviewFromCleanup を実行してください。');
  const preview = JSON.parse(previewRaw);
  const plan = rhcBuildCostFallbackPlan_();
  if (preview.fingerprint !== plan.fingerprint || preview.targetYear !== plan.targetYear) {
    throw new Error('プレビュー後に対象データが変わりました。仮原価候補プレビューを作り直してください。');
  }
  if (!plan.registerItems.length) {
    Logger.log('新たに登録できる仮原価候補はありません。');
    return rhcPublicCostFallbackPlan_(plan);
  }

  const ss = getSpreadsheet_();
  let fallbackSheet = ss.getSheetByName(SHEET_MANUAL_COST_FALLBACK);
  const originalValues = fallbackSheet ? fallbackSheet.getDataRange().getValues() : null;
  const registered = [];
  try {
    plan.registerItems.forEach(function(item) {
      registered.push(upsertManualCostFallback_({
        sku: item.sku,
        asin: item.asin,
        unit_cost: item.unitCost,
        effective_from: RHC_COST_FALLBACK_EFFECTIVE_FROM_,
        note: item.note
      }));
    });
  } catch (err) {
    fallbackSheet = ss.getSheetByName(SHEET_MANUAL_COST_FALLBACK);
    if (fallbackSheet) {
      fallbackSheet.clearContents();
      if (originalValues && originalValues.length) {
        fallbackSheet.getRange(1, 1, originalValues.length, originalValues[0].length).setValues(originalValues);
      } else {
        fallbackSheet.getRange(1, 1, 1, REQUIRED_HEADERS_MANUAL_COST_FALLBACK.length)
          .setValues([REQUIRED_HEADERS_MANUAL_COST_FALLBACK]);
      }
    }
    throw new Error('仮原価登録をロールバックしました: ' + String(err && err.message ? err.message : err));
  }

  PropertiesService.getDocumentProperties().deleteProperty(RHC_COST_FALLBACK_PREVIEW_PROPERTY_);
  const message = [
    '仮原価の登録が完了しました。',
    '',
    '登録件数: ' + registered.length + '件',
    '適用開始日: ' + RHC_COST_FALLBACK_EFFECTIVE_FROM_,
    '',
    'React画面を再読み込みすると粗利が再計算され、',
    '仮原価使用中の警告として表示されます。'
  ].join('\n');
  Logger.log(message);
  return { status: 'ok', targetYear: plan.targetYear, periodLabel: plan.periodLabel, registered: registered };
}

function rhcBuildCostFallbackPlan_() {
  const ss = getSpreadsheet_();
  const cleanupSheet = ss.getSheetByName(RHC_PREVIEW_SHEET_20260101_);
  if (!cleanupSheet) throw new Error(RHC_PREVIEW_SHEET_20260101_ + ' が見つかりません。');
  const values = cleanupSheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error(RHC_PREVIEW_SHEET_20260101_ + ' にデータがありません。');
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const required = ['元行', '処理', '分類', 'id', '元SKU', '新SKU', '入荷日', '着地原価'];
  rhcRequireHeaders20260101_(headers, required, RHC_PREVIEW_SHEET_20260101_);
  const col = rhcHeaderMap20260101_(headers);

  const candidatesBySku = {};
  values.slice(1).forEach(function(row) {
    const action = String(row[col['処理']] || '').trim();
    if (action !== 'ARCHIVE' && action !== 'DUPLICATE') return;
    const sku = String(row[col['新SKU']] || row[col['元SKU']] || '').trim();
    const unitCost = rhcNumber20260101_(row[col['着地原価']]);
    if (!sku || !(unitCost > 0)) return;
    if (!candidatesBySku[sku]) candidatesBySku[sku] = [];
    candidatesBySku[sku].push({
      sku: sku,
      unitCost: unitCost,
      sourceDate: rhcDateKey20260101_(row[col['入荷日']]),
      sourceRow: rhcNumber20260101_(row[col['元行']]),
      sourceAction: action,
      sourceCategory: String(row[col['分類']] || '').trim(),
      sourceId: String(row[col['id']] || '').trim()
    });
  });
  Object.keys(candidatesBySku).forEach(function(sku) {
    candidatesBySku[sku].sort(function(a, b) {
      return String(b.sourceDate).localeCompare(String(a.sourceDate)) ||
        (b.sourceRow - a.sourceRow);
    });
  });

  const periods = rhcLatestTransactionYearPeriods_();
  if (!periods.length) throw new Error('transaction_history に対象期間がありません。');
  const targetYear = periods[0].slice(0, 4);
  const activeFallbacks = readManualCostFallbackMap_();
  const targetMap = {};
  periods.forEach(function(period) {
    const diagnosis = diagnoseMissingCostSources(period);
    diagnosis.rows.forEach(function(product) {
      if (product.status !== 'uncosted' && product.status !== 'partial') return;
      (product.skus || []).forEach(function(skuRow) {
        const sku = String(skuRow.sku || '').trim();
        if (!sku) return;
        if (!targetMap[sku]) {
          targetMap[sku] = {
            asin: String(product.asin || '').trim().toUpperCase(),
            title: String(product.title || product.asin || '').trim(),
            sku: sku,
            periods: [],
            orderQty: 0,
            net: 0
          };
        }
        if (targetMap[sku].periods.indexOf(period) < 0) targetMap[sku].periods.push(period);
        targetMap[sku].orderQty += Math.max(0, (skuRow.order_qty || 0) - (skuRow.return_qty || 0));
        targetMap[sku].net += skuRow.net || 0;
      });
    });
  });

  const items = Object.keys(targetMap).sort().map(function(sku) {
    const target = targetMap[sku];
    const candidates = candidatesBySku[sku] || [];
    const selected = candidates[0] || null;
    const existing = activeFallbacks[sku] || null;
    let decision = '候補なし';
    if (existing) decision = '既存仮原価あり';
    else if (selected) decision = '採用予定';
    const note = selected ? [
      '[CLEANUP_PREVIEW_FALLBACK]',
      'reorder_history_cleanup_previewからSKU一致で採用',
      '元行=' + selected.sourceRow,
      '分類=' + selected.sourceCategory,
      '元ID=' + selected.sourceId
    ].join(' / ') : '';
    return {
      decision: decision,
      asin: target.asin,
      title: target.title,
      sku: sku,
      periods: target.periods,
      orderQty: target.orderQty,
      net: Math.round(target.net),
      unitCost: selected ? selected.unitCost : null,
      sourceDate: selected ? selected.sourceDate : '',
      sourceRow: selected ? selected.sourceRow : null,
      sourceAction: selected ? selected.sourceAction : '',
      sourceCategory: selected ? selected.sourceCategory : '',
      sourceId: selected ? selected.sourceId : '',
      candidateCount: candidates.length,
      candidateCosts: candidates.map(function(candidate) {
        return candidate.sourceDate + '=¥' + candidate.unitCost;
      }),
      note: note
    };
  });
  const registerItems = items.filter(function(item) { return item.decision === '採用予定'; });
  const periodLabel = periods[0] + '〜' + periods[periods.length - 1];
  return {
    targetYear: targetYear,
    periodLabel: periodLabel,
    periods: periods,
    items: items,
    registerItems: registerItems,
    noCandidateCount: items.filter(function(item) { return item.decision === '候補なし'; }).length,
    existingCount: items.filter(function(item) { return item.decision === '既存仮原価あり'; }).length,
    fingerprint: rhcCostFallbackFingerprint_(targetYear, items)
  };
}

function rhcLatestTransactionYearPeriods_() {
  const allPeriods = readTransactionRows_().map(function(row) {
    return String(row.period || '').trim();
  }).filter(function(period) {
    return /^\d{4}-\d{2}$/.test(period);
  }).filter(function(period, index, array) {
    return array.indexOf(period) === index;
  }).sort();
  if (!allPeriods.length) return [];
  const latestYear = allPeriods[allPeriods.length - 1].slice(0, 4);
  return allPeriods.filter(function(period) { return period.slice(0, 4) === latestYear; });
}

function rhcCostFallbackFingerprint_(targetYear, items) {
  const source = JSON.stringify({
    targetYear: targetYear,
    items: items.map(function(item) {
      return [item.decision, item.asin, item.sku, item.periods, item.unitCost, item.sourceDate, item.sourceRow, item.sourceId];
    })
  });
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8);
  return bytes.map(function(value) {
    return ((value + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function rhcPublicCostFallbackPlan_(plan) {
  return {
    status: 'ok',
    targetYear: plan.targetYear,
    periodLabel: plan.periodLabel,
    periods: plan.periods,
    missingSkuCount: plan.items.length,
    registerCount: plan.registerItems.length,
    noCandidateCount: plan.noCandidateCount,
    existingCount: plan.existingCount,
    candidates: plan.items
  };
}

/**
 * 本番データは変更せず、全行の整理方針を確認シートへ出力する。
 */
function createReorderHistoryCleanupPreview20260101() {
  const plan = rhcBuildPlan20260101_();
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(RHC_PREVIEW_SHEET_20260101_);
  if (!sheet) sheet = ss.insertSheet(RHC_PREVIEW_SHEET_20260101_);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();

  const headers = [
    '元行', '処理', '分類', '理由', 'id',
    '元product_id', '新product_id', '元SKU', '新SKU',
    '入荷日', '数量', '着地原価', '備考'
  ];
  const rows = plan.items.map(function(item) {
    return [
      item.sourceRow, item.action, item.category, item.reason, item.id,
      item.originalProductId, item.nextProductId, item.originalSku, item.nextSku,
      item.orderDate, item.quantity, item.unitCost, item.nextNotes
    ];
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21').setFontColor('#e8d5a3').setFontWeight('bold');
  if (rows.length) {
    sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
    sheet.getRange(2, 10, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 11, rows.length, 1).setNumberFormat('0');
    sheet.getRange(2, 12, rows.length, 1).setNumberFormat('¥#,##0.00');
  }
  sheet.setColumnWidth(1, 65);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 330);
  sheet.setColumnWidth(5, 280);
  sheet.setColumnWidths(6, 4, 230);
  sheet.setColumnWidth(10, 105);
  sheet.setColumnWidths(11, 2, 105);
  sheet.setColumnWidth(13, 420);
  rhcApplyPreviewColors20260101_(sheet, plan.items);

  PropertiesService.getDocumentProperties().setProperty(
    RHC_PREVIEW_PROPERTY_20260101_,
    JSON.stringify({
      fingerprint: plan.fingerprint,
      generatedAt: new Date().toISOString(),
      sourceRows: plan.sourceRows,
      archiveRows: plan.archiveRows.length,
      finalRows: plan.finalRows.length
    })
  );

  const lines = rhcSummaryLines20260101_(plan, '発注履歴 整理プレビュー');
  if (plan.errors.length) {
    lines.push('', 'エラー:', plan.errors.slice(0, 10).join('\n'));
  } else {
    lines.push('', '検査合格です。プレビューシートを確認後、本番反映できます。');
  }
  SpreadsheetApp.getUi().alert(lines.join('\n'));
  return rhcPublicPlan20260101_(plan);
}

/**
 * プレビュー時と同一のreorder_historyだけを本番整理する。
 */
function applyReorderHistoryCleanup20260101() {
  const ui = SpreadsheetApp.getUi();
  let plan = rhcBuildPlan20260101_();
  rhcThrowIfInvalid20260101_(plan);

  const previewRaw = PropertiesService.getDocumentProperties().getProperty(RHC_PREVIEW_PROPERTY_20260101_);
  if (!previewRaw) throw new Error('先に「発注履歴 整理プレビューを作成」を実行してください。');
  const preview = JSON.parse(previewRaw);
  if (preview.fingerprint !== plan.fingerprint) {
    throw new Error('プレビュー後にreorder_historyが変更されています。プレビューを作り直してください。');
  }

  const answer = ui.alert(
    '発注履歴を本番整理',
    [
      '現在の478件を294件へ整理します。',
      '',
      '保護する期首在庫: 103件',
      '残す実発注・手入力: 191件',
      'アーカイブ: 184件',
      'product_id補完: 74件',
      'SKU補完: 19件',
      '',
      '実行直前に全体バックアップを作成します。実行しますか？'
    ].join('\n'),
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return { status: 'cancelled' };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let mutationStarted = false;
  let originalValues = null;
  let reorderSheet = null;
  let backupName = '';
  let archiveName = '';
  try {
    plan = rhcBuildPlan20260101_();
    rhcThrowIfInvalid20260101_(plan);
    if (preview.fingerprint !== plan.fingerprint) {
      throw new Error('確認画面の表示中にreorder_historyが変更されました。プレビューを作り直してください。');
    }

    const ss = getSpreadsheet_();
    reorderSheet = ss.getSheetByName(SHEET_REORDER_HISTORY);
    originalValues = reorderSheet.getDataRange().getValues();
    backupName = rhcBackupSheet20260101_(ss, reorderSheet);
    archiveName = rhcCreateArchiveSheet20260101_(ss, plan);

    mutationStarted = true;
    const dataRowCount = Math.max(0, reorderSheet.getLastRow() - 1);
    if (dataRowCount) {
      reorderSheet.getRange(2, 1, dataRowCount, reorderSheet.getLastColumn()).clearContent();
    }
    if (plan.finalRows.length) {
      reorderSheet.getRange(2, 1, plan.finalRows.length, plan.headers.length).setValues(plan.finalRows);
    }

    const verification = rhcVerifyAfterCleanup20260101_();
    if (verification.errors.length) {
      throw new Error('整理後検査に失敗しました: ' + verification.errors.join(' / '));
    }
    rhcWriteCleanupLog20260101_(ss, 'success', plan, backupName, archiveName, '');
    PropertiesService.getDocumentProperties().deleteProperty(RHC_PREVIEW_PROPERTY_20260101_);

    ui.alert([
      '発注履歴の整理が完了しました。',
      '',
      '整理後: ' + verification.totalRows + '件',
      '期首在庫: ' + verification.openingRows + '件',
      'アーカイブ: ' + plan.archiveRows.length + '件',
      'product_id / SKU欠損: 0件',
      '',
      'バックアップ: ' + backupName,
      'アーカイブ: ' + archiveName
    ].join('\n'));
    return {
      status: 'ok',
      finalRows: verification.totalRows,
      openingRows: verification.openingRows,
      archivedRows: plan.archiveRows.length,
      backupSheet: backupName,
      archiveSheet: archiveName
    };
  } catch (err) {
    if (mutationStarted && reorderSheet && originalValues && originalValues.length) {
      const currentRows = Math.max(0, reorderSheet.getLastRow() - 1);
      if (currentRows) reorderSheet.getRange(2, 1, currentRows, reorderSheet.getLastColumn()).clearContent();
      if (originalValues.length > 1) {
        reorderSheet.getRange(2, 1, originalValues.length - 1, originalValues[0].length)
          .setValues(originalValues.slice(1));
      }
    }
    try {
      rhcWriteCleanupLog20260101_(getSpreadsheet_(), 'rolled_back', plan, backupName, archiveName, String(err && err.message ? err.message : err));
    } catch (logErr) {
      Logger.log('cleanup rollback log failed: ' + logErr);
    }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function rhcBuildPlan20260101_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_REORDER_HISTORY);
  if (!sheet) throw new Error(SHEET_REORDER_HISTORY + ' が見つかりません。');
  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error(SHEET_REORDER_HISTORY + ' にヘッダーがありません。');
  const headers = values[0].map(function(h) { return String(h || '').trim(); });
  rhcRequireHeaders20260101_(headers, REQUIRED_HEADERS_REORDER, SHEET_REORDER_HISTORY);
  const col = rhcHeaderMap20260101_(headers);
  const maps = rhcBuildMasterMaps20260101_(ss);
  const errors = [];
  const items = [];

  values.slice(1).forEach(function(row, offset) {
    if (!row.some(function(value) { return String(value || '').trim() !== ''; })) return;
    const item = rhcClassifyRow20260101_(row, offset + 2, headers, col, maps);
    items.push(item);
  });

  // 最終的に残す行だけ、補完後の全フィールドが同一なら後続行を重複としてアーカイブする。
  const seenExact = {};
  items.forEach(function(item) {
    if (['PROTECT', 'KEEP', 'REPAIR'].indexOf(item.action) < 0) return;
    const key = rhcExactKey20260101_(item.nextRow, col);
    if (seenExact[key]) {
      item.action = 'DUPLICATE';
      item.category = '完全重複';
      item.reason = '同一内容の先行レコード ' + seenExact[key] + ' を残す';
    } else {
      seenExact[key] = item.id || ('元行' + item.sourceRow);
    }
  });

  items.filter(function(item) { return item.action === 'REVIEW'; }).forEach(function(item) {
    errors.push('行' + item.sourceRow + ' ' + (item.id || '-') + ': ' + item.reason);
  });

  const openingItems = items.filter(function(item) { return item.action === 'PROTECT'; });
  const archiveItems = items.filter(function(item) { return item.action === 'ARCHIVE' || item.action === 'DUPLICATE'; });
  const liveItems = items.filter(function(item) { return item.action === 'KEEP' || item.action === 'REPAIR'; });
  const finalItems = items.filter(function(item) { return item.action === 'PROTECT' || item.action === 'KEEP' || item.action === 'REPAIR'; });
  const repairPid = items.filter(function(item) { return item.repairedProductId; });
  const repairSku = items.filter(function(item) { return item.repairedSku; });
  const untouched = items.filter(function(item) { return item.action === 'KEEP'; });
  const duplicateItems = items.filter(function(item) { return item.action === 'DUPLICATE'; });
  const reviewItems = items.filter(function(item) { return item.action === 'REVIEW'; });

  const expected = RHC_EXPECTED_20260101_;
  rhcExpectCount20260101_(errors, '元データ', items.length, expected.sourceRows);
  rhcExpectCount20260101_(errors, '期首在庫', openingItems.length, expected.openingRows);
  rhcExpectCount20260101_(errors, 'アーカイブ', archiveItems.length, expected.archiveRows);
  rhcExpectCount20260101_(errors, '残す実発注・手入力', liveItems.length, expected.liveRows);
  rhcExpectCount20260101_(errors, 'product_id補完', repairPid.length, expected.repairProductIdRows);
  rhcExpectCount20260101_(errors, 'SKU補完', repairSku.length, expected.repairSkuRows);
  rhcExpectCount20260101_(errors, '補完不要の実履歴', untouched.length, expected.untouchedLiveRows);
  rhcExpectCount20260101_(errors, '完全重複', duplicateItems.length, expected.duplicateRows);
  rhcExpectCount20260101_(errors, '要確認', reviewItems.length, expected.reviewRows);
  rhcExpectCount20260101_(errors, '整理後', finalItems.length, expected.finalRows);

  return {
    headers: headers,
    sourceRows: items.length,
    items: items,
    archiveRows: archiveItems.map(function(item) { return item; }),
    finalRows: finalItems.map(function(item) { return item.nextRow; }),
    openingRows: openingItems.length,
    liveRows: liveItems.length,
    repairProductIdRows: repairPid.length,
    repairSkuRows: repairSku.length,
    untouchedLiveRows: untouched.length,
    duplicateRows: duplicateItems.length,
    reviewRows: reviewItems.length,
    errors: errors,
    fingerprint: rhcFingerprint20260101_(values)
  };
}

function rhcClassifyRow20260101_(row, sourceRow, headers, col, maps) {
  const next = row.slice();
  const id = String(row[col.id] || '').trim();
  const originalProductId = String(row[col.product_id] || '').trim();
  const originalSku = String(row[col.sku] || '').trim();
  const orderDate = rhcDateKey20260101_(row[col.order_date]);
  const quantity = rhcNumber20260101_(row[col.quantity]);
  const unitCost = rhcNumber20260101_(row[col.landed_cost_actual]);
  const notes = String(row[col.notes] || '').trim();
  const isOpening = id.indexOf(RHC_OPENING_ID_PREFIX_20260101_) === 0 ||
    notes.indexOf(RHC_OPENING_NOTE_MARKER_20260101_) === 0;
  const syntheticPrefix = RHC_SYNTHETIC_NOTE_PREFIXES_20260101_.find(function(prefix) {
    return notes.indexOf(prefix) === 0;
  });
  const isTaxInitial = notes.indexOf('初期在庫原価') >= 0 || notes.indexOf('確定申告採用原価') >= 0;
  const isRakumart = notes.indexOf('依頼書:') === 0;
  const isManual = !notes;

  let action = '';
  let category = '';
  let reason = '';

  if (isOpening) {
    action = 'PROTECT';
    category = '期首在庫';
    reason = '2026-01-01期首在庫として保護';
  } else if (syntheticPrefix) {
    action = 'ARCHIVE';
    category = '旧原価補完';
    reason = syntheticPrefix + 'は期首在庫に置換済み';
  } else if (isTaxInitial) {
    action = 'ARCHIVE';
    category = '旧期首原価';
    reason = '旧期首原価は今回の数量付き期首在庫に置換済み';
  } else if (orderDate && orderDate <= RHC_OPENING_DATE_20260101_) {
    action = 'ARCHIVE';
    category = '期首以前の実発注';
    reason = '2025-12-31在庫元帳に含まれるため期首在庫と重複';
  } else if (isRakumart) {
    action = 'KEEP';
    category = 'ラクマート実発注';
    reason = '2026-01-02以降の実発注として維持';
  } else if (isManual) {
    action = 'KEEP';
    category = '既存手入力';
    reason = '2026-01-02以降の手入力履歴として維持';
  } else {
    action = 'REVIEW';
    category = '未分類';
    reason = '由来を自動判定できない備考です';
  }

  let nextProductId = originalProductId;
  let nextSku = originalSku;
  let nextNotes = notes;
  let repairedProductId = false;
  let repairedSku = false;

  if (['PROTECT', 'KEEP'].indexOf(action) >= 0) {
    const validation = [];
    if (!id) validation.push('idが空です');
    if (!orderDate) validation.push('入荷日が空です');
    if (!(quantity > 0)) validation.push('数量が0以下です');
    if (!(unitCost > 0)) validation.push('着地原価が0以下です');
    if (isOpening && orderDate !== RHC_OPENING_DATE_20260101_) validation.push('期首在庫の日付が2026-01-01ではありません');

    if (!nextProductId && nextSku) {
      const asinFromSku = rhcOnlyValue20260101_(maps.skuToAsins[nextSku] || []);
      const productFromAsin = asinFromSku ? rhcOnlyValue20260101_(maps.asinToProductIds[asinFromSku] || []) : '';
      if (productFromAsin) {
        nextProductId = productFromAsin;
        next[col.product_id] = nextProductId;
        repairedProductId = true;
      } else {
        validation.push('SKUからproduct_idを一意に補完できません');
      }
    }
    if (!nextSku && nextProductId) {
      const asinFromProduct = maps.productIdToAsin[nextProductId] || '';
      const skuFromAsin = asinFromProduct ? rhcOnlyValue20260101_(maps.asinToSkus[asinFromProduct] || []) : '';
      if (skuFromAsin) {
        nextSku = skuFromAsin;
        next[col.sku] = nextSku;
        repairedSku = true;
      } else {
        validation.push('product_idからSKUを一意に補完できません');
      }
    }
    if (!nextProductId) validation.push('product_idが空です');
    if (!nextSku) validation.push('SKUが空です');

    const productAsin = maps.productIdToAsin[nextProductId] || '';
    const skuAsin = rhcOnlyValue20260101_(maps.skuToAsins[nextSku] || []);
    if (!productAsin) validation.push('product_idが商品マスタに存在しません');
    if (!skuAsin) validation.push('SKUがSKUマスタに存在しないかASINが一意ではありません');
    if (productAsin && skuAsin && productAsin !== skuAsin) validation.push('product_idとSKUのASINが一致しません');

    if (isManual && !validation.length) {
      nextNotes = RHC_MANUAL_NOTE_20260101_;
      next[col.notes] = nextNotes;
    }
    if (validation.length) {
      action = 'REVIEW';
      category = '要確認';
      reason = validation.join(' / ');
    } else if (repairedProductId || repairedSku || isManual) {
      action = 'REPAIR';
      reason += ' / ' + [
        repairedProductId ? 'product_id補完' : '',
        repairedSku ? 'SKU補完' : '',
        isManual ? '由来メモ付与' : ''
      ].filter(Boolean).join('・');
    }
  }

  return {
    sourceRow: sourceRow,
    action: action,
    category: category,
    reason: reason,
    id: id,
    originalProductId: originalProductId,
    nextProductId: nextProductId,
    originalSku: originalSku,
    nextSku: nextSku,
    orderDate: orderDate,
    quantity: quantity,
    unitCost: unitCost,
    originalNotes: notes,
    nextNotes: nextNotes,
    repairedProductId: repairedProductId,
    repairedSku: repairedSku,
    originalRow: row.slice(),
    nextRow: next
  };
}

function rhcBuildMasterMaps20260101_(ss) {
  const productSheet = ss.getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  const skuSheet = ss.getSheetByName(SHEET_SKU_MASTER);
  if (!productSheet) throw new Error(SHEET_PRODUCT_LIFECYCLE + ' が見つかりません。');
  if (!skuSheet) throw new Error(SHEET_SKU_MASTER + ' が見つかりません。');

  const productValues = productSheet.getDataRange().getValues();
  const productHeaders = (productValues[0] || []).map(function(h) { return String(h || '').trim(); });
  rhcRequireHeaders20260101_(productHeaders, ['id', 'asin'], SHEET_PRODUCT_LIFECYCLE);
  const p = rhcHeaderMap20260101_(productHeaders);
  const productIdToAsin = {};
  const asinToProductIds = {};
  productValues.slice(1).forEach(function(row) {
    const id = String(row[p.id] || '').trim();
    const asin = String(row[p.asin] || '').trim().toUpperCase();
    if (!id || !asin) return;
    productIdToAsin[id] = asin;
    rhcPushUnique20260101_(asinToProductIds, asin, id);
  });

  const skuValues = skuSheet.getDataRange().getValues();
  const skuHeaders = (skuValues[0] || []).map(function(h) { return String(h || '').trim(); });
  rhcRequireHeaders20260101_(skuHeaders, ['sku', 'asin'], SHEET_SKU_MASTER);
  const s = rhcHeaderMap20260101_(skuHeaders);
  const skuToAsins = {};
  const asinToSkus = {};
  skuValues.slice(1).forEach(function(row) {
    const sku = String(row[s.sku] || '').trim();
    const asin = String(row[s.asin] || '').trim().toUpperCase();
    if (!sku || !asin) return;
    rhcPushUnique20260101_(skuToAsins, sku, asin);
    rhcPushUnique20260101_(asinToSkus, asin, sku);
  });
  return {
    productIdToAsin: productIdToAsin,
    asinToProductIds: asinToProductIds,
    skuToAsins: skuToAsins,
    asinToSkus: asinToSkus
  };
}

function rhcVerifyAfterCleanup20260101_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_REORDER_HISTORY);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(h) { return String(h || '').trim(); });
  const col = rhcHeaderMap20260101_(headers);
  const errors = [];
  const ids = {};
  let totalRows = 0;
  let openingRows = 0;
  let missingProductId = 0;
  let missingSku = 0;

  values.slice(1).forEach(function(row, offset) {
    if (!row.some(function(value) { return String(value || '').trim() !== ''; })) return;
    totalRows++;
    const id = String(row[col.id] || '').trim();
    const productId = String(row[col.product_id] || '').trim();
    const sku = String(row[col.sku] || '').trim();
    const date = rhcDateKey20260101_(row[col.order_date]);
    const notes = String(row[col.notes] || '').trim();
    const opening = id.indexOf(RHC_OPENING_ID_PREFIX_20260101_) === 0 || notes.indexOf(RHC_OPENING_NOTE_MARKER_20260101_) === 0;
    if (opening) openingRows++;
    if (!productId) missingProductId++;
    if (!sku) missingSku++;
    if (ids[id]) errors.push('id重複: ' + id);
    ids[id] = true;
    if (!opening && date <= RHC_OPENING_DATE_20260101_) errors.push('期首以前の非期首行が残っています: ' + id);
    if (RHC_SYNTHETIC_NOTE_PREFIXES_20260101_.some(function(prefix) { return notes.indexOf(prefix) === 0; })) {
      errors.push('旧原価補完行が残っています: ' + id);
    }
    if (notes.indexOf('初期在庫原価') >= 0 || notes.indexOf('確定申告採用原価') >= 0) {
      errors.push('旧期首原価行が残っています: ' + id);
    }
    if (!(rhcNumber20260101_(row[col.quantity]) > 0)) errors.push('数量不正: ' + id);
    if (!(rhcNumber20260101_(row[col.landed_cost_actual]) > 0)) errors.push('着地原価不正: ' + id);
  });
  if (totalRows !== RHC_EXPECTED_20260101_.finalRows) errors.push('整理後行数が294件ではありません: ' + totalRows);
  if (openingRows !== RHC_EXPECTED_20260101_.openingRows) errors.push('期首在庫が103件ではありません: ' + openingRows);
  if (missingProductId) errors.push('product_id欠損が残っています: ' + missingProductId);
  if (missingSku) errors.push('SKU欠損が残っています: ' + missingSku);
  return {
    totalRows: totalRows,
    openingRows: openingRows,
    missingProductId: missingProductId,
    missingSku: missingSku,
    errors: errors
  };
}

function rhcCreateArchiveSheet20260101_(ss, plan) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const name = 'reorder_history_archive_' + timestamp;
  const sheet = ss.insertSheet(name);
  const metadataHeaders = ['cleanup_action', 'cleanup_category', 'cleanup_reason', 'original_row', 'archived_at'];
  const headers = plan.headers.concat(metadataHeaders);
  const now = new Date().toISOString();
  const rows = plan.archiveRows.map(function(item) {
    return item.originalRow.concat([item.action, item.category, item.reason, item.sourceRow, now]);
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#3b1f24').setFontColor('#ffffff').setFontWeight('bold');
  if (rows.length) sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
  sheet.hideSheet();
  return name;
}

function rhcBackupSheet20260101_(ss, sourceSheet) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const name = 'reorder_history_backup_cleanup_' + timestamp;
  const backup = sourceSheet.copyTo(ss).setName(name);
  backup.hideSheet();
  return name;
}

function rhcWriteCleanupLog20260101_(ss, status, plan, backupName, archiveName, message) {
  let sheet = ss.getSheetByName(RHC_LOG_SHEET_20260101_);
  if (!sheet) {
    sheet = ss.insertSheet(RHC_LOG_SHEET_20260101_);
    sheet.getRange(1, 1, 1, 10).setValues([[
      'timestamp', 'status', 'source_rows', 'final_rows', 'opening_rows',
      'archive_rows', 'repair_product_id_rows', 'repair_sku_rows', 'backup_sheet', 'message'
    ]]);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date().toISOString(), status, plan ? plan.sourceRows : '', plan ? plan.finalRows.length : '',
    plan ? plan.openingRows : '', plan ? plan.archiveRows.length : '',
    plan ? plan.repairProductIdRows : '', plan ? plan.repairSkuRows : '',
    backupName || '', [archiveName ? 'archive=' + archiveName : '', message || ''].filter(Boolean).join(' / ')
  ]);
}

function rhcApplyPreviewColors20260101_(sheet, items) {
  if (!items.length) return;
  const colors = items.map(function(item) {
    if (item.action === 'PROTECT') return ['#d9ead3'];
    if (item.action === 'KEEP') return ['#e8f0fe'];
    if (item.action === 'REPAIR') return ['#fff2cc'];
    if (item.action === 'ARCHIVE' || item.action === 'DUPLICATE') return ['#f4cccc'];
    return ['#fce5cd'];
  });
  sheet.getRange(2, 2, colors.length, 1).setBackgrounds(colors);
}

function rhcSummaryLines20260101_(plan, title) {
  return [
    title,
    '',
    '元データ: ' + plan.sourceRows + '件',
    '期首在庫を保護: ' + plan.openingRows + '件',
    '実発注・手入力を維持: ' + plan.liveRows + '件',
    'アーカイブ: ' + plan.archiveRows.length + '件',
    'product_id補完: ' + plan.repairProductIdRows + '件',
    'SKU補完: ' + plan.repairSkuRows + '件',
    '完全重複: ' + plan.duplicateRows + '件',
    '要確認: ' + plan.reviewRows + '件',
    '整理後: ' + plan.finalRows.length + '件',
    'エラー: ' + plan.errors.length + '件'
  ];
}

function rhcPublicPlan20260101_(plan) {
  return {
    status: plan.errors.length ? 'error' : 'ok',
    sourceRows: plan.sourceRows,
    openingRows: plan.openingRows,
    liveRows: plan.liveRows,
    archiveRows: plan.archiveRows.length,
    repairProductIdRows: plan.repairProductIdRows,
    repairSkuRows: plan.repairSkuRows,
    duplicateRows: plan.duplicateRows,
    reviewRows: plan.reviewRows,
    finalRows: plan.finalRows.length,
    errors: plan.errors
  };
}

function rhcThrowIfInvalid20260101_(plan) {
  if (!plan.errors.length) return;
  throw new Error('発注履歴の整理前検査で' + plan.errors.length + '件のエラーが見つかりました。\n' + plan.errors.slice(0, 12).join('\n'));
}

function rhcExpectCount20260101_(errors, label, actual, expected) {
  if (actual !== expected) errors.push(label + '件数が安全基準と不一致です（実際' + actual + ' / 期待' + expected + '）');
}

function rhcExactKey20260101_(row, col) {
  return [
    String(row[col.product_id] || '').trim(), String(row[col.sku] || '').trim(),
    rhcDateKey20260101_(row[col.order_date]), rhcNumber20260101_(row[col.quantity]),
    rhcNumber20260101_(row[col.unit_price_1688]), rhcNumber20260101_(row[col.landed_cost_actual]),
    rhcNumber20260101_(row[col.lead_time_days]), rhcDateKey20260101_(row[col.expected_arrival_date]),
    rhcNumber20260101_(row[col.fba_fee_at_order]), rhcNumber20260101_(row[col.selling_price_at_order]),
    String(row[col.notes] || '').trim()
  ].join('__');
}

function rhcFingerprint20260101_(values) {
  const normalized = values.map(function(row) {
    return row.map(function(value) {
      if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
      return value;
    });
  });
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(normalized),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(value) {
    return ((value + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function rhcRequireHeaders20260101_(headers, required, sheetName) {
  const missing = required.filter(function(header) { return headers.indexOf(header) < 0; });
  if (missing.length) throw new Error(sheetName + ' に必要な列がありません: ' + missing.join(', '));
}

function rhcHeaderMap20260101_(headers) {
  const map = {};
  headers.forEach(function(header, index) { if (header) map[header] = index; });
  return map;
}

function rhcPushUnique20260101_(map, key, value) {
  if (!map[key]) map[key] = [];
  if (map[key].indexOf(value) < 0) map[key].push(value);
}

function rhcOnlyValue20260101_(values) {
  return values.length === 1 ? values[0] : '';
}

function rhcNumber20260101_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const normalized = String(value || '').replace(/[￥¥,\s]/g, '');
  if (!normalized) return 0;
  const result = Number(normalized);
  return isFinite(result) ? result : 0;
}

function rhcDateKey20260101_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const match = String(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return String(value).trim().slice(0, 10);
  return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
}

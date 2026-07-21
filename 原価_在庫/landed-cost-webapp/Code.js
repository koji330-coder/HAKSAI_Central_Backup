/** HAKSAI landed cost pipeline - setup and data model */

const LC_PROP = PropertiesService.getScriptProperties();

const LC_DEFAULT_ROOT_FOLDER_ID = '1m_0CzRoXee5B_8OR-mRqQ_MqyuiLzS60';
const LC_TOOL_SPREADSHEET_NAME = 'HAKSAI 着地原価・請求書管理';

const LC_PROP_ROOT_FOLDER_ID = 'LC_ROOT_FOLDER_ID';
const LC_PROP_TOOL_SS_ID = 'LC_TOOL_SS_ID';
const LC_PROP_FOLDER_EXCEL = 'LC_FOLDER_EXCEL';
const LC_PROP_FOLDER_EXCEL_DONE = 'LC_FOLDER_EXCEL_DONE';
const LC_PROP_FOLDER_INBOX = 'LC_FOLDER_INBOX';
const LC_PROP_FOLDER_ARCHIVE = 'LC_FOLDER_ARCHIVE';
const LC_PROP_GEMINI_API_KEY = 'GEMINI_API_KEY';
const LC_PROP_GEMINI_MODEL = 'GEMINI_MODEL';
const LC_PROP_CENTRAL_SS_ID = 'HAKSAI_SS_ID';
const LC_PROP_CENTRAL_SS_ID_ALT = 'CENTRAL_SS_ID';
const LC_PROP_ALERT_MAIL_TO = 'ALERT_MAIL_TO';

const LC_SHEET_IMPORT_INVOICES = 'import_invoices';
const LC_SHEET_INVOICE_LEDGER = 'invoice_ledger';
const LC_SHEET_ITEMS = '商品別';
const LC_SHEET_PROCESSED = '処理済み';
const LC_CENTRAL_SHEET_SKU_MASTER = 'sku_master';
const LC_CENTRAL_SHEET_PRODUCT_LIFECYCLE = 'product_lifecycle';
const LC_CENTRAL_SHEET_REORDER_HISTORY = 'reorder_history';

const LC_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const LC_DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const LC_IMPORT_INVOICE_HEADERS = [
  'rw_no',
  'p_no',
  'invoice_no',
  'invoice_issue_date',
  'total_amount',
  'exchange_rate',
  'fba_arrival_date',
  'confirmed',
  'pdf_link',
  'note',
  'created_at',
  'updated_at'
];

const LC_INVOICE_LEDGER_HEADERS = [
  'id',
  'doc_type',
  'issuer',
  'invoice_no',
  'issue_date',
  'due_date',
  'amount',
  'payment_status',
  'paid_date',
  'rw_no',
  'drive_file_id',
  'drive_url',
  'extract_source',
  'confirmed',
  'note',
  'created_at',
  'updated_at'
];

const LC_ITEM_HEADERS = [
  '配送依頼書',
  '配送依頼書NO',
  '注文番号',
  '商品番号',
  '写真',
  '商品情報',
  '購入数',
  '出荷可能数',
  '出荷数',
  '単価（元）',
  '国内運賃（元）',
  '小计（元）',
  'オプション費用',
  'オプション',
  'ラベル種類',
  'ラベル番号',
  '商品コード',
  '箱詰め備考',
  'スタッフ',
  '所在箱',
  '仕入単価(円)',
  '仕入合計(円)',
  'sync_at'
];

const LC_PROCESSED_HEADERS = [
  'processed_at',
  'file_link',
  'p_no',
  'rw_no',
  'exchange_rate',
  'product_total_yen',
  'service_fee_yen',
  'international_shipping_yen',
  'domestic_shipping_yuan',
  'domestic_shipping_yen',
  'option_fee_yuan',
  'option_fee_yen',
  'invoice_amount_yen',
  'total_landed_cost_yen',
  'item_count',
  'source'
];

const LC_TEXT_FORMAT_HEADERS = [
  'rw_no',
  'p_no',
  'invoice_no',
  'invoice_issue_date',
  'fba_arrival_date',
  'issue_date',
  'due_date',
  'paid_date',
  'drive_file_id',
  '配送依頼書NO',
  '注文番号',
  '商品番号',
  'ラベル番号',
  '商品コード'
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('着地原価')
    .addItem('初期セットアップ', 'setupAll')
    .addItem('請求書インボックス取込', 'processInvoiceInbox')
    .addItem('確認済み請求書を整理', 'organizeConfirmedInvoices')
    .addItem('Excel計算実行', 'processImportCost')
    .addItem('CENTRAL同期 dry-run', 'syncToReorderHistoryDryRun')
    .addItem('支払期限を確認', 'checkPaymentDue')
    .addItem('支払監視トリガーを設定', 'setupPaymentDueTrigger')
    .addItem('セットアップ状態を確認', 'showSetupStatus')
    .addToUi();
}

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.setupStatus = getSetupStatus_();
  return template.evaluate()
    .setTitle('HAKSAI 着地原価')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupAll(options) {
  options = options || {};
  const rootFolderId = String(options.rootFolderId || LC_PROP.getProperty(LC_PROP_ROOT_FOLDER_ID) || LC_DEFAULT_ROOT_FOLDER_ID).trim();
  if (!rootFolderId) throw new Error('LC_ROOT_FOLDER_ID が未設定です。');

  const root = DriveApp.getFolderById(rootFolderId);
  LC_PROP.setProperty(LC_PROP_ROOT_FOLDER_ID, rootFolderId);

  const spreadsheet = getOrCreateToolSpreadsheet_(root);
  const sheetResult = ensureAllSheets_(spreadsheet);
  const folderResult = ensureFolderTree_(root);

  const result = {
    status: 'ok',
    spreadsheet: {
      id: spreadsheet.getId(),
      name: spreadsheet.getName(),
      url: spreadsheet.getUrl()
    },
    rootFolder: {
      id: root.getId(),
      name: root.getName(),
      url: root.getUrl()
    },
    sheets: sheetResult,
    folders: folderResult
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function showSetupStatus() {
  const status = getSetupStatus_();
  SpreadsheetApp.getUi().alert(JSON.stringify(status, null, 2));
  return status;
}

function getSetupStatus_() {
  const props = LC_PROP.getProperties();
  const keys = [
    LC_PROP_ROOT_FOLDER_ID,
    LC_PROP_TOOL_SS_ID,
    LC_PROP_FOLDER_EXCEL,
    LC_PROP_FOLDER_EXCEL_DONE,
    LC_PROP_FOLDER_INBOX,
    LC_PROP_FOLDER_ARCHIVE
  ];
  const values = {};
  keys.forEach(function(key) {
    values[key] = props[key] || '';
  });

  const status = { configured: true, properties: values, missing: [] };
  keys.forEach(function(key) {
    if (!values[key]) {
      status.configured = false;
      status.missing.push(key);
    }
  });
  return status;
}

function getClientConfig() {
  const status = getSetupStatus_();
  return {
    setupStatus: status,
    maxUploadBytes: LC_UPLOAD_MAX_BYTES,
    routes: [
      { kind: 'excel', label: 'Excel入庫', extensions: ['xlsx', 'xls'] },
      { kind: 'invoice', label: '請求書インボックス', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }
    ]
  };
}

function uploadFile(payload) {
  payload = payload || {};
  const name = sanitizeFileName_(payload.name || '');
  const mimeType = String(payload.mimeType || 'application/octet-stream');
  const kind = String(payload.kind || '');
  const base64 = String(payload.base64 || '').replace(/^data:[^,]+,/, '');
  if (!name) throw new Error('ファイル名がありません。');
  if (!base64) throw new Error('ファイルデータがありません。');

  const extension = getExtension_(name);
  validateUploadKind_(kind, extension);

  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > LC_UPLOAD_MAX_BYTES) {
    throw new Error('ファイルが大きすぎます。20MB以下にしてください: ' + name);
  }

  const folder = getUploadFolderByKind_(kind);
  const duplicate = findSameNameFile_(folder, name);
  let savedName = name;
  let status = 'SAVED';

  if (duplicate) {
    if (duplicate.getSize() === bytes.length) {
      return {
        status: 'DUP_SKIP',
        fileId: duplicate.getId(),
        savedName: duplicate.getName(),
        folderName: folder.getName(),
        size: duplicate.getSize(),
        url: duplicate.getUrl()
      };
    }
    savedName = addTimestampToName_(name);
    status = 'RENAMED';
  }

  const blob = Utilities.newBlob(bytes, mimeType, savedName);
  const file = folder.createFile(blob);
  return {
    status: status,
    fileId: file.getId(),
    savedName: file.getName(),
    folderName: folder.getName(),
    size: file.getSize(),
    url: file.getUrl()
  };
}

function processImportCost() {
  const ui = SpreadsheetApp.getUi();
  let result = coreProcessImportCost({});
  if (result.status === 'NEED_INPUT' && result.need === 'invoice_amount') {
    const amountResponse = ui.prompt(
      '関税請求書の金額',
      'RW番号: ' + result.rw_no + '\n請求書合計金額（税込）を入力してください。',
      ui.ButtonSet.OK_CANCEL
    );
    if (amountResponse.getSelectedButton() !== ui.Button.OK) return result;

    const dateResponse = ui.prompt(
      '請求書日付',
      '到着日の初期値に使う請求書日付を YYYY-MM-DD で入力してください。',
      ui.ButtonSet.OK_CANCEL
    );
    if (dateResponse.getSelectedButton() !== ui.Button.OK) return result;

    result = coreProcessImportCost({
      invoiceAmount: amountResponse.getResponseText(),
      invoiceIssueDate: dateResponse.getResponseText()
    });
  }
  ui.alert(JSON.stringify(result, null, 2));
  return result;
}

function runImportCost(options) {
  return coreProcessImportCost(options || {});
}

function processInvoiceInbox() {
  const result = coreProcessInvoiceInbox();
  SpreadsheetApp.getUi().alert(JSON.stringify(result, null, 2));
  return result;
}

function organizeConfirmedInvoices() {
  const result = coreOrganizeConfirmedInvoices();
  SpreadsheetApp.getUi().alert(JSON.stringify(result, null, 2));
  return result;
}

function runInvoiceInbox() {
  return coreProcessInvoiceInbox();
}

function runOrganizeConfirmedInvoices() {
  return coreOrganizeConfirmedInvoices();
}

function syncToReorderHistoryDryRun() {
  const result = coreSyncToReorderHistory({ dryRun: true });
  SpreadsheetApp.getUi().alert(JSON.stringify(result, null, 2));
  return result;
}

function syncToReorderHistory() {
  const result = coreSyncToReorderHistory({ dryRun: false });
  SpreadsheetApp.getUi().alert(JSON.stringify(result, null, 2));
  return result;
}

function runSyncToReorderHistoryDryRun() {
  return coreSyncToReorderHistory({ dryRun: true });
}

function runSyncToReorderHistory(options) {
  options = options || {};
  return coreSyncToReorderHistory({ dryRun: options.dryRun !== false });
}

function checkPaymentDue() {
  const result = coreCheckPaymentDue();
  SpreadsheetApp.getUi().alert(JSON.stringify(result, null, 2));
  return result;
}

function runCheckPaymentDue() {
  return coreCheckPaymentDue();
}

function setupPaymentDueTrigger() {
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'checkPaymentDueTrigger';
  }).forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('checkPaymentDueTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  return { status: 'ok', hour: 8 };
}

function checkPaymentDueTrigger() {
  return coreCheckPaymentDue();
}

function coreProcessInvoiceInbox() {
  const toolSS = getToolSpreadsheet_();
  ensureAllSheets_(toolSS);
  const inbox = getRequiredFolder_(LC_PROP_FOLDER_INBOX);
  const ledgerSheet = toolSS.getSheetByName(LC_SHEET_INVOICE_LEDGER);
  const existingFileIds = getLedgerFileIdSet_(ledgerSheet);
  const files = inbox.getFiles();
  let imported = 0;
  let gemini = 0;
  let manual = 0;
  let skipped = 0;
  const details = [];

  while (files.hasNext()) {
    const file = files.next();
    const extension = getExtension_(file.getName());
    if (['pdf', 'jpg', 'jpeg', 'png'].indexOf(extension) < 0) {
      skipped++;
      details.push({ fileName: file.getName(), status: 'SKIP_UNSUPPORTED' });
      continue;
    }
    if (existingFileIds[file.getId()]) {
      skipped++;
      details.push({ fileName: file.getName(), status: 'SKIP_DUPLICATE' });
      continue;
    }

    let extracted = null;
    let source = 'manual';
    try {
      extracted = extractInvoiceWithGemini_(file);
      source = 'gemini';
      gemini++;
    } catch (error) {
      Logger.log('Gemini請求書抽出失敗: ' + file.getName() + ' / ' + error);
      manual++;
      extracted = {};
    }

    appendInvoiceLedgerRow_(ledgerSheet, file, extracted, source);
    existingFileIds[file.getId()] = true;
    imported++;
    details.push({
      fileName: file.getName(),
      status: 'IMPORTED',
      source: source,
      rw_no: extracted.rw_no || '',
      amount: extracted.amount || ''
    });
  }

  const result = {
    status: imported ? 'OK' : 'NOTHING_TODO',
    imported: imported,
    gemini: gemini,
    manual: manual,
    skipped: skipped,
    details: details
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function coreOrganizeConfirmedInvoices() {
  const toolSS = getToolSpreadsheet_();
  ensureAllSheets_(toolSS);
  const inbox = getRequiredFolder_(LC_PROP_FOLDER_INBOX);
  const archiveRoot = getRequiredFolder_(LC_PROP_FOLDER_ARCHIVE);
  const ledgerSheet = toolSS.getSheetByName(LC_SHEET_INVOICE_LEDGER);
  const values = ledgerSheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = makeHeaderMap_(headers);
  let organized = 0;
  let bridged = 0;
  let skipped = 0;
  const details = [];

  for (let r = 1; r < values.length; r++) {
    const row = rowToObject_(headers, values[r], r + 1);
    if (!lcBool_(row.confirmed)) {
      skipped++;
      continue;
    }
    const fileId = String(row.drive_file_id || '').trim();
    if (!fileId) {
      skipped++;
      details.push({ row: r + 1, status: 'SKIP_NO_FILE_ID' });
      continue;
    }

    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (error) {
      skipped++;
      details.push({ row: r + 1, status: 'SKIP_FILE_NOT_FOUND', fileId: fileId });
      continue;
    }
    if (!isDirectChildOfFolder_(file, inbox)) {
      skipped++;
      continue;
    }

    const issueDate = normalizeDateString_(row.issue_date) || lcToday_();
    const archiveFolder = getArchiveMonthFolder_(archiveRoot, issueDate);
    const newName = buildArchiveFileName_(row, file.getName(), issueDate);
    file.setName(newName);
    moveFileToFolder_(file, archiveFolder);

    const driveUrl = file.getUrl();
    ledgerSheet.getRange(r + 1, col.drive_url + 1).setValue(driveUrl);
    ledgerSheet.getRange(r + 1, col.updated_at + 1).setValue(lcNowIso_());
    organized++;

    if (String(row.doc_type || '').trim() === '関税' && String(row.rw_no || '').trim()) {
      upsertImportInvoice_(toolSS, {
        rw_no: String(row.rw_no || '').trim(),
        invoice_no: String(row.invoice_no || '').trim(),
        invoice_issue_date: issueDate,
        total_amount: lcNum_(row.amount),
        fba_arrival_date: issueDate,
        confirmed: true,
        pdf_link: driveUrl,
        note: String(row.note || ''),
        updated_at: lcNowIso_()
      });
      bridged++;
    }

    details.push({
      row: r + 1,
      status: 'ORGANIZED',
      fileName: newName,
      doc_type: row.doc_type || '',
      rw_no: row.rw_no || ''
    });
  }

  const result = {
    status: organized ? 'OK' : 'NOTHING_TODO',
    organized: organized,
    bridged: bridged,
    skipped: skipped,
    details: details
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function coreSyncToReorderHistory(options) {
  options = options || {};
  const dryRun = options.dryRun !== false;
  const toolSS = getToolSpreadsheet_();
  ensureAllSheets_(toolSS);
  const centralSS = getCentralSpreadsheet_();

  const itemSheet = toolSS.getSheetByName(LC_SHEET_ITEMS);
  const itemRows = getSheetObjects_(itemSheet);
  const pendingRows = itemRows.filter(function(row) {
    return !String(row.sync_at || '').trim() && lcNum_(row['出荷数']) > 0;
  });
  if (!pendingRows.length) {
    return { status: 'NOTHING_TODO', dryRun: dryRun, summary: '未同期の商品別行がありません。' };
  }

  const invoiceByPNo = buildImportInvoiceByPNo_(toolSS);
  const centralMaps = buildCentralResolutionMaps_(centralSS);
  const reorderSheet = requireSheet_(centralSS, LC_CENTRAL_SHEET_REORDER_HISTORY);
  const reorderHeaders = getSheetHeaders_(reorderSheet);
  requireHeaders_(reorderHeaders, [
    'id', 'product_id', 'order_date', 'quantity', 'unit_price_1688',
    'landed_cost_actual', 'notes', 'created_at', 'sku'
  ], LC_CENTRAL_SHEET_REORDER_HISTORY);
  const existingNotes = buildExistingReorderNotes_(reorderSheet);

  const itemPNoFallback = buildItemRowPNoFallbackMap_(toolSS);
  const groups = groupBy_(pendingRows, function(row) {
    return getItemRowPNo_(row, itemPNoFallback[row._row]);
  });
  const appendObjects = [];
  const syncRows = [];
  const skipped = {
    duplicate: 0,
    missingInvoice: 0,
    missingPNo: 0,
    unresolvedSku: 0
  };
  const unresolvedSamples = [];
  const groupSummaries = [];
  let provisionalDateGroups = 0;

  Object.keys(groups).sort().forEach(function(pNo) {
    const rows = groups[pNo];
    if (!pNo) {
      skipped.missingPNo += rows.length;
      groupSummaries.push({ p_no: '', status: 'SKIP_MISSING_P_NO', rows: rows.length });
      return;
    }
    if (existingNotes['依頼書:' + pNo]) {
      skipped.duplicate += rows.length;
      groupSummaries.push({ p_no: pNo, status: 'SKIP_DUPLICATE_NOTES', rows: rows.length });
      return;
    }
    const invoice = invoiceByPNo[pNo];
    if (!invoice) {
      skipped.missingInvoice += rows.length;
      groupSummaries.push({ p_no: pNo, status: 'SKIP_MISSING_IMPORT_INVOICE', rows: rows.length });
      return;
    }
    const orderDate = normalizeDateString_(invoice.fba_arrival_date);
    const exchangeRate = lcNum_(invoice.exchange_rate);
    if (!orderDate || !exchangeRate) {
      skipped.missingInvoice += rows.length;
      groupSummaries.push({ p_no: pNo, status: 'SKIP_INCOMPLETE_IMPORT_INVOICE', rows: rows.length });
      return;
    }
    if (isProvisionalArrivalDate_(invoice)) provisionalDateGroups++;

    let addedInGroup = 0;
    rows.forEach(function(row) {
      const fnsku = String(row['ラベル番号'] || '').trim();
      const asin = String(row['商品コード'] || '').trim().toUpperCase();
      const resolved = resolveCentralProduct_(centralMaps, fnsku, asin);
      if (!resolved.product_id) {
        skipped.unresolvedSku++;
        if (unresolvedSamples.length < 10) {
          unresolvedSamples.push({
            p_no: pNo,
            fnsku: fnsku,
            asin: asin,
            row: row._row
          });
        }
        return;
      }

      const quantity = lcNum_(row['出荷数']);
      const unitPrice1688 = Math.round(lcNum_(row['単価（元）']) * exchangeRate);
      const landedCost = Math.round(lcNum_(row['仕入単価(円)']));
      const obj = {
        id: Utilities.getUuid(),
        product_id: resolved.product_id,
        sku: resolved.sku || fnsku,
        order_date: orderDate,
        quantity: quantity,
        unit_price_1688: unitPrice1688,
        landed_cost_actual: landedCost,
        lead_time_days: '',
        expected_arrival_date: '',
        fba_fee_at_order: '',
        selling_price_at_order: '',
        notes: '依頼書:' + pNo,
        created_at: lcNowIso_()
      };
      appendObjects.push(obj);
      syncRows.push(row._row);
      addedInGroup++;
    });
    groupSummaries.push({
      p_no: pNo,
      status: addedInGroup ? 'READY' : 'NO_RESOLVED_ROWS',
      rows: rows.length,
      ready: addedInGroup,
      order_date: orderDate,
      exchange_rate: exchangeRate
    });
  });

  const result = {
    status: appendObjects.length ? 'OK' : 'NOTHING_TODO',
    dryRun: dryRun,
    pendingRows: pendingRows.length,
    readyToSync: appendObjects.length,
    skipped: skipped,
    provisionalDateGroups: provisionalDateGroups,
    unresolvedSamples: unresolvedSamples,
    groups: groupSummaries.slice(0, 50),
    sampleRows: appendObjects.slice(0, 10)
  };

  if (dryRun || !appendObjects.length) {
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  appendReorderRows_(reorderSheet, reorderHeaders, appendObjects);
  try {
    result.currentLandedCostUpdate = updateCurrentLandedCosts_(centralSS, appendObjects);
  } catch (error) {
    result.currentLandedCostUpdate = { status: 'ERROR', message: String(error && error.message ? error.message : error) };
    Logger.log('current_landed_cost 更新失敗: ' + error);
  }
  markItemRowsSynced_(itemSheet, syncRows);
  result.synced = appendObjects.length;
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function coreCheckPaymentDue() {
  const toolSS = getToolSpreadsheet_();
  ensureAllSheets_(toolSS);
  const mailTo = LC_PROP.getProperty(LC_PROP_ALERT_MAIL_TO);
  if (!mailTo) throw new Error('ALERT_MAIL_TO が未設定です。');

  const ledgerSheet = toolSS.getSheetByName(LC_SHEET_INVOICE_LEDGER);
  const rows = getSheetObjects_(ledgerSheet);
  const today = parseDateOnly_(lcToday_());
  const soonLimit = new Date(today.getTime());
  soonLimit.setDate(soonLimit.getDate() + 3);

  const overdue = [];
  const soon = [];
  const missingDueDate = [];

  rows.forEach(function(row) {
    if (String(row.payment_status || '未払').trim() !== '未払') return;
    const dueText = normalizeDateString_(row.due_date);
    if (!dueText) {
      missingDueDate.push(row);
      return;
    }
    const due = parseDateOnly_(dueText);
    if (due < today) overdue.push(row);
    else if (due <= soonLimit) soon.push(row);
  });

  const result = {
    status: overdue.length || soon.length ? 'SENT' : 'NOTHING_TODO',
    overdue: overdue.length,
    soon: soon.length,
    missingDueDate: missingDueDate.length,
    sentTo: overdue.length || soon.length ? mailTo : '',
    checkedAt: lcNowIso_()
  };

  if (!overdue.length && !soon.length) {
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  const subject = '【HAKSAI】支払アラート 超過' + overdue.length + '件・間近' + soon.length + '件';
  const body = buildPaymentDueMailBody_(toolSS, overdue, soon, missingDueDate);
  GmailApp.sendEmail(mailTo, subject, body);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function buildPaymentDueMailBody_(toolSS, overdue, soon, missingDueDate) {
  const lines = [];
  lines.push('HAKSAI 支払アラート');
  lines.push('');
  lines.push('確認日時: ' + lcNowIso_());
  lines.push('台帳: ' + toolSS.getUrl());
  lines.push('');

  lines.push('【期限超過: ' + overdue.length + '件】');
  if (overdue.length) {
    overdue.forEach(function(row) {
      lines.push(formatPaymentRow_(row));
    });
  } else {
    lines.push('なし');
  }
  lines.push('');

  lines.push('【期限間近（3日以内）: ' + soon.length + '件】');
  if (soon.length) {
    soon.forEach(function(row) {
      lines.push(formatPaymentRow_(row));
    });
  } else {
    lines.push('なし');
  }

  if (missingDueDate.length) {
    lines.push('');
    lines.push('【期限未設定の未払: ' + missingDueDate.length + '件（要確認）】');
    missingDueDate.slice(0, 20).forEach(function(row) {
      lines.push(formatPaymentRow_(row));
    });
    if (missingDueDate.length > 20) lines.push('...ほか ' + (missingDueDate.length - 20) + '件');
  }

  return lines.join('\n');
}

function formatPaymentRow_(row) {
  const issuer = String(row.issuer || '発行者未設定').trim();
  const amount = lcNum_(row.amount);
  const due = normalizeDateString_(row.due_date) || '期限未設定';
  const type = String(row.doc_type || '種別未設定').trim();
  const invoiceNo = String(row.invoice_no || '').trim();
  const rwNo = String(row.rw_no || '').trim();
  const refs = [invoiceNo ? '請求書:' + invoiceNo : '', rwNo ? 'RW:' + rwNo : ''].filter(Boolean).join(' / ');
  return '- ' + issuer + ' / ' + (amount ? amount.toLocaleString('ja-JP') + '円' : '金額未設定') + ' / 期限:' + due + ' / ' + type + (refs ? ' / ' + refs : '');
}

function coreProcessImportCost(options) {
  options = options || {};
  const toolSS = getToolSpreadsheet_();
  ensureAllSheets_(toolSS);

  const excelFolder = getRequiredFolder_(LC_PROP_FOLDER_EXCEL);
  const doneFolder = getRequiredFolder_(LC_PROP_FOLDER_EXCEL_DONE);
  const sourceFile = getOldestExcelFile_(excelFolder);
  if (!sourceFile) {
    return { status: 'NOTHING_TODO', summary: 'Excel入庫フォルダに対象ファイルがありません。' };
  }

  const converted = convertExcelToSpreadsheet_(sourceFile, excelFolder);
  const convertedSS = SpreadsheetApp.openById(converted.id);
  const sourceSheet = convertedSS.getSheets()[0];
  const data = sourceSheet.getDataRange().getValues();
  const extraction = extractImportWorkbook_(sourceSheet, data);

  if (!extraction.p_no) {
    trashFileById_(converted.id);
    return {
      status: 'ERROR',
      summary: '配送依頼書番号を抽出できませんでした。',
      fileName: sourceFile.getName()
    };
  }

  if (!extraction.rw_no) {
    trashFileById_(converted.id);
    return {
      status: 'NEED_INPUT',
      need: 'rw_no',
      p_no: extraction.p_no,
      fileName: sourceFile.getName()
    };
  }

  if (hasProcessedPNo_(toolSS, extraction.p_no)) {
    trashFileById_(converted.id);
    return {
      status: 'ERROR',
      summary: '同じ配送依頼書番号は既に処理済みです。',
      p_no: extraction.p_no,
      rw_no: extraction.rw_no
    };
  }

  const invoice = getImportInvoiceByRw_(toolSS, extraction.rw_no);
  const amountFromLedger = invoice && lcNum_(invoice.total_amount) > 0;
  const invoiceAmount = amountFromLedger ? lcNum_(invoice.total_amount) : lcNum_(options.invoiceAmount);
  if (!invoiceAmount) {
    trashFileById_(converted.id);
    return {
      status: 'NEED_INPUT',
      need: 'invoice_amount',
      p_no: extraction.p_no,
      rw_no: extraction.rw_no,
      fileName: sourceFile.getName(),
      extracted: {
        exchange_rate: extraction.exchange_rate,
        item_count: extraction.items.length,
        costs: extraction.costs
      }
    };
  }

  const invoiceIssueDate = String((invoice && invoice.invoice_issue_date) || options.invoiceIssueDate || '').slice(0, 10);
  const arrivalDate = String((invoice && invoice.fba_arrival_date) || invoiceIssueDate || lcToday_()).slice(0, 10);

  const calculation = calculateAllocatedCosts_(extraction, invoiceAmount);
  appendItemRows_(toolSS, sourceSheet, calculation.items, extraction);
  appendProcessedRow_(toolSS, sourceFile, extraction, calculation, invoiceAmount, amountFromLedger ? 'ledger' : 'manual');
  upsertImportInvoice_(toolSS, {
    rw_no: extraction.rw_no,
    p_no: extraction.p_no,
    invoice_issue_date: invoiceIssueDate,
    total_amount: invoiceAmount,
    exchange_rate: extraction.exchange_rate,
    fba_arrival_date: arrivalDate,
    confirmed: amountFromLedger ? invoice.confirmed : false,
    pdf_link: invoice ? invoice.pdf_link : '',
    note: invoice ? invoice.note : '',
    updated_at: lcNowIso_()
  });

  moveFileToFolder_(sourceFile, doneFolder);
  moveFileToFolder_(DriveApp.getFileById(converted.id), doneFolder);

  const result = {
    status: 'OK',
    summary: 'Excel計算が完了しました。',
    fileName: sourceFile.getName(),
    p_no: extraction.p_no,
    rw_no: extraction.rw_no,
    invoiceAmountSource: amountFromLedger ? 'ledger' : 'manual',
    itemCount: calculation.items.length,
    totalLandedCost: calculation.totalLandedCost,
    allocatedTotal: calculation.allocatedTotal,
    roundingDiff: calculation.allocatedTotal - calculation.totalLandedCost,
    fbaArrivalDate: arrivalDate
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function getOrCreateToolSpreadsheet_(root) {
  const existingId = LC_PROP.getProperty(LC_PROP_TOOL_SS_ID);
  if (existingId) {
    try {
      return SpreadsheetApp.openById(existingId);
    } catch (error) {
      Logger.log('LC_TOOL_SS_ID のスプレッドシートを開けません。再作成します: ' + error);
    }
  }

  const files = root.getFilesByName(LC_TOOL_SPREADSHEET_NAME);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      LC_PROP.setProperty(LC_PROP_TOOL_SS_ID, file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  }

  const spreadsheet = SpreadsheetApp.create(LC_TOOL_SPREADSHEET_NAME);
  const file = DriveApp.getFileById(spreadsheet.getId());
  file.moveTo(root);
  LC_PROP.setProperty(LC_PROP_TOOL_SS_ID, spreadsheet.getId());
  return spreadsheet;
}

function getUploadFolderByKind_(kind) {
  const key = kind === 'excel' ? LC_PROP_FOLDER_EXCEL
    : kind === 'invoice' ? LC_PROP_FOLDER_INBOX
    : '';
  if (!key) throw new Error('unknown upload kind: ' + kind);
  const folderId = LC_PROP.getProperty(key);
  if (!folderId) throw new Error(key + ' が未設定です。先に setupAll を実行してください。');
  return DriveApp.getFolderById(folderId);
}

function getToolSpreadsheet_() {
  const spreadsheetId = LC_PROP.getProperty(LC_PROP_TOOL_SS_ID);
  if (!spreadsheetId) throw new Error('LC_TOOL_SS_ID が未設定です。先に setupAll を実行してください。');
  return SpreadsheetApp.openById(spreadsheetId);
}

function getCentralSpreadsheet_() {
  const spreadsheetId = LC_PROP.getProperty(LC_PROP_CENTRAL_SS_ID)
    || LC_PROP.getProperty(LC_PROP_CENTRAL_SS_ID_ALT);
  if (!spreadsheetId) throw new Error('HAKSAI_SS_ID または CENTRAL_SS_ID が未設定です。');
  return SpreadsheetApp.openById(spreadsheetId);
}

function requireSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(sheetName + ' シートが見つかりません。');
  return sheet;
}

function getSheetHeaders_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) {
    return String(value || '').trim();
  });
}

function requireHeaders_(headers, required, sheetName) {
  required.forEach(function(header) {
    if (headers.indexOf(header) < 0) throw new Error(sheetName + ' に列がありません: ' + header);
  });
}

function getSheetObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function(row, index) {
    return rowToObject_(headers, row, index + 2);
  });
}

function buildImportInvoiceByPNo_(spreadsheet) {
  const rows = getSheetObjects_(spreadsheet.getSheetByName(LC_SHEET_IMPORT_INVOICES));
  const out = {};
  rows.forEach(function(row) {
    const pNo = String(row.p_no || '').trim();
    if (pNo) out[pNo] = row;
  });
  return out;
}

function buildCentralResolutionMaps_(centralSS) {
  const skuSheet = requireSheet_(centralSS, LC_CENTRAL_SHEET_SKU_MASTER);
  const productSheet = requireSheet_(centralSS, LC_CENTRAL_SHEET_PRODUCT_LIFECYCLE);
  const skuHeaders = getSheetHeaders_(skuSheet);
  const productHeaders = getSheetHeaders_(productSheet);
  requireHeaders_(skuHeaders, ['sku', 'fnsku', 'asin'], LC_CENTRAL_SHEET_SKU_MASTER);
  requireHeaders_(productHeaders, ['id', 'asin'], LC_CENTRAL_SHEET_PRODUCT_LIFECYCLE);

  const skuLastRow = skuSheet.getLastRow();
  const skuCol = makeHeaderMap_(skuHeaders);
  const skuValues = skuLastRow > 1 ? {
    sku: skuSheet.getRange(2, skuCol.sku + 1, skuLastRow - 1, 1).getValues(),
    fnsku: skuSheet.getRange(2, skuCol.fnsku + 1, skuLastRow - 1, 1).getValues(),
    asin: skuSheet.getRange(2, skuCol.asin + 1, skuLastRow - 1, 1).getValues()
  } : { sku: [], fnsku: [], asin: [] };

  const skuByFnsku = {};
  const skuByAsin = {};
  for (let i = 0; i < skuValues.sku.length; i++) {
    const sku = String(skuValues.sku[i][0] || '').trim();
    const fnsku = String(skuValues.fnsku[i][0] || '').trim();
    const asin = String(skuValues.asin[i][0] || '').trim().toUpperCase();
    if (fnsku) skuByFnsku[fnsku] = { sku: sku, asin: asin };
    if (asin && !skuByAsin[asin]) skuByAsin[asin] = { sku: sku, asin: asin, fnsku: fnsku };
  }

  const productLastRow = productSheet.getLastRow();
  const productCol = makeHeaderMap_(productHeaders);
  const productValues = productLastRow > 1 ? {
    id: productSheet.getRange(2, productCol.id + 1, productLastRow - 1, 1).getValues(),
    asin: productSheet.getRange(2, productCol.asin + 1, productLastRow - 1, 1).getValues(),
    row: productSheet.getRange(2, 1, productLastRow - 1, 1).getValues()
  } : { id: [], asin: [], row: [] };

  const productByAsin = {};
  for (let j = 0; j < productValues.id.length; j++) {
    const id = String(productValues.id[j][0] || '').trim();
    const asin = String(productValues.asin[j][0] || '').trim().toUpperCase();
    if (asin && id) productByAsin[asin] = { id: id, row: j + 2 };
  }

  return {
    skuByFnsku: skuByFnsku,
    skuByAsin: skuByAsin,
    productByAsin: productByAsin,
    productHeaders: productHeaders
  };
}

function resolveCentralProduct_(maps, fnsku, asin) {
  const skuInfo = (fnsku && maps.skuByFnsku[fnsku]) || (asin && maps.skuByAsin[asin]) || {};
  const resolvedAsin = String(asin || skuInfo.asin || '').trim().toUpperCase();
  const product = resolvedAsin ? maps.productByAsin[resolvedAsin] : null;
  return {
    sku: skuInfo.sku || '',
    asin: resolvedAsin,
    product_id: product ? product.id : '',
    product_row: product ? product.row : 0
  };
}

function buildExistingReorderNotes_(sheet) {
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = makeHeaderMap_(headers);
  if (col.notes === undefined) return out;
  for (let r = 1; r < values.length; r++) {
    const note = String(values[r][col.notes] || '').trim();
    if (note) out[note] = true;
  }
  return out;
}

function groupBy_(rows, keyFn) {
  const groups = {};
  rows.forEach(function(row) {
    const key = keyFn(row);
    (groups[key] || (groups[key] = [])).push(row);
  });
  return groups;
}

function isProvisionalArrivalDate_(invoice) {
  const arrival = normalizeDateString_(invoice.fba_arrival_date);
  const issue = normalizeDateString_(invoice.invoice_issue_date);
  return !!arrival && !!issue && arrival === issue;
}

function appendReorderRows_(sheet, headers, objects) {
  const rows = objects.map(function(obj) {
    return headers.map(function(header) {
      return obj[header] === undefined || obj[header] === null ? '' : obj[header];
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  const orderDateCol = headers.indexOf('order_date');
  if (orderDateCol >= 0) {
    sheet.getRange(sheet.getLastRow() - rows.length + 1, orderDateCol + 1, rows.length, 1).setNumberFormat('@STRING@');
  }
}

function updateCurrentLandedCosts_(centralSS, reorderObjects) {
  const productSheet = requireSheet_(centralSS, LC_CENTRAL_SHEET_PRODUCT_LIFECYCLE);
  const headers = getSheetHeaders_(productSheet);
  requireHeaders_(headers, ['id', 'current_landed_cost'], LC_CENTRAL_SHEET_PRODUCT_LIFECYCLE);
  const col = makeHeaderMap_(headers);
  const updatedAtCol = col.updated_at;
  const lastRow = productSheet.getLastRow();
  if (lastRow < 2) return { updated: 0 };

  const idValues = productSheet.getRange(2, col.id + 1, lastRow - 1, 1).getValues();
  const rowByProductId = {};
  idValues.forEach(function(row, index) {
    const id = String(row[0] || '').trim();
    if (id) rowByProductId[id] = index + 2;
  });

  const latest = {};
  reorderObjects.forEach(function(obj) {
    const current = latest[obj.product_id];
    if (!current || String(obj.order_date) >= String(current.order_date)) {
      latest[obj.product_id] = obj;
    }
  });

  let updated = 0;
  Object.keys(latest).forEach(function(productId) {
    const row = rowByProductId[productId];
    if (!row) return;
    productSheet.getRange(row, col.current_landed_cost + 1).setValue(latest[productId].landed_cost_actual);
    if (updatedAtCol !== undefined) productSheet.getRange(row, updatedAtCol + 1).setValue(lcNowIso_());
    updated++;
  });
  return { updated: updated };
}

function markItemRowsSynced_(sheet, rowNumbers) {
  const headers = getSheetHeaders_(sheet);
  const syncCol = headers.indexOf('sync_at');
  if (syncCol < 0) throw new Error(LC_SHEET_ITEMS + ' に sync_at 列がありません。');
  const now = lcNowIso_();
  rowNumbers.forEach(function(rowNumber) {
    sheet.getRange(rowNumber, syncCol + 1).setValue(now);
  });
}

function getLedgerFileIdSet_(sheet) {
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = makeHeaderMap_(headers);
  if (col.drive_file_id === undefined) return out;
  for (let r = 1; r < values.length; r++) {
    const id = String(values[r][col.drive_file_id] || '').trim();
    if (id) out[id] = true;
  }
  return out;
}

function extractInvoiceWithGemini_(file) {
  const apiKey = LC_PROP.getProperty(LC_PROP_GEMINI_API_KEY);
  if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です。');
  const model = LC_PROP.getProperty(LC_PROP_GEMINI_MODEL) || LC_DEFAULT_GEMINI_MODEL;
  const blob = file.getBlob();
  const mimeType = normalizeInvoiceMimeType_(blob.getContentType(), file.getName());
  const prompt = [
    'あなたは日本の請求書読取アシスタントです。',
    '添付の請求書から以下をJSONで抽出してください。',
    '不明な項目は null。金額はカンマ・円記号を除いた整数。日付は YYYY-MM-DD。',
    'doc_type は 関税, 国内仕入, 倉庫, 物流, その他 のいずれか。',
    '貨物元番号・関税・通関料の記載があれば doc_type は 関税。',
    'rw_no は RW で始まる貨物元番号。なければ null。',
    'JSON以外は一切出力しないこと。',
    '{"issuer":null,"invoice_no":null,"issue_date":null,"due_date":null,"amount":null,"doc_type":null,"rw_no":null}'
  ].join('\n');

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: Utilities.base64Encode(blob.getBytes())
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json'
    }
  };
  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Gemini HTTP ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 300));
  }
  const parsed = JSON.parse(response.getContentText());
  const text = parsed.candidates
    && parsed.candidates[0]
    && parsed.candidates[0].content
    && parsed.candidates[0].content.parts
    && parsed.candidates[0].content.parts[0]
    && parsed.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini応答にtextがありません。');
  const json = JSON.parse(String(text).replace(/```json|```/g, '').trim());
  return normalizeInvoiceExtraction_(json);
}

function normalizeInvoiceMimeType_(mimeType, name) {
  const ext = getExtension_(name);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  return mimeType || 'application/octet-stream';
}

function normalizeInvoiceExtraction_(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    issuer: String(raw.issuer || '').trim(),
    invoice_no: String(raw.invoice_no || '').trim(),
    issue_date: normalizeDateString_(raw.issue_date),
    due_date: normalizeDateString_(raw.due_date),
    amount: lcNum_(raw.amount),
    doc_type: normalizeDocType_(raw.doc_type, raw.rw_no),
    rw_no: normalizeRwNo_(raw.rw_no)
  };
}

function normalizeDocType_(value, rwNo) {
  const text = String(value || '').trim();
  const allowed = ['関税', '国内仕入', '倉庫', '物流', 'その他'];
  if (allowed.indexOf(text) >= 0) return text;
  return normalizeRwNo_(rwNo) ? '関税' : 'その他';
}

function normalizeRwNo_(value) {
  const match = String(value || '').toUpperCase().match(/RW[0-9A-Z-]+/);
  return match ? match[0] : '';
}

function appendInvoiceLedgerRow_(sheet, file, extracted, source) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const now = lcNowIso_();
  const rowObj = {
    id: Utilities.getUuid(),
    doc_type: extracted.doc_type || '',
    issuer: extracted.issuer || '',
    invoice_no: extracted.invoice_no || '',
    issue_date: extracted.issue_date || '',
    due_date: extracted.due_date || '',
    amount: extracted.amount || '',
    payment_status: '未払',
    paid_date: '',
    rw_no: extracted.rw_no || '',
    drive_file_id: file.getId(),
    drive_url: file.getUrl(),
    extract_source: source,
    confirmed: false,
    note: source === 'gemini' ? JSON.stringify(extracted) : '',
    created_at: now,
    updated_at: now
  };
  const row = headers.map(function(header) {
    return rowObj[header] === undefined || rowObj[header] === null ? '' : rowObj[header];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  applyTextFormats_(sheet, headers);
}

function isDirectChildOfFolder_(file, folder) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) return true;
  }
  return false;
}

function getArchiveMonthFolder_(archiveRoot, issueDate) {
  const parts = String(issueDate || lcToday_()).match(/^(\d{4})-(\d{2})-\d{2}$/);
  const year = parts ? parts[1] : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy');
  const month = parts ? parts[2] : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM');
  const yearFolder = getOrCreateChildFolder_(archiveRoot, year).folder;
  return getOrCreateChildFolder_(yearFolder, month).folder;
}

function buildArchiveFileName_(row, originalName, issueDate) {
  const ext = getExtension_(originalName) || 'pdf';
  const issuer = sanitizeFileName_(String(row.issuer || 'unknown').slice(0, 20)) || 'unknown';
  const amount = Math.round(lcNum_(row.amount));
  return [issueDate || lcToday_(), issuer, amount ? amount + '円' : '金額未設定'].join('_') + '.' + ext;
}

function normalizeDateString_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!match) return '';
  return [
    match[1],
    String(match[2]).padStart(2, '0'),
    String(match[3]).padStart(2, '0')
  ].join('-');
}

function parseDateOnly_(dateText) {
  const normalized = normalizeDateString_(dateText);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('日付形式が不正です: ' + dateText);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getRequiredFolder_(propertyKey) {
  const folderId = LC_PROP.getProperty(propertyKey);
  if (!folderId) throw new Error(propertyKey + ' が未設定です。先に setupAll を実行してください。');
  return DriveApp.getFolderById(folderId);
}

function getOldestExcelFile_(folder) {
  const files = folder.getFiles();
  let oldest = null;
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const ext = getExtension_(name);
    const mime = file.getMimeType();
    const isExcel = ['xlsx', 'xls'].indexOf(ext) >= 0
      || mime === MimeType.MICROSOFT_EXCEL
      || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!isExcel) continue;
    if (!oldest || file.getDateCreated() < oldest.getDateCreated()) oldest = file;
  }
  return oldest;
}

function convertExcelToSpreadsheet_(file, parentFolder) {
  if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.copy) {
    throw new Error('Drive API Advanced Service が未有効です。GASエディタで Drive API を有効化してください。');
  }
  const title = file.getName().replace(/\.(xlsx|xls)$/i, '');
  const resource = {
    title: title,
    mimeType: MimeType.GOOGLE_SHEETS,
    parents: [{ id: parentFolder.getId() }]
  };
  return Drive.Files.copy(resource, file.getId());
}

function extractImportWorkbook_(sheet, data) {
  const exchangeRate = lcNum_(sheet.getRange('N2').getValue());
  if (!exchangeRate) throw new Error('為替レート取得エラー: N2 が数値ではありません。');

  const pNo = extractPNo_(String(sheet.getRange('B1').getValue() || ''));
  const rwNo = extractTrackingNumber_(data);
  const costs = extractCostItems_(data);
  const headerInfo = detectImportHeader_(data);
  const items = extractImportItems_(data, headerInfo, exchangeRate);
  if (!items.length) throw new Error('出荷数>0 の明細行がありません。');

  return {
    p_no: pNo,
    rw_no: rwNo,
    exchange_rate: exchangeRate,
    costs: costs,
    headerInfo: headerInfo,
    items: items
  };
}

function extractPNo_(text) {
  const match = String(text || '').match(/P[\d-]+/);
  return match ? match[0] : '';
}

function extractTrackingNumber_(data) {
  for (let r = 0; r < data.length - 1; r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (String(data[r][c] || '').indexOf('追跡番号') < 0) continue;
      const value = String(data[r + 1][c] || '').trim();
      if (value) return value;
    }
  }
  return '';
}

function extractCostItems_(data) {
  const costs = {
    international_shipping_yen: 0,
    product_total_yen: 0,
    service_fee_yen: 0,
    domestic_shipping_yuan: 0,
    option_fee_yuan: 0
  };

  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const text = String(data[r][c] || '').trim();
      if (!text) continue;
      if (text.indexOf('国際運賃') !== -1 && text.indexOf('円') !== -1) {
        costs.international_shipping_yen = lcNum_(data[r][c + 1]);
      }
      if (text.indexOf('合計商品代金') !== -1 && text.indexOf('円') !== -1) {
        costs.product_total_yen = lcNum_(data[r][c + 1]);
      }
      if (text.indexOf('代行手数料') !== -1 && text.indexOf('円') !== -1) {
        costs.service_fee_yen = lcNum_(data[r][c + 1]);
      }
      if (text.indexOf('合計運賃') !== -1 && text.indexOf('元') !== -1 && r + 1 < data.length) {
        costs.domestic_shipping_yuan = lcNum_(data[r + 1][c]);
      }
      if (text.indexOf('合計オプション費用') !== -1 && text.indexOf('元') !== -1 && r + 1 < data.length) {
        costs.option_fee_yuan = lcNum_(data[r + 1][c]);
      }
    }
  }
  return costs;
}

function detectImportHeader_(data) {
  let headerRowIndex = -1;
  for (let r = 0; r < Math.min(data.length, 15); r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (String(data[r][c] || '').indexOf('商品コード') !== -1) {
        headerRowIndex = r;
        break;
      }
    }
    if (headerRowIndex >= 0) break;
  }
  if (headerRowIndex < 0) throw new Error('商品コードを含む明細ヘッダー行が見つかりません。');

  const headerMap = {};
  data[headerRowIndex].forEach(function(value, index) {
    const header = String(value || '').trim();
    if (header) headerMap[header] = index;
  });
  ['商品コード', '出荷数', '単価（元）'].forEach(function(header) {
    if (headerMap[header] === undefined) throw new Error('明細ヘッダーに列がありません: ' + header);
  });
  return { headerRowIndex: headerRowIndex, headerMap: headerMap };
}

function extractImportItems_(data, headerInfo, exchangeRate) {
  const items = [];
  const headerMap = headerInfo.headerMap;
  for (let r = headerInfo.headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (row.join('').trim() === '') continue;
    const shippedQty = lcNum_(row[headerMap['出荷数']]);
    if (shippedQty <= 0) continue;
    const unitPriceYuan = lcNum_(row[headerMap['単価（元）']]);
    const baselineCost = unitPriceYuan * exchangeRate * shippedQty;
    items.push({
      rowIndex: r + 1,
      sourceRow: row.slice(0, 20),
      productCode: String(row[headerMap['商品コード']] || '').trim(),
      labelNo: String(row[headerMap['ラベル番号']] || '').trim(),
      shippedQty: shippedQty,
      unitPriceYuan: unitPriceYuan,
      baselineCost: baselineCost,
      unitCost: 0,
      allocatedCost: 0
    });
  }
  return items;
}

function calculateAllocatedCosts_(extraction, invoiceAmount) {
  const costs = extraction.costs;
  const domesticShippingYen = Math.round(costs.domestic_shipping_yuan * extraction.exchange_rate);
  const optionFeeYen = Math.round(costs.option_fee_yuan * extraction.exchange_rate);
  const totalLandedCost = Math.round(
    costs.product_total_yen
    + costs.international_shipping_yen
    + costs.service_fee_yen
    + invoiceAmount
    + domesticShippingYen
    + optionFeeYen
  );
  const totalBaseline = extraction.items.reduce(function(sum, item) {
    return sum + item.baselineCost;
  }, 0);
  if (!totalBaseline) throw new Error('案分基準額が0です。単価（元）と出荷数を確認してください。');

  let allocatedTotal = 0;
  const items = extraction.items.map(function(item) {
    const allocatedCost = Math.round(totalLandedCost * item.baselineCost / totalBaseline);
    const unitCost = Math.round(allocatedCost / item.shippedQty);
    allocatedTotal += allocatedCost;
    return Object.assign({}, item, {
      unitCost: unitCost,
      allocatedCost: allocatedCost
    });
  });

  return {
    items: items,
    domesticShippingYen: domesticShippingYen,
    optionFeeYen: optionFeeYen,
    totalLandedCost: totalLandedCost,
    allocatedTotal: allocatedTotal
  };
}

function hasProcessedPNo_(spreadsheet, pNo) {
  pNo = String(pNo || '').trim();
  if (!pNo) return false;
  const sheet = spreadsheet.getSheetByName(LC_SHEET_ITEMS);
  if (sheet && sheet.getLastRow() >= 2) {
    const rows = getSheetObjects_(sheet);
    const fallback = buildItemRowPNoFallbackMap_(spreadsheet);
    for (let i = 0; i < rows.length; i++) {
      if (getItemRowPNo_(rows[i], fallback[rows[i]._row]) === pNo) return true;
    }
  }

  const processed = spreadsheet.getSheetByName(LC_SHEET_PROCESSED);
  if (processed && processed.getLastRow() >= 2) {
    const processedRows = getSheetObjects_(processed);
    for (let j = 0; j < processedRows.length; j++) {
      if (String(processedRows[j].p_no || '').trim() === pNo) return true;
    }
  }
  return false;
}

function appendItemRows_(spreadsheet, sourceSheet, items, extraction) {
  const sheet = spreadsheet.getSheetByName(LC_SHEET_ITEMS);
  const pNo = String((extraction && extraction.p_no) || '').trim();
  const rows = items.map(function(item) {
    const row = item.sourceRow.slice(0, 20);
    while (row.length < 20) row.push('');
    row[0] = pNo;
    row[1] = pNo;
    row.push(item.unitCost, item.allocatedCost, '');
    return row;
  });
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LC_ITEM_HEADERS.length).setValues(rows);

  items.forEach(function(item) {
    sourceSheet.getRange(item.rowIndex, 21, 1, 2)
      .setValues([[item.unitCost, item.allocatedCost]])
      .setNumberFormat('#,##0');
  });
}

function isPNo_(value) {
  return /^P[\d-]+$/i.test(String(value || '').trim());
}

function getItemRowPNo_(row, fallbackPNo) {
  const candidates = [
    row.p_no,
    row['p_no'],
    row['配送依頼書NO'],
    row['配送依頼書'],
    fallbackPNo
  ];
  for (let i = 0; i < candidates.length; i++) {
    const value = String(candidates[i] || '').trim();
    if (isPNo_(value)) return value;
  }
  return '';
}

function buildItemRowPNoFallbackMap_(spreadsheet) {
  const processedSheet = spreadsheet.getSheetByName(LC_SHEET_PROCESSED);
  if (!processedSheet || processedSheet.getLastRow() < 2) return {};
  const processedRows = getSheetObjects_(processedSheet);
  const out = {};
  let itemRow = 2;
  processedRows.forEach(function(row) {
    const pNo = String(row.p_no || '').trim();
    const count = Math.max(0, Math.floor(lcNum_(row.item_count)));
    if (isPNo_(pNo) && count) {
      for (let i = 0; i < count; i++) out[itemRow + i] = pNo;
    }
    itemRow += count;
  });
  return out;
}

function appendProcessedRow_(spreadsheet, sourceFile, extraction, calculation, invoiceAmount, source) {
  const sheet = spreadsheet.getSheetByName(LC_SHEET_PROCESSED);
  const costs = extraction.costs;
  const link = '=HYPERLINK("' + sourceFile.getUrl() + '", "' + sourceFile.getName().replace(/"/g, '""') + '")';
  sheet.appendRow([
    lcNowIso_(),
    link,
    extraction.p_no,
    extraction.rw_no,
    extraction.exchange_rate,
    costs.product_total_yen,
    costs.service_fee_yen,
    costs.international_shipping_yen,
    costs.domestic_shipping_yuan,
    calculation.domesticShippingYen,
    costs.option_fee_yuan,
    calculation.optionFeeYen,
    invoiceAmount,
    calculation.totalLandedCost,
    calculation.items.length,
    source
  ]);
}

function getImportInvoiceByRw_(spreadsheet, rwNo) {
  const sheet = spreadsheet.getSheetByName(LC_SHEET_IMPORT_INVOICES);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = makeHeaderMap_(headers);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][col.rw_no] || '').trim() !== rwNo) continue;
    return rowToObject_(headers, values[r], r + 1);
  }
  return null;
}

function upsertImportInvoice_(spreadsheet, data) {
  const sheet = spreadsheet.getSheetByName(LC_SHEET_IMPORT_INVOICES);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = makeHeaderMap_(headers);
  const rwNo = String(data.rw_no || '').trim();
  if (!rwNo) throw new Error('rw_no is required');

  let targetRow = 0;
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][col.rw_no] || '').trim() === rwNo) {
      targetRow = r + 1;
      break;
    }
  }

  const now = lcNowIso_();
  const existing = targetRow ? rowToObject_(headers, values[targetRow - 1], targetRow) : {};
  const merged = Object.assign({}, existing);
  Object.keys(data).forEach(function(key) {
    if (headers.indexOf(key) < 0) return;
    if (data[key] === undefined || data[key] === null || data[key] === '') return;
    merged[key] = data[key];
  });
  if (!merged.created_at) merged.created_at = now;
  merged.updated_at = now;

  const row = headers.map(function(header) {
    return merged[header] === undefined || merged[header] === null ? '' : merged[header];
  });
  if (targetRow) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
    targetRow = sheet.getLastRow();
  }
  applyTextFormats_(sheet, headers);
  return Object.assign({}, merged, { _row: targetRow });
}

function moveFileToFolder_(file, folder) {
  file.moveTo(folder);
}

function trashFileById_(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    Logger.log('一時ファイル削除に失敗: ' + error);
  }
}

function makeHeaderMap_(headers) {
  const map = {};
  headers.forEach(function(header, index) {
    if (header) map[header] = index;
  });
  return map;
}

function rowToObject_(headers, row, rowNumber) {
  const obj = {};
  headers.forEach(function(header, index) {
    if (header) obj[header] = row[index];
  });
  obj._row = rowNumber;
  return obj;
}

function lcNum_(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/[,\s¥￥]/g, ''));
  return isFinite(n) ? n : 0;
}

function lcBool_(value) {
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'checked', '確認済み'].indexOf(text) >= 0;
}

function lcToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function lcNowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function validateUploadKind_(kind, extension) {
  const excel = ['xlsx', 'xls'];
  const invoice = ['pdf', 'jpg', 'jpeg', 'png'];
  if (kind === 'excel' && excel.indexOf(extension) >= 0) return;
  if (kind === 'invoice' && invoice.indexOf(extension) >= 0) return;
  throw new Error('対象外のファイル形式です: .' + extension);
}

function findSameNameFile_(folder, name) {
  const files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function sanitizeFileName_(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

function getExtension_(name) {
  const match = String(name || '').toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function addTimestampToName_(name) {
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HHmmss');
  const index = name.lastIndexOf('.');
  if (index < 0) return name + '_' + stamp;
  return name.slice(0, index) + '_' + stamp + name.slice(index);
}

function ensureAllSheets_(spreadsheet) {
  return [
    ensureSheet_(spreadsheet, LC_SHEET_IMPORT_INVOICES, LC_IMPORT_INVOICE_HEADERS),
    ensureSheet_(spreadsheet, LC_SHEET_INVOICE_LEDGER, LC_INVOICE_LEDGER_HEADERS),
    ensureSheet_(spreadsheet, LC_SHEET_ITEMS, LC_ITEM_HEADERS),
    ensureSheet_(spreadsheet, LC_SHEET_PROCESSED, LC_PROCESSED_HEADERS)
  ];
}

function ensureSheet_(spreadsheet, sheetName, requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  const created = !sheet;
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(value) {
    return String(value || '').trim();
  });

  if (!headers.some(Boolean)) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    headers = requiredHeaders.slice();
  } else {
    requiredHeaders.forEach(function(header) {
      if (headers.indexOf(header) < 0) {
        sheet.getRange(1, headers.length + 1).setValue(header);
        headers.push(header);
      }
    });
  }

  formatHeader_(sheet, headers.length);
  applyTextFormats_(sheet, headers);
  return {
    name: sheetName,
    created: created,
    columns: headers.length,
    rows: Math.max(sheet.getLastRow() - 1, 0)
  };
}

function formatHeader_(sheet, columnCount) {
  if (columnCount <= 0) return;
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground('#202124')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
}

function applyTextFormats_(sheet, headers) {
  if (sheet.getMaxRows() < 2) return;
  headers.forEach(function(header, index) {
    if (LC_TEXT_FORMAT_HEADERS.indexOf(header) < 0) return;
    sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@STRING@');
  });
}

function ensureFolderTree_(root) {
  const excel = getOrCreateChildFolder_(root, '01_ラクマートEXCEL入庫');
  const excelDone = getOrCreateChildFolder_(excel.folder, '処理済み');
  const inbox = getOrCreateChildFolder_(root, '02_請求書インボックス');
  const archive = getOrCreateChildFolder_(inbox.folder, 'アーカイブ');

  LC_PROP.setProperty(LC_PROP_FOLDER_EXCEL, excel.folder.getId());
  LC_PROP.setProperty(LC_PROP_FOLDER_EXCEL_DONE, excelDone.folder.getId());
  LC_PROP.setProperty(LC_PROP_FOLDER_INBOX, inbox.folder.getId());
  LC_PROP.setProperty(LC_PROP_FOLDER_ARCHIVE, archive.folder.getId());

  return [
    folderResult_('excel', excel),
    folderResult_('excel_done', excelDone),
    folderResult_('inbox', inbox),
    folderResult_('archive', archive)
  ];
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) {
    return { folder: folders.next(), created: false };
  }
  return { folder: parent.createFolder(name), created: true };
}

function folderResult_(role, item) {
  return {
    role: role,
    name: item.folder.getName(),
    id: item.folder.getId(),
    url: item.folder.getUrl(),
    created: item.created
  };
}

function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

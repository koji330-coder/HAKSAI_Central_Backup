const SHEET_BOXES = 'home_inventory_boxes';
const SHEET_BOX_ITEMS = 'home_inventory_items';
const SHEET_BOX_LOG = 'home_inventory_log';

const REQUIRED_HEADERS_BOXES = [
  'box_id', 'location', 'memo', 'created_at'
];

const REQUIRED_HEADERS_BOX_ITEMS = [
  'id', 'box_id', 'fnsku', 'asin', 'free_label',
  'product_name', 'qty', 'updated_at'
];

const REQUIRED_HEADERS_BOX_LOG = [
  'id', 'date', 'box_id', 'sku', 'product_name', 'type', 'qty', 'memo', 'created_at'
];

function setupBoxSheets() {
  const ss = getSpreadsheet_();

  [
    { name: SHEET_BOXES,     headers: REQUIRED_HEADERS_BOXES },
    { name: SHEET_BOX_ITEMS, headers: REQUIRED_HEADERS_BOX_ITEMS },
    { name: SHEET_BOX_LOG,   headers: REQUIRED_HEADERS_BOX_LOG },
  ].forEach(({ name, headers }) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log(`${name} シートを新規作成しました。`);
    } else {
      Logger.log(`${name} シートは既に存在します。`);
      return;
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1c1c21')
      .setFontColor('#e8d5a3')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  Logger.log('✅ 折コン管理シートの初期化が完了しました。');
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '折コン管理シートを作成しました。',
    '✅ 完了', 5
  );
}

// QRコード印刷シート生成
function generateBoxQrSheet() {
  const ss = getSpreadsheet_();
  const boxSheet = ss.getSheetByName(SHEET_BOXES);
  if (!boxSheet) {
    Logger.log('home_inventory_boxes シートが見つかりません。');
    return;
  }

  const data    = boxSheet.getDataRange().getValues();
  const headers = data[0];
  const boxIdx  = headers.indexOf('box_id');
  const locIdx  = headers.indexOf('location');
  const memoIdx = headers.indexOf('memo');

  let printSheet = ss.getSheetByName('box_qr_print');
  if (printSheet) ss.deleteSheet(printSheet);
  printSheet = ss.insertSheet('box_qr_print');

  const COLS = 3;
  const QR_ROW_HEIGHT = 100;
  const COL_WIDTH     = 170;

  // 列幅設定（3列、間に余白列）
  [1,3,5].forEach(c => printSheet.setColumnWidth(c, COL_WIDTH));
  [2,4].forEach(c => printSheet.setColumnWidth(c, 12));

  const boxes = data.slice(1).filter(row => row[boxIdx]);
  
  boxes.forEach((row, idx) => {
    const boxId = String(row[boxIdx]).trim();
    const loc   = String(row[locIdx]  || '').trim();
    const memo  = String(row[memoIdx] || '').trim();

    const appUrl = 'https://koji330-coder.github.io/HAKSAI-Central/?box=' 
                 + encodeURIComponent(boxId);
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=' 
            + encodeURIComponent(appUrl);

    const col    = (idx % COLS) * 2 + 1;
    const rowTop = Math.floor(idx / COLS) * 6 + 1;

    // 行高設定
    printSheet.setRowHeight(rowTop,     QR_ROW_HEIGHT);
    printSheet.setRowHeight(rowTop + 1, 20);
    printSheet.setRowHeight(rowTop + 2, 16);
    printSheet.setRowHeight(rowTop + 3, 14);
    printSheet.setRowHeight(rowTop + 4, 8);

    // ★ IMAGE関数でQRを表示
    printSheet.getRange(rowTop, col)
      .setFormula(`=IMAGE("${qrUrl}",1)`)
      .setBackground('#ffffff');

    // BOX ID
    printSheet.getRange(rowTop + 1, col)
      .setValue(boxId)
      .setFontSize(11)
      .setFontWeight('bold')
      .setHorizontalAlignment('center');

    // 保管場所
    printSheet.getRange(rowTop + 2, col)
      .setValue(loc)
      .setFontSize(9)
      .setFontColor('#555555')
      .setHorizontalAlignment('center');

    // メモ
    if (memo) {
      printSheet.getRange(rowTop + 3, col)
        .setValue(memo)
        .setFontSize(8)
        .setFontColor('#888888')
        .setHorizontalAlignment('center');
    }

    // 枠線
    printSheet.getRange(rowTop, col, 4, 1)
      .setBorder(true, true, true, true, false, false,
        '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
  });

  Logger.log(`QRコード印刷シートを生成しました: ${boxes.length}件`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${boxes.length}個のQRコードを生成しました。box_qr_printシートを印刷してください。`,
    '✅ 完了', 5
  );
}
// 折コン内容物の取得（フロントから呼び出し用）
function getBoxItems(boxId) {
  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_BOX_ITEMS);
  if (!sheet) return [];

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const iBox   = headers.indexOf('box_id');
  const iFnsku = headers.indexOf('fnsku');
  const iAsin  = headers.indexOf('asin');
  const iFree  = headers.indexOf('free_label');
  const iName  = headers.indexOf('product_name');
  const iQty   = headers.indexOf('qty');
  const iUpd   = headers.indexOf('updated_at');

  // product_lifecycle から商品名マップ
  const lcSheet    = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData     = lcSheet.getDataRange().getValues();
  const lcHdrs     = lcData[0];
  const lcAsinIdx  = lcHdrs.indexOf('asin');
  const lcTitleIdx = lcHdrs.indexOf('title');
  const lcSubIdx   = lcHdrs.indexOf('subtitle');
  const asinToTitle = {};
  for (let i = 1; i < lcData.length; i++) {
    const a = String(lcData[i][lcAsinIdx] || '').trim();
    if (!a) continue;
    const title    = String(lcData[i][lcTitleIdx] || '').trim();
    const subtitle = lcSubIdx >= 0 ? String(lcData[i][lcSubIdx] || '').trim() : '';
    asinToTitle[a] = subtitle ? `${title}（${subtitle}）` : title;
  }

  // sku_master から fnsku→asin マップ
  const smSheet   = ss.getSheetByName(SHEET_SKU_MASTER);
  const fnskuToAsin = {};
  if (smSheet) {
    const smData = smSheet.getDataRange().getValues();
    const smHdrs = smData[0];
    const smFnsku = smHdrs.indexOf('fnsku');
    const smAsin  = smHdrs.indexOf('asin');
    for (let i = 1; i < smData.length; i++) {
      const f = String(smData[i][smFnsku] || '').trim();
      const a = String(smData[i][smAsin]  || '').trim();
      if (f && a) fnskuToAsin[f] = a;
    }
  }

  return data.slice(1)
    .filter(row => String(row[iBox]).trim() === boxId && Number(row[iQty]) > 0)
    .map(row => {
      const fnsku     = String(row[iFnsku] || '').trim();
      const asin      = String(row[iAsin]  || '').trim() || fnskuToAsin[fnsku] || '';
      const freeLabel = String(row[iFree]  || '').trim();
      const name      = asinToTitle[asin]
                     || String(row[iName] || '').trim()
                     || freeLabel || asin || fnsku;
      return {
        fnsku,
        asin,
        free_label:   freeLabel,
        product_name: name,
        qty:          Number(row[iQty]),
        updated_at:   row[iUpd],
      };
    });
}
// 入出庫記録
function recordBoxMovement(boxId, identifier, type, qty, memo) {
  // identifier = { fnsku, asin, free_label, product_name } のいずれか
  if (!boxId || !identifier || !qty) throw new Error('必須項目が不足しています。');

  const ss        = getSpreadsheet_();
  const logSheet  = ss.getSheetByName(SHEET_BOX_LOG);
  const itemSheet = ss.getSheetByName(SHEET_BOX_ITEMS);
  if (!logSheet || !itemSheet) throw new Error('シートが見つかりません。');

  const now  = new Date().toISOString();
  const date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  const fnsku      = identifier.fnsku      || '';
  const asin       = identifier.asin       || '';
  const freeLabel  = identifier.free_label || '';
  const productName = identifier.product_name || freeLabel || asin || fnsku;

  // マッチキーの優先順位: fnsku > asin > free_label
  const matchKey  = fnsku || asin || freeLabel;
  const matchCol  = fnsku ? 'fnsku' : asin ? 'asin' : 'free_label';

  // ログに記録
  logSheet.appendRow([
    Utilities.getUuid(), date, boxId,
    fnsku, asin, freeLabel, productName,
    type, qty, memo || '', now
  ]);

  // home_inventory_items を更新
  const itemData    = itemSheet.getDataRange().getValues();
  const itemHeaders = itemData[0];
  const iBoxIdx   = itemHeaders.indexOf('box_id');
  const iFnskuIdx = itemHeaders.indexOf('fnsku');
  const iAsinIdx  = itemHeaders.indexOf('asin');
  const iFreeIdx  = itemHeaders.indexOf('free_label');
  const iNameIdx  = itemHeaders.indexOf('product_name');
  const iQtyIdx   = itemHeaders.indexOf('qty');
  const iUpdIdx   = itemHeaders.indexOf('updated_at');

  const colIdxMap = { fnsku: iFnskuIdx, asin: iAsinIdx, free_label: iFreeIdx };
  const matchColIdx = colIdxMap[matchCol];

  let found = false;
  for (let i = 1; i < itemData.length; i++) {
    if (String(itemData[i][iBoxIdx]).trim()    !== boxId)   continue;
    if (String(itemData[i][matchColIdx]).trim() !== matchKey) continue;

    const currentQty = Number(itemData[i][iQtyIdx]) || 0;
    const delta  = (type === 'inbound' || type === 'adjust') ? Number(qty) : -Number(qty);
    const newQty = Math.max(0, currentQty + delta);

    itemSheet.getRange(i + 1, iQtyIdx + 1).setValue(newQty);
    itemSheet.getRange(i + 1, iUpdIdx + 1).setValue(now);
    found = true;
    break;
  }

  if (!found && (type === 'inbound' || type === 'adjust')) {
    itemSheet.appendRow([
      Utilities.getUuid(), boxId,
      fnsku, asin, freeLabel,
      productName, Number(qty), now
    ]);
  }

  return { status: 'ok', boxId, fnsku, asin, freeLabel, type, qty };
}


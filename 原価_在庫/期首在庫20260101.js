// 2025-12-31 FBA在庫元帳（概要）から、2026-01-01期首在庫の確認シートを作る。
// この関数は作業シートを作るだけで、reorder_historyや原価計算には一切反映しない。

const SHEET_OPENING_INVENTORY_20260101 = 'opening_inventory_20260101';
const OPENING_INVENTORY_SOURCE_FILE_ = '163972020650.csv';
const OPENING_INVENTORY_DATE_20260101_ = '2026-01-01';
const OPENING_INVENTORY_LEDGER_DATE_20260101_ = '2025-12-31';
const OPENING_INVENTORY_MARKER_20260101_ = '[OPENING_INVENTORY:2026-01-01]';
const OPENING_INVENTORY_EXPECTED_20260101_ = {
  sourceRows: 105,
  adoptedRows: 103,
  excludedRows: 2,
  quantity: 3438,
  inventoryValue: 1708887
};

function getOpeningInventorySource20260101_() {
  const source = `
09-FEAO-KRU1|X00142COAH|B0C54V37FC|6|0|0
0C-CHTB-O284|B09XLF75B9|B09XLF75B9|59|0|0
10-WO7G-4DVJ|B0FT2Z9FFH|B0FT2Z9FFH|14|0|0
11-4K49-66BC|B0G6K47NJM|B0G6K47NJM|29|0|0
1C-S99B-1ZDL|B0BLV193SR|B0BLV193SR|5|0|0
1G-IYU2-PNNG|X0018KO2Q9|B0DJ8RMNJB|9|0|0
1G-J7MH-R6DY|X001BN4VV9|B0FS7M89XY|27|0|0
1Q-J7WT-OMPP|B0DTJZHB8S|B0DTJZHB8S|43|0|0
1V-SBWM-NJ4Z|B0BLKCPC4P|B0BLKCPC4P|9|0|0
2Z-UNWC-CA1A|B0FT31KC9G|B0FT31KC9G|18|0|0
30-9AJ3-V9AZ|X000Y029FF|B096XHZPMD|2|0|0
34-VKCA-APLO|B0G6JXXWR8|B0G6JXXWR8|5|0|0
4D-2EW8-TTS8|B09Y118H9T|B09Y118H9T|18|0|0
4J-BX8I-CZ03|X001BMIUXZ|B0FS7LWRDW|28|0|0
4N-VEHZ-QPFU|B0G1LWGK1T|B0G1LWGK1T|187|0|0
4V-IQ6Y-FOA9|B0FT2WCF6B|B0FT2WCF6B|9|0|0
4Z-XNJS-O1WT|B0FSZND3K3|B0FSZND3K3|20|0|0
5B-MEJP-D0IL|B0G1S8MQ41|B0G1S8MQ41|97|0|0
61-7ITB-753Q|X001BMZJVV|B0FS7NNNHP|18|0|0
6H-PPOR-NDHQ|X0018Q4PRJ|B0D6KDGJLL|37|0|0
6M-M9DW-F82X|B0G1S32GL1|B0G1S32GL1|96|0|0
7T-URML-BLUZ|B0FT34VPRR|B0FT34VPRR|4|0|0
7Z-CW3U-JEN0|B0BLKDPX2V|B0BLKDPX2V|10|1|0
8K-3RHJ-MRBX|B0FT2ZHP9V|B0FT2ZHP9V|21|0|0
9K-EGRK-256N|B09HRLSLT5|B09HRLSLT5|53|0|0
9N-97NR-7U35|X0011ITQYV|B0B8QFZJMD|18|0|0
9X-T6YO-4I39|X0014CAUMV|B0C7Q6XC7V|52|0|0
9Y-N9EL-1HTP|X0010AYLJP|B09VKM6PPM|25|1|1
A4-IL9Y-36X7|B0D7T65K1H|B0D7T65K1H|158|0|0
B2-JQ4I-8DZU|B0BJ5WB949|B0BJ5WB949|118|0|0
B7-6FEH-SD40|B0DTK2G9KD|B0DTK2G9KD|105|0|0
BV-HTXX-AWNF|B0FT2WFBPW|B0FT2WFBPW|3|0|0
CA-IO2I-C4F5|X0010AYLJZ|B09VKH859Y|39|0|1
CJ-0Y31-OGU0|B0FT2ZYQMG|B0FT2ZYQMG|17|0|0
CS-E96N-TXS7|B0BLTYM1FF|B0BLTYM1FF|9|0|0
CU-7HGJ-65JS|B0G6JXBRTD|B0G6JXBRTD|17|0|0
CX-D8B0-FR8B|X001451IGF|B0C573YDQK|2|0|0
DH-MK6T-KFZB|B0FSZLQP76|B0FSZLQP76|18|0|0
DU-S4QG-ZZ59|B09KMXJ36C|B09KMXJ36C|20|0|0
DZ-V1UY-U3LY|B004NNM2WE|B004NNM2WE|3|0|0
E1-89FD-LIF2|B0FT2ZDP9K|B0FT2ZDP9K|2|0|0
EC-EWCA-J0TE|B01LQT29AW|B01LQT29AW|69|0|0
EH-T2KB-GL0E|X0014CC6JB|B0C7Q7SSQZ|19|0|0
EL-7EV6-DCOQ|B0G1XBBBTS|B0G1XBBBTS|91|0|0
EQ-N3SE-ZHO3|B09HBFWN35|B09HBFWN35|129|0|0
EU-6IIX-CVO5|B0FT35G15J|B0FT35G15J|10|0|0
F7-JYTO-XA16|B0FSZND5P5|B0FSZND5P5|17|0|0
G8-SDCB-3C26|B0FT31SSKT|B0FT31SSKT|18|0|0
GG-TRPZ-GC0U|B004NNNVL0|B004NNNVL0|21|0|0
H3-SKAK-0OUM|B0FT36NPYQ|B0FT36NPYQ|13|0|0
H5-64WX-COSH|X000Y00B5F|B096XKFYLV|29|0|0
HC-QI31-ZZSP|B0DB5QCGJW|B0DB5QCGJW|19|0|0
HJ-W6M4-0X31|B0FSZKJWP9|B0FSZKJWP9|20|0|0
HU-LMXV-Y0KV|B09Y15VV5J|B09Y15VV5J|9|0|0
HV-DZCS-W5M8|B0G6K2RKN6|B0G6K2RKN6|10|0|0
I0-M13S-41K1|B0FT327LLC|B0FT327LLC|9|0|0
IE-H1CE-QN5O|B0FT31PMDC|B0FT31PMDC|5|0|0
II-61R1-LGO9|X0018KO2QT|B0DJ8NGXQX|8|0|0
IM-O6QB-M8QF|B0CJP34BXS|B0CJP34BXS|69|0|0
IP-UOEF-N2Y6|B0BLTZBBQW|B0BLTZBBQW|17|0|0
JI-5464-Q7TZ|B0FT31Y24Y|B0FT31Y24Y|1|0|0
JT-39WV-BMTL|X0018KO2QJ|B0DJ8PHSFY|6|0|0
KB-I7EQ-K51U|B07DPND8ZT|B07DPND8ZT|167|0|0
LC-AR3J-R0JX|B0DTJZ8Z9G|B0DTJZ8Z9G|95|0|0
LD-I7T6-P7R1|X0010AXQE1|B09VKGZLK9|42|0|0
LG-KK18-L95Q|B0FT32J9LC|B0FT32J9LC|7|0|0
MA-71IZ-WA8Z|X0014C8H99|B0C7Q8VN46|4|0|0
MD-HQP8-F6JW|B0FT31JFL6|B0FT31JFL6|4|0|0
MG-VOSM-BV85|B0BLKFVLFM|B0BLKFVLFM|4|0|0
MN-W7G8-N9OB|B09M87R72Z|B09M87R72Z|69|0|0
MT-WBI7-NUCD|X0014CB48P|B0C7Q8G2XP|17|0|0
N9-4CTR-RAFY|B0FT32M3H6|B0FT32M3H6|6|0|0
N9-RQNR-6RAH|B0BLTYHXB2|B0BLTYHXB2|8|0|0
NB-CVZK-B5BL|B0D83N8L9G|B0D83N8L9G|4|0|0
ND-0DLT-FLUL|B0DTJZDBNS|B0DTJZDBNS|72|0|0
NS-HWJP-2FEJ|B0FT2Y82FP|B0FT2Y82FP|2|0|0
O8-GQWJ-FBLV|X001BN4VUZ|B0FS7J1FTZ|17|0|0
OG-1LX3-PGCI|B0FT36RH8V|B0FT36RH8V|8|0|0
OW-JOAO-FNMM|B0FT2WHF18|B0FT2WHF18|6|0|0
P9-H28U-PQQJ|B0FT357F5B|B0FT357F5B|7|0|0
Q0-SUBH-VREE|B085D9M5MP|B085D9M5MP|150|0|1
QJ-1W2B-E37N|B0FT326Y8S|B0FT326Y8S|5|0|0
QS-NQPC-FJ2J|B0BJ6H9WM3|B0BJ6H9WM3|42|0|0
R6-HB9E-MRM5|B0BLTY3CFF|B0BLTY3CFF|54|0|0
SY-J85X-9EMM|B0G6VXLPYF|B0G6VXLPYF|78|0|0
T1-NY6E-K1UV|B0BJ6KH32W|B0BJ6KH32W|153|0|0
TZ-M444-9V0W|B0FT34TY3X|B0FT34TY3X|5|0|0
U4-2IOG-SN3A|B0FT34XTL8|B0FT34XTL8|19|0|0
UN-F29Z-HQ8Z|B097X96CZF|B097X96CZF|11|0|0
UZ-MO5O-CE5Q|B0BJB2DCYK|B0BJB2DCYK|12|0|0
V3-VKOH-NDKX|B0BJ636FJW|B0BJ636FJW|18|0|0
V3-X3C8-8RDT|B0B5ZMPW5F|B0B5ZMPW5F|32|0|0
VH-W3WZ-PF9U|X0011IVC9N|B0B8Q4LR73|30|0|0
W0-1S7M-8T0A|B0FSZL4NTR|B0FSZL4NTR|16|0|0
W3-I8MK-QK2H|B09XZQP4SQ|B09XZQP4SQ|12|0|0
WE-XHLD-CPMG|B0FT2WJM5F|B0FT2WJM5F|13|0|0
WS-2B4T-VBMV|X0005K55LJ|B007JCL7QS|205|0|0
XM-QCH3-C3DF|B0FT34NDBL|B0FT34NDBL|1|0|0
XQ-Q3AP-1X4T|X000UIO2V5|B07LFKS2BJ|6|0|0
Z1-OEHV-SMGO|X001BMYUIT|B0FS7PH1XN|27|0|0
Z3-Y7IY-WRJP|B0FT32M3H7|B0FT32M3H7|2|0|0
Z5-RAWV-YPBO|X000ZAOUHJ|B09LV7TFK1|31|0|0
ZD-P7A4-MN5V|B0G1LMSDTB|B0G1LMSDTB|98|0|0
ZJ-POB9-UU9L|B0FSZMQLG1|B0FSZMQLG1|17|0|0
ZM-R4JO-4F07|B0FT36LT1W|B0FT36LT1W|12|0|0`;
  return source.trim().split('\n').map(function(line) {
    const parts = line.split('|');
    return {
      sku: parts[0], fnsku: parts[1], asin: parts[2],
      sellable: Number(parts[3]) || 0,
      transfer: Number(parts[4]) || 0,
      nonSellable: Number(parts[5]) || 0
    };
  });
}

function buildOpeningInventoryProductMaps_() {
  const lifecycle = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lifecycleValues = lifecycle.getDataRange().getValues();
  const lifecycleHeaders = lifecycleValues[0] || [];
  const at = function(name) { return lifecycleHeaders.indexOf(name); };
  const byAsin = {};
  lifecycleValues.slice(1).forEach(function(row) {
    const asin = String(row[at('asin')] || '').trim().toUpperCase();
    if (!asin) return;
    byAsin[asin] = {
      id: String(row[at('id')] || '').trim(),
      title: String(row[at('title')] || '').trim(),
      currentCost: Number(row[at('current_landed_cost')]) || 0
    };
  });

  const skuSheet = getSpreadsheet_().getSheetByName(SHEET_SKU_MASTER);
  const skuToAsin = {};
  const skuToTitle = {};
  if (skuSheet && skuSheet.getLastRow() > 1) {
    const values = skuSheet.getDataRange().getValues();
    const headers = values[0] || [];
    const skuIndex = headers.indexOf('sku');
    const asinIndex = headers.indexOf('asin');
    const titleIndex = headers.indexOf('product_name');
    values.slice(1).forEach(function(row) {
      const sku = skuIndex >= 0 ? String(row[skuIndex] || '').trim() : '';
      if (!sku) return;
      skuToAsin[sku] = asinIndex >= 0 ? String(row[asinIndex] || '').trim().toUpperCase() : '';
      skuToTitle[sku] = titleIndex >= 0 ? String(row[titleIndex] || '').trim() : '';
    });
  }
  return { byAsin: byAsin, skuToAsin: skuToAsin, skuToTitle: skuToTitle };
}

function createOpeningInventory20260101() {
  const ss = getSpreadsheet_();
  if (ss.getSheetByName(SHEET_OPENING_INVENTORY_20260101)) {
    throw new Error(SHEET_OPENING_INVENTORY_20260101 + ' はすでに存在します。入力済み単価を守るため上書きしません。');
  }

  const headers = [
    '採用', '期首日', '在庫元帳基準日', 'product_id', 'ASIN', 'SKU', 'FNSKU', '商品名',
    '販売可能在庫', '倉庫間輸送中', '非販売可', '期首数量', '単価', '期首在庫金額',
    '参考_現在原価', '判定', '元ファイル', '備考'
  ];
  const maps = buildOpeningInventoryProductMaps_();
  const source = getOpeningInventorySource20260101_();
  let matched = 0;
  let totalQty = 0;
  const rows = source.map(function(item) {
    const skuAsin = maps.skuToAsin[item.sku] || '';
    const asinMismatch = skuAsin && skuAsin !== item.asin;
    const product = maps.byAsin[item.asin] || null;
    const canUse = !!product && !asinMismatch && item.sellable > 0;
    if (canUse) matched++;
    totalQty += item.sellable;
    const warnings = [];
    if (!product) warnings.push('商品マスタ未登録');
    if (asinMismatch) warnings.push('SKUマスタのASIN不一致');
    if (item.transfer > 0) warnings.push('輸送中は期首数量に未加算');
    if (item.nonSellable > 0) warnings.push('非販売可は期首数量に未加算');
    const status = !product || asinMismatch ? '要確認' : '要単価入力';
    return [
      canUse, '2026-01-01', '2025-12-31', product ? product.id : '', item.asin,
      item.sku, item.fnsku, product ? product.title : (maps.skuToTitle[item.sku] || 'マスタ未登録商品'),
      item.sellable, item.transfer, item.nonSellable, item.sellable, '', '',
      product ? product.currentCost : '', status, OPENING_INVENTORY_SOURCE_FILE_, warnings.join(' / ')
    ];
  });

  const sheet = ss.insertSheet(SHEET_OPENING_INVENTORY_20260101);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(2, 14, rows.length, 1).setFormulasR1C1(
    rows.map(function() { return ['=IF(OR(RC[-2]="",RC[-1]=""),"",RC[-2]*RC[-1])']; })
  );
  sheet.getRange(2, 1, rows.length, 1).insertCheckboxes();
  sheet.getRange(2, 2, rows.length, 2).setNumberFormat('@');
  sheet.getRange(2, 9, rows.length, 4).setNumberFormat('0');
  sheet.getRange(2, 13, rows.length, 3).setNumberFormat('¥#,##0.00');
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21').setFontColor('#e8d5a3').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
  sheet.setColumnWidth(1, 55);
  sheet.setColumnWidths(2, 2, 105);
  sheet.setColumnWidth(4, 250);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 130);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 360);
  sheet.setColumnWidths(9, 7, 110);
  sheet.setColumnWidth(16, 105);
  sheet.setColumnWidth(17, 135);
  sheet.setColumnWidth(18, 260);
  sheet.getRange(2, 13, rows.length, 1).setBackground('#fff4cc');
  sheet.getRange(2, 16, rows.length, 1).setBackground('#f3f4f6');

  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('要確認')
    .setBackground('#fce8e6')
    .setFontColor('#b3261e')
    .setRanges([sheet.getRange(2, 16, rows.length, 1)])
    .build();
  sheet.setConditionalFormatRules([rule]);

  return {
    sheetName: sheet.getName(), rows: rows.length, matched: matched,
    needsReview: rows.length - matched, sellableQty: totalQty,
    sourceFile: OPENING_INVENTORY_SOURCE_FILE_
  };
}

/**
 * 2026-01-01期首在庫の登録前検査。
 * reorder_historyは変更せず、作業シートの「判定」列だけを更新する。
 */
function previewOpeningInventory20260101() {
  const report = inspectOpeningInventory20260101_(true);
  const lines = [
    '期首在庫 登録前プレビュー',
    '',
    '採用: ' + report.adoptedRows + '商品 / ' + report.quantity + '個',
    '期首在庫金額: ¥' + openingFormatNumber_(report.inventoryValue),
    '新規登録予定: ' + report.pendingRows + '件',
    '登録済み: ' + report.existingRows + '件',
    '除外: ' + report.excludedRows + '件',
    'エラー: ' + report.errors.length + '件'
  ];
  if (report.errors.length) {
    lines.push('', '先頭のエラー:', report.errors.slice(0, 8).map(function(e) {
      return '行' + e.rowNumber + ' ' + (e.sku || '-') + ': ' + e.message;
    }).join('\n'));
  } else {
    lines.push('', '検査合格です。「期首在庫を本番登録」を実行できます。');
  }
  SpreadsheetApp.getUi().alert(lines.join('\n'));
  return report;
}

/**
 * 検査済みの期首在庫をreorder_historyへ登録する。
 * - 登録直前に再検査
 * - reorder_historyをシートコピーでバックアップ
 * - 固有マーカーで二重登録を防止
 * - product_lifecycle.current_landed_costは更新しない
 */
function applyOpeningInventory20260101() {
  const ui = SpreadsheetApp.getUi();
  let report = inspectOpeningInventory20260101_(true);
  openingThrowIfInvalid_(report);

  if (!report.pendingRows) {
    ui.alert('期首在庫103件はすべて登録済みです。変更は行いませんでした。');
    return { status: 'already_applied', added: 0, existing: report.existingRows };
  }

  const answer = ui.alert(
    '2026-01-01 期首在庫を本番登録',
    [
      'reorder_historyへ' + report.pendingRows + '件を追加します。',
      '数量: ' + report.quantity + '個',
      '期首在庫金額: ¥' + openingFormatNumber_(report.inventoryValue),
      '',
      '登録直前にreorder_historyのバックアップを作成します。',
      '現在原価は上書きしません。実行しますか？'
    ].join('\n'),
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) {
    return { status: 'cancelled', added: 0 };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 確認ダイアログ表示中に他処理が走った可能性を考慮して再検査する。
    report = inspectOpeningInventory20260101_(false);
    openingThrowIfInvalid_(report);
    if (!report.pendingRows) {
      ui.alert('別の処理により、期首在庫はすでに登録済みでした。変更は行いませんでした。');
      return { status: 'already_applied', added: 0, existing: report.existingRows };
    }

    const ss = getSpreadsheet_();
    const reorderSheet = ss.getSheetByName(SHEET_REORDER_HISTORY);
    const backupName = openingBackupSheet_(ss, reorderSheet);
    const headers = reorderSheet.getRange(1, 1, 1, reorderSheet.getLastColumn())
      .getValues()[0].map(function(h) { return String(h || '').trim(); });
    const now = new Date().toISOString();
    const rows = report.pending.map(function(item) {
      const record = {
        id: 'opening_20260101_' + item.sku.replace(/[^A-Za-z0-9_-]/g, '_'),
        product_id: item.productId,
        sku: item.sku,
        order_date: OPENING_INVENTORY_DATE_20260101_,
        quantity: item.quantity,
        unit_price_1688: '',
        landed_cost_actual: item.unitCost,
        lead_time_days: '',
        expected_arrival_date: '',
        fba_fee_at_order: '',
        selling_price_at_order: '',
        notes: OPENING_INVENTORY_MARKER_20260101_ + ' 2025-12-31 FBA在庫元帳 / 期首在庫',
        created_at: now,
        updated_at: now
      };
      return headers.map(function(header) {
        return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
      });
    });

    reorderSheet.getRange(reorderSheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    openingWriteApplyLog_(ss, rows.length, report, backupName, now);

    const finalReport = inspectOpeningInventory20260101_(true);
    openingThrowIfInvalid_(finalReport);
    if (finalReport.existingRows !== OPENING_INVENTORY_EXPECTED_20260101_.adoptedRows || finalReport.pendingRows !== 0) {
      throw new Error('登録後検査に失敗しました。バックアップ「' + backupName + '」を保全し、処理を確認してください。');
    }

    ui.alert([
      '期首在庫の登録が完了しました。',
      '',
      '追加: ' + rows.length + '件',
      '数量: ' + finalReport.quantity + '個',
      '期首在庫金額: ¥' + openingFormatNumber_(finalReport.inventoryValue),
      'バックアップ: ' + backupName
    ].join('\n'));
    return {
      status: 'ok',
      added: rows.length,
      existing: finalReport.existingRows,
      backupSheet: backupName,
      quantity: finalReport.quantity,
      inventoryValue: finalReport.inventoryValue
    };
  } finally {
    lock.releaseLock();
  }
}

function inspectOpeningInventory20260101_(writeStatus) {
  const ss = getSpreadsheet_();
  const sourceSheet = ss.getSheetByName(SHEET_OPENING_INVENTORY_20260101);
  if (!sourceSheet) throw new Error(SHEET_OPENING_INVENTORY_20260101 + ' が見つかりません。');
  const sourceValues = sourceSheet.getDataRange().getValues();
  if (sourceValues.length < 2) throw new Error(SHEET_OPENING_INVENTORY_20260101 + ' にデータがありません。');

  const sourceHeaders = sourceValues[0].map(function(h) { return String(h || '').trim(); });
  const requiredSourceHeaders = [
    '採用', '期首日', '在庫元帳基準日', 'product_id', 'ASIN', 'SKU',
    '期首数量', '単価', '期首在庫金額', '判定', '元ファイル'
  ];
  openingRequireHeaders_(sourceHeaders, requiredSourceHeaders, SHEET_OPENING_INVENTORY_20260101);
  const s = openingHeaderMap_(sourceHeaders);

  const reorderSheet = ss.getSheetByName(SHEET_REORDER_HISTORY);
  if (!reorderSheet) throw new Error(SHEET_REORDER_HISTORY + ' が見つかりません。');
  const reorderValues = reorderSheet.getDataRange().getValues();
  const reorderHeaders = (reorderValues[0] || []).map(function(h) { return String(h || '').trim(); });
  openingRequireHeaders_(reorderHeaders, REQUIRED_HEADERS_REORDER, SHEET_REORDER_HISTORY);
  const r = openingHeaderMap_(reorderHeaders);

  const productSheet = ss.getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  if (!productSheet) throw new Error(SHEET_PRODUCT_LIFECYCLE + ' が見つかりません。');
  const productValues = productSheet.getDataRange().getValues();
  const productHeaders = (productValues[0] || []).map(function(h) { return String(h || '').trim(); });
  openingRequireHeaders_(productHeaders, ['id', 'asin'], SHEET_PRODUCT_LIFECYCLE);
  const p = openingHeaderMap_(productHeaders);
  const productsById = {};
  productValues.slice(1).forEach(function(row) {
    const id = String(row[p.id] || '').trim();
    if (id) productsById[id] = String(row[p.asin] || '').trim().toUpperCase();
  });

  const existingBySku = {};
  reorderValues.slice(1).forEach(function(row) {
    const id = String(row[r.id] || '').trim();
    const notes = String(row[r.notes] || '').trim();
    if (notes.indexOf(OPENING_INVENTORY_MARKER_20260101_) !== 0 && id.indexOf('opening_20260101_') !== 0) return;
    const sku = String(row[r.sku] || '').trim();
    if (!existingBySku[sku]) existingBySku[sku] = [];
    existingBySku[sku].push({
      id: id,
      productId: String(row[r.product_id] || '').trim(),
      sku: sku,
      orderDate: openingDateKey_(row[r.order_date]),
      quantity: openingNumber_(row[r.quantity]),
      unitCost: openingNumber_(row[r.landed_cost_actual])
    });
  });

  const errors = [];
  const pending = [];
  const seenSku = {};
  const statuses = [];
  let adoptedRows = 0;
  let excludedRows = 0;
  let existingRows = 0;
  let quantity = 0;
  let inventoryValue = 0;

  sourceValues.slice(1).forEach(function(row, offset) {
    const rowNumber = offset + 2;
    const adopted = openingTruthy_(row[s['採用']]);
    const sku = String(row[s.SKU] || '').trim();
    if (!adopted) {
      excludedRows++;
      statuses.push(['除外（採用なし）']);
      return;
    }

    adoptedRows++;
    const rowErrors = [];
    const productId = String(row[s.product_id] || '').trim();
    const asin = String(row[s.ASIN] || '').trim().toUpperCase();
    const openingDate = openingDateKey_(row[s['期首日']]);
    const ledgerDate = openingDateKey_(row[s['在庫元帳基準日']]);
    const sourceFile = String(row[s['元ファイル']] || '').trim();
    const qty = openingNumber_(row[s['期首数量']]);
    const unitCost = openingNumber_(row[s['単価']]);
    const amount = openingNumber_(row[s['期首在庫金額']]);

    if (!productId) rowErrors.push('product_idが空です');
    if (!sku) rowErrors.push('SKUが空です');
    if (!asin) rowErrors.push('ASINが空です');
    if (openingDate !== OPENING_INVENTORY_DATE_20260101_) rowErrors.push('期首日が2026-01-01ではありません');
    if (ledgerDate !== OPENING_INVENTORY_LEDGER_DATE_20260101_) rowErrors.push('在庫元帳基準日が2025-12-31ではありません');
    if (sourceFile !== OPENING_INVENTORY_SOURCE_FILE_) rowErrors.push('元ファイルが' + OPENING_INVENTORY_SOURCE_FILE_ + 'ではありません');
    if (!(qty > 0) || Math.floor(qty) !== qty) rowErrors.push('期首数量が正の整数ではありません');
    if (!(unitCost > 0)) rowErrors.push('単価が未入力または0以下です');
    if (!(amount > 0) || Math.abs(amount - qty * unitCost) > 0.01) rowErrors.push('期首在庫金額が数量×単価と一致しません');
    if (productId && !productsById[productId]) rowErrors.push('product_idが商品マスタに存在しません');
    if (productId && productsById[productId] && productsById[productId] !== asin) rowErrors.push('product_idとASINの紐づけが一致しません');
    if (sku && seenSku[sku]) rowErrors.push('採用対象内でSKUが重複しています（先行行: ' + seenSku[sku] + '）');
    if (sku) seenSku[sku] = rowNumber;

    quantity += qty || 0;
    inventoryValue += amount || 0;

    const existing = existingBySku[sku] || [];
    const exact = existing.filter(function(item) {
      return item.productId === productId &&
        item.orderDate === OPENING_INVENTORY_DATE_20260101_ &&
        item.quantity === qty && Math.abs(item.unitCost - unitCost) < 0.000001;
    });
    if (existing.length > 1 || (existing.length === 1 && exact.length !== 1)) {
      rowErrors.push('既存の期首在庫レコードと内容が競合しています');
    }

    rowErrors.forEach(function(message) {
      errors.push({ rowNumber: rowNumber, sku: sku, message: message });
    });
    if (rowErrors.length) {
      statuses.push(['エラー: ' + rowErrors.join(' / ')]);
    } else if (exact.length === 1) {
      existingRows++;
      statuses.push(['登録済み']);
    } else {
      pending.push({ rowNumber: rowNumber, productId: productId, asin: asin, sku: sku, quantity: qty, unitCost: unitCost, amount: amount });
      statuses.push(['登録準備OK']);
    }
  });

  const expected = OPENING_INVENTORY_EXPECTED_20260101_;
  if (sourceValues.length - 1 !== expected.sourceRows) {
    errors.push({ rowNumber: 0, sku: '', message: '元データ行数が期待値' + expected.sourceRows + '件と一致しません' });
  }
  if (adoptedRows !== expected.adoptedRows) {
    errors.push({ rowNumber: 0, sku: '', message: '採用件数が承認値' + expected.adoptedRows + '件と一致しません' });
  }
  if (excludedRows !== expected.excludedRows) {
    errors.push({ rowNumber: 0, sku: '', message: '除外件数が承認値' + expected.excludedRows + '件と一致しません' });
  }
  if (quantity !== expected.quantity) {
    errors.push({ rowNumber: 0, sku: '', message: '期首数量が承認値' + expected.quantity + '個と一致しません' });
  }
  if (Math.abs(inventoryValue - expected.inventoryValue) > 0.01) {
    errors.push({ rowNumber: 0, sku: '', message: '期首在庫金額が承認値¥' + openingFormatNumber_(expected.inventoryValue) + 'と一致しません' });
  }

  if (writeStatus && statuses.length) {
    sourceSheet.getRange(2, s['判定'] + 1, statuses.length, 1).setValues(statuses);
  }

  return {
    status: errors.length ? 'error' : 'ok',
    adoptedRows: adoptedRows,
    excludedRows: excludedRows,
    quantity: quantity,
    inventoryValue: inventoryValue,
    pendingRows: pending.length,
    existingRows: existingRows,
    pending: pending,
    errors: errors
  };
}

function openingThrowIfInvalid_(report) {
  if (!report.errors.length) return;
  const details = report.errors.slice(0, 12).map(function(e) {
    return (e.rowNumber ? '行' + e.rowNumber + ' ' : '') + (e.sku ? e.sku + ': ' : '') + e.message;
  });
  throw new Error('期首在庫の検査で' + report.errors.length + '件のエラーが見つかりました。\n' + details.join('\n'));
}

function openingRequireHeaders_(headers, required, sheetName) {
  const missing = required.filter(function(header) { return headers.indexOf(header) < 0; });
  if (missing.length) throw new Error(sheetName + ' に必要な列がありません: ' + missing.join(', '));
}

function openingHeaderMap_(headers) {
  const map = {};
  headers.forEach(function(header, index) { if (header) map[header] = index; });
  return map;
}

function openingNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const normalized = String(value || '').replace(/[￥¥,\s]/g, '');
  if (!normalized) return 0;
  const result = Number(normalized);
  return isFinite(result) ? result : 0;
}

function openingTruthy_(value) {
  if (value === true) return true;
  return ['true', '1', 'yes', 'y', 'はい', '採用'].indexOf(String(value || '').trim().toLowerCase()) >= 0;
}

function openingDateKey_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const match = String(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return String(value).trim().slice(0, 10);
  return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
}

function openingBackupSheet_(ss, sheet) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const backupName = SHEET_REORDER_HISTORY + '_backup_opening_' + timestamp;
  const backup = sheet.copyTo(ss).setName(backupName);
  backup.hideSheet();
  return backupName;
}

function openingWriteApplyLog_(ss, added, report, backupName, now) {
  const sheetName = 'opening_inventory_apply_log';
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'timestamp', 'opening_date', 'added_rows', 'quantity', 'inventory_value', 'backup_sheet', 'marker'
    ]]);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    now, OPENING_INVENTORY_DATE_20260101_, added, report.quantity,
    report.inventoryValue, backupName, OPENING_INVENTORY_MARKER_20260101_
  ]);
}

function openingFormatNumber_(value) {
  return Number(value || 0).toLocaleString('ja-JP');
}

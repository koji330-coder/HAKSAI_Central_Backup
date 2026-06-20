function exportMissingSubtitles() {
  const ss = getSpreadsheet_();
  const lcSheet    = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData     = lcSheet.getDataRange().getValues();
  const lcHdrs     = lcData[0];
  const lcIdIdx    = lcHdrs.indexOf('id');
  const lcAsinIdx  = lcHdrs.indexOf('asin');
  const lcTitleIdx = lcHdrs.indexOf('title');
  const lcSubIdx   = lcHdrs.indexOf('subtitle');
  const lcParIdx   = lcHdrs.indexOf('parent_asin');

  // 同じタイトルが複数あるASINを抽出（バリエーション候補）
  const titleCount = {};
  for (let i = 1; i < lcData.length; i++) {
    const title = String(lcData[i][lcTitleIdx] || '').trim();
    const asin  = String(lcData[i][lcAsinIdx]  || '').trim();
    if (!title || !asin) continue;
    if (!titleCount[title]) titleCount[title] = [];
    titleCount[title].push(i);
  }

  // subtitleが未設定の行を抽出
  let outSheet = ss.getSheetByName('missing_subtitles');
  if (outSheet) ss.deleteSheet(outSheet);
  outSheet = ss.insertSheet('missing_subtitles');

  const headers = ['id', 'asin', 'タイトル', '現在のsubtitle', '現在のparent_asin', 'subtitle（手入力）', 'parent_asin（手入力）'];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1c1c21').setFontColor('#e8d5a3').setFontWeight('bold');

  const rows = [];
  for (let i = 1; i < lcData.length; i++) {
    const asin     = String(lcData[i][lcAsinIdx]  || '').trim();
    const title    = String(lcData[i][lcTitleIdx]  || '').trim();
    const subtitle = String(lcData[i][lcSubIdx]    || '').trim();
    const parentAsin = lcParIdx >= 0 ? String(lcData[i][lcParIdx] || '').trim() : '';
    const id       = String(lcData[i][lcIdIdx]     || '').trim();
    if (!asin || !title) continue;

    // 同じタイトルが2件以上 または subtitle未設定かつparent_asin未設定
    const isDuplTitle = titleCount[title] && titleCount[title].length > 1;
    const isNoSubtitle = !subtitle;
    if (!isDuplTitle && !isNoSubtitle) continue;

    rows.push([id, asin, title, subtitle, parentAsin, '', '']);
  }

  if (rows.length) {
    outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  outSheet.setColumnWidth(3, 300);
  outSheet.setColumnWidth(6, 200);
  outSheet.setColumnWidth(7, 150);
  outSheet.setFrozenRows(1);

  // 手入力列を黄色でハイライト
  if (rows.length) {
    outSheet.getRange(2, 6, rows.length, 2)
      .setBackground('#2a2a1a').setFontColor('#e8d5a3');
  }

  Logger.log(`missing_subtitles: ${rows.length}件出力`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${rows.length}件を missing_subtitles シートに出力しました。F列にsubtitle、G列にparent_asinを入力後、importFromMissingSubtitles() を実行してください。`,
    '✅ 完了', 8
  );
}


function importFromMissingSubtitles() {
  const ss = getSpreadsheet_();
  const srcSheet = ss.getSheetByName('missing_subtitles');
  if (!srcSheet) {
    Logger.log('missing_subtitles シートが見つかりません。');
    return;
  }

  const data    = srcSheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx         = headers.indexOf('id');
  const subtitleIdx   = headers.indexOf('subtitle（手入力）');
  const parentAsinIdx = headers.indexOf('parent_asin（手入力）');

  const lcSheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lcData  = lcSheet.getDataRange().getValues();
  const lcHdrs  = lcData[0];
  const lcIdIdx  = lcHdrs.indexOf('id');
  const lcSubIdx = lcHdrs.indexOf('subtitle');
  const lcParIdx = lcHdrs.indexOf('parent_asin');

  // id → 行番号マップ
  const idToRow = {};
  for (let i = 1; i < lcData.length; i++) {
    const id = String(lcData[i][lcIdIdx] || '').trim();
    if (id) idToRow[id] = i + 1;
  }

  let updated = 0;
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const id         = String(data[i][idIdx]         || '').trim();
    const subtitle   = String(data[i][subtitleIdx]   || '').trim();
    const parentAsin = String(data[i][parentAsinIdx] || '').trim();
    if (!id || (!subtitle && !parentAsin)) { skipped++; continue; }

    const rowNum = idToRow[id];
    if (!rowNum) { skipped++; continue; }

    if (subtitle && lcSubIdx >= 0) {
      lcSheet.getRange(rowNum, lcSubIdx + 1).setValue(subtitle);
    }
    if (parentAsin && lcParIdx >= 0) {
      lcSheet.getRange(rowNum, lcParIdx + 1).setValue(parentAsin);
    }
    updated++;
  }

  Logger.log(`importFromMissingSubtitles: ${updated}件更新 / ${skipped}件スキップ`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${updated}件のsubtitle/parent_asinを更新しました。`,
    '✅ 完了', 5
  );
}

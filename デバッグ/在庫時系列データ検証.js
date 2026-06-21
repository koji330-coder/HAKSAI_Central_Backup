function _peekInventorySnapshot() {
  const sh = getReportSheet_(SHEET_INVENTORY_SNAPSHOT, REQUIRED_HEADERS_INVENTORY_SNAPSHOT);
  const v = sh.getDataRange().getValues();
  Logger.log('行数（ヘッダー込み）: ' + v.length);
  Logger.log('ヘッダー: ' + JSON.stringify(v[0]));
  // 先頭6行ぶんサンプル表示
  for (let i = 1; i < Math.min(v.length, 7); i++) {
    Logger.log(i + ': ' + JSON.stringify(v[i]));
  }
  // ASINごとの行数を集計（時系列が何点あるか確認）
  const asinIdx = v[0].indexOf('asin');
  const dateIdx = v[0].indexOf('snapshot_date');
  const cnt = {};
  for (let i = 1; i < v.length; i++) {
    const a = v[i][asinIdx];
    (cnt[a] = cnt[a] || []).push(v[i][dateIdx]);
  }
  Object.keys(cnt).forEach(a => Logger.log(a + ' → ' + cnt[a].length + '点: ' + cnt[a].join(', ')));
}

function _peekLifecycleKeys() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  const v = sh.getDataRange().getValues();
  const hdr = v[0];
  Logger.log('ヘッダー: ' + JSON.stringify(hdr));

  // is_launched / asin 相当の列を探す
  const launchIdx = hdr.findIndex(h => String(h).toLowerCase().includes('launch'));
  const asinIdx   = hdr.indexOf('asin');
  Logger.log('asin列index=' + asinIdx + ' / launch列index=' + launchIdx + '（' + (launchIdx>=0?hdr[launchIdx]:'見つからず') + '）');

  // 販売中とみなせる行数を数える（true / TRUE / "true" すべて拾う）
  let launched = 0, withAsin = 0;
  const sample = [];
  for (let i = 1; i < v.length; i++) {
    const isL = launchIdx >= 0 && String(v[i][launchIdx]).toLowerCase() === 'true';
    const asin = asinIdx >= 0 ? String(v[i][asinIdx]).trim() : '';
    if (isL) launched++;
    if (isL && asin) { withAsin++; if (sample.length < 5) sample.push(asin); }
  }
  Logger.log('全行数（ヘッダー除く）: ' + (v.length - 1));
  Logger.log('is_launched=true: ' + launched + ' 件 / うちASINあり: ' + withAsin + ' 件');
  Logger.log('販売中ASINサンプル: ' + JSON.stringify(sample));
}

function _peekInventoryAlertsJson() {
  Logger.log(JSON.stringify(getInventoryAlerts(), null, 2));
}

function _peekInfItems() {
  const r = getInventoryAlerts();
  const inf = (r.ok || []).filter(p => p.oosInf === true);
  Logger.log('∞（在庫あり×日販0）: ' + inf.length + '件');
  inf.slice(0, 5).forEach(p =>
    Logger.log(JSON.stringify({
      asin: p.asin, avail: p.avail, vel: p.vel,
      daysRemain: p.daysRemain, oosInf: p.oosInf, title: (p.title||'').slice(0,30)
    }))
  );
}

function _peekRouter() {
  const res = doGet({ parameter: { action: 'getInventoryAlerts' } });
  Logger.log(res.getContent());
}
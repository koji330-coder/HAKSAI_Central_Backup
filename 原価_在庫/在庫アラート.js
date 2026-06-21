// ============================================================
// 原価_在庫/在庫アラート.js
//   在庫スナップショットを分析して「今週の発注アラート」を作る本番ロジック。
//   - analyzeInventory_()    : 分析の芯（構造化データを返す内部ヘルパー）
//   - getInventoryAlerts()   : 本番。フロントに返すJSONペイロードを組む
//   - setAlertSnooze()       : 本番。保留/終売をセット（ディスパッチャから呼ぶ）
//   - getAlertSnoozeMap_() / setAlertSnoozeState_() : スヌーズ読み書き（内部）
//   - _debugInventoryAlerts(): 手元検証用にログ出力
// ============================================================

// ── しきい値（日数）──
const INV_LEAD_TIME       = 21; // これ以下＝🚨(crit)
const INV_SAFETY_DAYS     = 7;  // LEAD+これ以下＝🔴(warn)
const INV_DEAD_WINDOW     = 21; // 死蔵判定：直近この日数の窓を見る
const INV_DEAD_MIN_OBS    = 14; // 死蔵判定：最古〜最新がこの日数以上ある商品のみ対象

// ── スヌーズ（保留/終売）シート ──
const SHEET_ALERT_SNOOZE   = 'alert_snooze';
const HEADERS_ALERT_SNOOZE = ['asin', 'state', 'note', 'updated_at'];

function getAlertSnoozeSheet_() {
  return getReportSheet_(SHEET_ALERT_SNOOZE, HEADERS_ALERT_SNOOZE);
}

// スヌーズ中ASIN → { state, note, updated_at }（通常商品は含まない）
function getAlertSnoozeMap_() {
  const sh = getAlertSnoozeSheet_();
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return {};
  const H = v[0];
  const cA = H.indexOf('asin'), cS = H.indexOf('state'), cN = H.indexOf('note'), cU = H.indexOf('updated_at');
  const map = {};
  for (let i = 1; i < v.length; i++) {
    const asin = String(v[i][cA] || '').trim();
    const state = String(v[i][cS] || '').trim();
    if (!asin || !state || state === 'active') continue;
    map[asin] = { state, note: String(v[i][cN] || ''), updated_at: String(v[i][cU] || '') };
  }
  return map;
}

// 状態セット（upsert）。state='active'/'' で通常に戻す（行削除）。
function setAlertSnoozeState_(asin, state, note) {
  asin = String(asin || '').trim();
  if (!asin) throw new Error('asin が必要です。');
  state = String(state || '').trim();
  const valid = { hold: 1, discontinued: 1, active: 1, '': 1 };
  if (!valid[state]) throw new Error('state は hold / discontinued / active のいずれかです。');

  const sh = getAlertSnoozeSheet_();
  const v = sh.getDataRange().getValues();
  const cA = v[0].indexOf('asin');
  let rowIdx = -1;
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][cA] || '').trim() === asin) { rowIdx = i; break; }
  }
  if (state === 'active' || state === '') {
    if (rowIdx >= 0) sh.deleteRow(rowIdx + 1);
    return { asin, state: 'active' };
  }
  const now = new Date().toISOString();
  const row = [asin, state, String(note || ''), now];
  if (rowIdx >= 0) sh.getRange(rowIdx + 1, 1, 1, HEADERS_ALERT_SNOOZE.length).setValues([row]);
  else sh.appendRow(row);
  return { asin, state, note: String(note || ''), updated_at: now };
}

// ── 分析の芯：在庫スナップショットを読み、商品を分類して構造化データで返す ──
//   返り値: { live, alerts, ok, deadstock, parked, skipped }
//   alerts = 🚨🔴（要対応・欠品が近い順）, ok = ✅🟢（余裕・欠品が近い順）
function analyzeInventory_() {
  const snooze = getAlertSnoozeMap_();

  // 販売中ASIN（title/emoji/subtitle も拾う）
  const lc = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  const lv = lc.getDataRange().getValues();
  const lh = lv[0];
  const cAsin = lh.indexOf('asin'), cLaunch = lh.indexOf('is_launched'),
        cTitle = lh.indexOf('title'), cEmoji = lh.indexOf('emoji'), cSub = lh.indexOf('subtitle');
  const meta = {};
  const liveAsins = new Set();
  for (let i = 1; i < lv.length; i++) {
    if (String(lv[i][cLaunch]).toLowerCase() !== 'true') continue;
    const a = String(lv[i][cAsin]).trim();
    if (!a) continue;
    liveAsins.add(a);
    meta[a] = {
      title: String(lv[i][cTitle] || '').trim(),
      emoji: String(lv[i][cEmoji] || '📦').trim() || '📦',
      subtitle: cSub >= 0 ? String(lv[i][cSub] || '').trim() : ''
    };
  }

  // スナップショット収集
  const sh = getReportSheet_(SHEET_INVENTORY_SNAPSHOT, REQUIRED_HEADERS_INVENTORY_SNAPSHOT);
  const sv = sh.getDataRange().getValues();
  const H = sv[0];
  const ci = n => H.indexOf(n);
  const cDate = ci('snapshot_date'), cAs = ci('asin'), cAv = ci('available'),
        cT7 = ci('daily_t7'), cDr = ci('days_remain');
  const num = v => { const n = Number(v); return (v !== '' && v !== null && isFinite(n)) ? n : null; };
  const series = {};
  for (let i = 1; i < sv.length; i++) {
    const a = String(sv[i][cAs]).trim();
    if (!liveAsins.has(a)) continue;
    (series[a] = series[a] || []).push({
      date: String(sv[i][cDate]).slice(0, 10),
      avail: num(sv[i][cAv]) || 0,
      t7: num(sv[i][cT7]),
      remainRaw: sv[i][cDr]
    });
  }

  const alerts = [], ok = [], deadstock = [], parked = [], skipped = [];

  Object.keys(series).forEach(asin => {
    const pts = series[asin].sort((a, b) => a.date < b.date ? -1 : 1);
    if (!pts.length) return;
    const last = pts[pts.length - 1];
    const m = meta[asin] || { title: '', emoji: '📦', subtitle: '' };

    // スヌーズ中は別枠（最優先）
    const sn = snooze[asin];
    if (sn) {
      parked.push({ asin, title: m.title, emoji: m.emoji, subtitle: m.subtitle, avail: last.avail, state: sn.state, note: sn.note });
      return;
    }

    // 死蔵判定（日数の窓で。点の個数では数えない）
    const spanDays = (new Date(last.date) - new Date(pts[0].date)) / 86400000;
    const winStart = new Date(new Date(last.date).getTime() - INV_DEAD_WINDOW * 86400000);
    const winPts = pts.filter(p => new Date(p.date) >= winStart);
    const moved = winPts.some(p => p.avail > 0 || (p.t7 != null && p.t7 > 0));
    if (spanDays >= INV_DEAD_MIN_OBS && winPts.length > 0 && !moved) {
      deadstock.push({ asin, title: m.title, emoji: m.emoji, subtitle: m.subtitle,
        spanDays: Math.round(spanDays), traj: pts.map(p => p.date.slice(5) + ':在' + p.avail).join(' → ') });
      return;
    }

    // 日販（t7実数 > 差分推定）
    let vel = (last.t7 != null && last.t7 > 0) ? last.t7 : null;
    let velSrc = vel != null ? 't7実数' : '';
    if (vel == null && pts.length >= 2) {
      let sold = 0, days = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = (new Date(pts[i].date) - new Date(pts[i - 1].date)) / 86400000;
        const drop = pts[i - 1].avail - pts[i].avail;
        if (d > 0 && drop > 0) { sold += drop; days += d; }
      }
      if (days > 0) { vel = sold / days; velSrc = '差分推定'; }
    }

    // 欠品まで日数（days_remain実数 > 在庫÷日販）
    let oos = null, oosSrc = '', oosInf = false;
    const rr = last.remainRaw;
    if (rr === '∞') { oos = Infinity; oosInf = true; oosSrc = 'days_remain'; }
    else if (num(rr) != null) { oos = num(rr); oosSrc = 'days_remain'; }
    else if (vel != null && vel > 0) { oos = Math.floor(last.avail / vel); oosSrc = '在庫÷日販'; }
    else if (last.avail === 0) { oos = 0; oosSrc = '在庫0'; }

    if (oos == null) {
      skipped.push({ asin, title: m.title, reason: last.avail === 0 ? '在庫0・速度不明' : '速度・残日数とも不明' });
      return;
    }

    // 速度トレンド
    const t7pts = pts.filter(p => p.t7 != null && p.t7 > 0);
    let trend = '—';
    if (t7pts.length >= 2) {
      const f = t7pts[0].t7, l = t7pts[t7pts.length - 1].t7;
      trend = l >= f * 1.3 ? '加速↑' : l <= f * 0.7 ? '減速↓' : '横ばい→';
    }

    // 重大度
    let severity;
    if (oosInf) severity = 'ample';
    else if (oos <= INV_LEAD_TIME) severity = 'crit';
    else if (oos <= INV_LEAD_TIME + INV_SAFETY_DAYS) severity = 'warn';
    else severity = 'ok';

    const item = {
      asin, title: m.title, emoji: m.emoji, subtitle: m.subtitle,
      severity, avail: last.avail,
      vel: vel != null ? Math.round(vel * 100) / 100 : null, velSrc,
      daysRemain: oosInf ? null : oos, oosInf, oosSrc, trend,
      traj: pts.map(p => p.date.slice(5) + ':在' + p.avail + (p.t7 != null ? '/日販' + p.t7 : '')).join(' → '),
      _sort: oos // ソート用（Infinityは最後）
    };
    (severity === 'crit' || severity === 'warn' ? alerts : ok).push(item);
  });

  const bySort = (a, b) => a._sort - b._sort;
  alerts.sort(bySort);
  ok.sort(bySort);
  alerts.forEach(x => delete x._sort);
  ok.forEach(x => delete x._sort);

  return { live: liveAsins.size, alerts, ok, deadstock, parked, skipped };
}

// ── 本番：フロントに返すJSONペイロード ──
function getInventoryAlerts() {
  const a = analyzeInventory_();
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      alerts: a.alerts.length, ok: a.ok.length,
      deadstock: a.deadstock.length, parked: a.parked.length, live: a.live
    },
    alerts: a.alerts,
    ok: a.ok,
    deadstock: a.deadstock,
    parked: a.parked
  };
}

// ── 本番：保留/終売をセット（ディスパッチャ配線は別ステップ）──
function setAlertSnooze(asin, state, note) {
  return setAlertSnoozeState_(asin, state, note);
}

// ── 手元検証用：芯の結果をログに出す（旧 _analyzeInventoryWeekly の後継）──
function _debugInventoryAlerts() {
  const a = analyzeInventory_();
  Logger.log('===== 在庫アラート / 販売中' + a.live + ' ｜ アラート' + a.alerts.length
    + ' ｜ 余裕' + a.ok.length + ' ｜ 死蔵' + a.deadstock.length
    + ' ｜ 退避' + a.parked.length + ' ｜ 除外' + a.skipped.length + ' =====');
  const fmt = x => {
    const f = x.severity === 'crit' ? '🚨' : x.severity === 'warn' ? '🔴' : x.severity === 'ample' ? '🟢' : '✅';
    const d = x.oosInf ? '∞' : '約' + x.daysRemain + '日';
    const v = x.vel != null ? x.vel + '個(' + x.velSrc + ')' : '不明';
    return f + ' ' + x.asin + ' ' + x.title + '\n   在庫' + x.avail + ' / 日販' + v + ' / 欠品まで' + d + ' / 速度' + x.trend;
  };
  Logger.log('--- 🚨🔴 アラート ---'); a.alerts.forEach(x => Logger.log(fmt(x)));
  Logger.log('--- ✅🟢 在庫余裕 ---'); a.ok.forEach(x => Logger.log(fmt(x)));
  Logger.log('--- 💀 死蔵・要判断 ' + a.deadstock.length + '件 ---');
  a.deadstock.forEach(d => Logger.log('・' + d.asin + ' ' + d.title + '（観測' + d.spanDays + '日）'));
  const holds = a.parked.filter(p => p.state === 'hold'), disc = a.parked.filter(p => p.state === 'discontinued');
  Logger.log('--- ⏸ 保留 ' + holds.length + ' / 🛑 終売 ' + disc.length + ' ---');
  a.parked.forEach(p => Logger.log('・' + p.asin + ' [' + p.state + '] ' + p.title + (p.note ? ' 📝' + p.note : '')));
  Logger.log('--- 除外 ' + a.skipped.length + '件 ---');
  a.skipped.forEach(s => Logger.log('・' + s.asin + ': ' + s.reason));
}
/****************************************************
 * HAKSAI Central
 * Keepaのvariations(Amazon公式バリエーション情報)を使って
 * 商品マスタ対象ASINのparent_asinを一括で埋めるバックフィル。
 *
 * 親子関係を設定.js(タイトル類似度ヒューリスティック)とは別の
 * 情報源(Keepa公式データ)なので、あえて別ファイルに分離している。
 ****************************************************/

const KEEPA_BACKFILL_TRIGGER_FN = 'runKeepaOwnListingBackfill';
const KEEPA_BACKFILL_LOG_SHEET = 'keepa_backfill_log';
const KEEPA_BACKFILL_TOKEN_SAFETY_MARGIN = 3;
const KEEPA_BACKFILL_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/**
 * 30分間隔のトリガーを設置する。GASエディタから手動で1回実行する。
 */
function startKeepaOwnListingBackfill() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === KEEPA_BACKFILL_TRIGGER_FN)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(KEEPA_BACKFILL_TRIGGER_FN).timeBased().everyMinutes(30).create();
  Logger.log('Keepaバックフィルのトリガーを設置しました(30分間隔)。');
}

/**
 * トリガーを削除する(手動リセット用)。
 */
function stopKeepaOwnListingBackfill() {
  const deleted = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === KEEPA_BACKFILL_TRIGGER_FN);
  deleted.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('トリガー削除: ' + deleted.length + '本');
}

/**
 * トリガー本体。未取得ASINが無くなるまで自分自身のトリガーを維持し、
 * 完了したら自動でトリガーを削除する。
 */
function runKeepaOwnListingBackfill() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('前回実行中のためスキップ'); return; }
  try {
    const startedAt = Date.now();

    // 対象 = 商品マスタと同じ条件(sku_master登録 かつ 売上実績あり)
    const target = getProductCatalog_().filter(item => item.skus.length > 0 && !!item.first_sale_date);

    // 既にKeepaスナップショットがあるASIN
    const snapRef = pgEnsureSheet_(LF_SNAPSHOT_SHEET, PG_SNAPSHOT_HEADERS);
    const snapData = snapRef.sheet.getDataRange().getValues();
    const snapAsinIdx = snapRef.headers.indexOf('own_asin');
    const hasSnapshot = new Set();
    for (let i = 1; i < snapData.length; i++) {
      const a = String(snapData[i][snapAsinIdx] || '').trim().toUpperCase();
      if (a) hasSnapshot.add(a);
    }

    const missing = target.filter(item => !hasSnapshot.has(item.asin)).map(item => item.asin).sort();

    if (!missing.length) {
      Logger.log('未取得ASINは0件。バックフィル完了、トリガーを削除します。');
      stopKeepaOwnListingBackfill();
      appendKeepaBackfillLog_({ processed: 0, linkedGroups: 0, skippedNoRow: 0, skippedAlreadySet: 0, errors: 0, note: '完了・トリガー削除' });
      return;
    }

    // product_lifecycle を asin→id / asin→現parent_asin で引けるようにする
    const lifecycle = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
    const lv = lifecycle.getDataRange().getValues();
    const lh = lv[0];
    const ixAsin = lh.indexOf('asin'), ixId = lh.indexOf('id'), ixParent = lh.indexOf('parent_asin');
    const asinToId = {}, asinToCurrentParent = {};
    for (let i = 1; i < lv.length; i++) {
      const a = String(lv[i][ixAsin] || '').trim().toUpperCase();
      if (!a) continue;
      asinToId[a] = String(lv[i][ixId] || '').trim();
      asinToCurrentParent[a] = String(lv[i][ixParent] || '').trim();
    }

    let processed = 0, linkedGroups = 0, skippedNoRow = 0, skippedAlreadySet = 0, errors = 0;

    for (const asin of missing) {
      if (Date.now() - startedAt > KEEPA_BACKFILL_TIME_BUDGET_MS) break;

      let snap;
      try {
        snap = refreshOwnListingSnapshot_(asin);
      } catch (e) {
        errors++;
        Logger.log('Keepa取得失敗: ' + asin + ' ' + e.message);
        continue;
      }
      processed++;

      const linkResult = linkParentAsinGroup_(asin, snap.variations, asinToId, asinToCurrentParent);
      if (linkResult.groupAsins.length >= 2) linkedGroups++;
      skippedNoRow += linkResult.skippedNoRow;
      skippedAlreadySet += linkResult.skippedAlreadySet;

      const tokensLeft = Number(snap.keepa_tokens_left) || 0;
      if (tokensLeft < KEEPA_BACKFILL_TOKEN_SAFETY_MARGIN) {
        Logger.log('トークン残量が少ないためこの回はここで打ち切り: ' + tokensLeft);
        break;
      }
    }

    appendKeepaBackfillLog_({
      processed, linkedGroups, skippedNoRow, skippedAlreadySet, errors,
      note: `残り${missing.length - processed}件`
    });
    Logger.log(`今回処理: ${processed}件 / グループ紐付け: ${linkedGroups} / 既存値尊重スキップ: ${skippedAlreadySet} / lifecycle行無しスキップ: ${skippedNoRow} / エラー: ${errors}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Keepaのvariations + 自社product_lifecycleの行有無から、バリエーショングループを組み、
 * ASIN昇順の先頭を共有キーとしてparent_asinに書き込む(未設定のものだけ)。
 * バッチ処理・単発リフレッシュの両方から呼ばれる共有ロジック。
 */
function linkParentAsinGroup_(asin, variations, asinToId, asinToCurrentParent) {
  const siblingAsins = (variations || [])
    .map(v => String((v && v.asin) || '').trim().toUpperCase())
    .filter(a => a && asinToId[a]); // 自社product_lifecycleに行があるものだけ対象にする

  const groupAsins = Array.from(new Set([asin, ...siblingAsins])).filter(a => asinToId[a]);

  let skippedAlreadySet = 0, skippedNoRow = 0;

  if (groupAsins.length >= 2) {
    const key = groupAsins.slice().sort()[0];
    groupAsins.forEach(a => {
      const current = asinToCurrentParent[a] || '';
      if (current === key) return; // 既に同じ値
      if (current) { skippedAlreadySet++; return; } // 別の値が既に設定済みなら触らない
      const card = getCardDetail_ProductLifecycle(asinToId[a]);
      if (!card) { skippedNoRow++; return; }
      card.parent_asin = key;
      updateCardInLifecycle(card);
      asinToCurrentParent[a] = key; // 同一実行内での重複書き込みを防ぐ
    });
  }

  return { groupAsins, skippedAlreadySet, skippedNoRow };
}

/**
 * 商品マスタから、1商品分だけKeepaを再取得してバリエーショングループを更新する。
 * 将来カラー・サイズが追加された時に、この商品だけピンポイントで更新できる。
 */
function refreshProductVariationLink_(asinValue) {
  const asin = pgAsin_(asinValue);
  const snap = refreshOwnListingSnapshot_(asin);

  const lifecycle = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const lv = lifecycle.getDataRange().getValues();
  const lh = lv[0];
  const ixAsin = lh.indexOf('asin'), ixId = lh.indexOf('id'), ixParent = lh.indexOf('parent_asin');
  const asinToId = {}, asinToCurrentParent = {};
  for (let i = 1; i < lv.length; i++) {
    const a = String(lv[i][ixAsin] || '').trim().toUpperCase();
    if (!a) continue;
    asinToId[a] = String(lv[i][ixId] || '').trim();
    asinToCurrentParent[a] = String(lv[i][ixParent] || '').trim();
  }

  const result = linkParentAsinGroup_(asin, snap.variations, asinToId, asinToCurrentParent);
  return {
    asin,
    parent_asin: asinToCurrentParent[asin] || '',
    variation_count: result.groupAsins.length,
    skipped_already_set: result.skippedAlreadySet,
    skipped_no_lifecycle_row: result.skippedNoRow
  };
}

function appendKeepaBackfillLog_(row) {
  const headers = ['timestamp', 'processed', 'linked_groups', 'skipped_no_lifecycle_row', 'skipped_already_set', 'errors', 'note'];
  const sheet = getSheetByName_(KEEPA_BACKFILL_LOG_SHEET, headers);
  sheet.appendRow([new Date(), row.processed, row.linkedGroups, row.skippedNoRow, row.skippedAlreadySet, row.errors, row.note || '']);
}

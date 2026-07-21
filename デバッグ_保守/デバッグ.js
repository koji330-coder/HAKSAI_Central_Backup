// ============================================
// ASIN別デバッグ関数
// GASエディタに貼り付けて debugAsin() を実行
// ============================================

const DEBUG_ASIN = 'B0FSZKJWP9';

function debugAsin() {
  const results = [];
  const log = (label, value) => {
    const line = `[${label}]\n${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}`;
    results.push(line);
    Logger.log(line);
  };

  log('=== デバッグ開始 ===', `対象ASIN: ${DEBUG_ASIN}`);

  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );

  // ============================================
  // 1. product_lifecycle の該当行を確認
  // ============================================
  log('--- [1] product_lifecycle ---', '');

  const lcSheet = ss.getSheetByName('product_lifecycle');
  if (!lcSheet) {
    log('ERROR', 'product_lifecycle シートが見つかりません');
    return;
  }

  const lcData    = lcSheet.getDataRange().getValues();
  const lcHeaders = lcData[0];
  const lcAsinIdx = lcHeaders.indexOf('asin');

  let lcRow = null;
  let lcRowNum = -1;
  for (let i = 1; i < lcData.length; i++) {
    if (String(lcData[i][lcAsinIdx] || '').trim() === DEBUG_ASIN) {
      lcRow    = lcData[i];
      lcRowNum = i + 1;
      break;
    }
  }

  if (!lcRow) {
    log('ERROR', `product_lifecycle に ASIN ${DEBUG_ASIN} が見つかりません`);
  } else {
    log('product_lifecycle 行番号', lcRowNum);

    // FBA関連フィールドを全部出力
    const fbaFields = [
      'asin', 'title', 'fba_stock', 'fba_inbound',
      'fba_daily_t7', 'fba_days_remain', 'fba_alert', 'fba_synced_at'
    ];
    const fbaValues = {};
    fbaFields.forEach(f => {
      const idx = lcHeaders.indexOf(f);
      fbaValues[f] = idx >= 0 ? lcRow[idx] : '❌列なし';
    });
    log('FBA関連フィールド（現在の値）', fbaValues);

    // fba_daily_t7 の型と値を詳細確認
    const dailyIdx = lcHeaders.indexOf('fba_daily_t7');
    if (dailyIdx >= 0) {
      const rawVal = lcRow[dailyIdx];
      log('fba_daily_t7 詳細', {
        value:  rawVal,
        type:   typeof rawVal,
        isEmpty: rawVal === '' || rawVal === null || rawVal === undefined,
        asNumber: Number(rawVal),
      });
    }
  }

  // ============================================
  // 2. sku_master の該当SKUを確認
  // ============================================
  log('--- [2] sku_master ---', '');

  const skuSheet = ss.getSheetByName('sku_master');
  if (!skuSheet) {
    log('WARNING', 'sku_master シートが見つかりません');
  } else {
    const skuData    = skuSheet.getDataRange().getValues();
    const skuHeaders = skuData[0];
    const skuAsinIdx = skuHeaders.indexOf('asin');
    const skuSkuIdx  = skuHeaders.indexOf('sku');
    const skuFnIdx   = skuHeaders.indexOf('fnsku');

    const matchedSkus = [];
    for (let i = 1; i < skuData.length; i++) {
      if (String(skuData[i][skuAsinIdx] || '').trim() === DEBUG_ASIN) {
        matchedSkus.push({
          sku:          skuData[i][skuSkuIdx],
          fnsku:        skuData[i][skuFnIdx],
          product_name: skuData[i][skuHeaders.indexOf('product_name')],
          updated_at:   skuData[i][skuHeaders.indexOf('updated_at')],
        });
      }
    }

    if (matchedSkus.length === 0) {
      log('WARNING', `sku_master に ASIN ${DEBUG_ASIN} のSKUが見つかりません → 在庫同期時にASINとSKUが紐付いていない可能性`);
    } else {
      log(`sku_master ヒット（${matchedSkus.length}件）`, matchedSkus);
    }
  }

  // ============================================
  // 3. 直近の syncInventoryFromReport 受信データを再現
  //    → フロントから送られるキー名を fba_synced_at の有無で推測
  // ============================================
  log('--- [3] 同期済みデータの検証 ---', '');

  if (lcRow) {
    const syncedAt = lcRow[lcHeaders.indexOf('fba_synced_at')];
    const dailyVal = lcRow[lcHeaders.indexOf('fba_daily_t7')];
    const stockVal = lcRow[lcHeaders.indexOf('fba_stock')];

    log('最終同期日時', syncedAt || '（未設定 = 一度も同期されていない）');
    log('現在の fba_stock', stockVal === '' ? '空（同期されていないか 0）' : stockVal);
    log('現在の fba_daily_t7', dailyVal === '' ? '❌ 空！← これがバグの原因の可能性大' : dailyVal);

    if (dailyVal === '' || dailyVal === null) {
      log('⚠️ 診断', [
        'fba_daily_t7 が空です。以下の原因が考えられます:',
        '  A) フロントが送るキー名が dailyT7 / alertDaily 以外（例: daily_t7）',
        '  B) syncInventoryFromReport が一度も実行されていない',
        '  C) ASIN がマッチしなかった（大文字小文字・スペース等）',
      ].join('\n'));
    }
  }

  // ============================================
  // 4. transaction_history の集計確認（直近3ヶ月）
  // ============================================
  log('--- [4] transaction_history（直近データ確認） ---', '');

  const txSheet = ss.getSheetByName('transaction_history');
  if (!txSheet) {
    log('WARNING', 'transaction_history シートが見つかりません');
  } else {
    const txData    = txSheet.getDataRange().getValues();
    const txHeaders = txData[0];
    const txAsinIdx = txHeaders.indexOf('asin');
    const txTypeIdx = txHeaders.indexOf('transaction_type');
    const txDateIdx = txHeaders.indexOf('date');
    const txQtyIdx  = txHeaders.indexOf('qty');
    const txNetIdx  = txHeaders.indexOf('net');
    const txPeriodIdx = txHeaders.indexOf('period_key');

    const txRows = [];
    for (let i = 1; i < txData.length; i++) {
      if (String(txData[i][txAsinIdx] || '').trim() === DEBUG_ASIN) {
        txRows.push({
          date:   txData[i][txDateIdx],
          type:   txData[i][txTypeIdx],
          qty:    txData[i][txQtyIdx],
          net:    txData[i][txNetIdx],
          period: txData[i][txPeriodIdx],
        });
      }
    }

    log(`transaction_history ヒット（${txRows.length}件）`, txRows.slice(0, 20));

    // 期間別集計
    if (txRows.length > 0) {
      const periodSummary = {};
      txRows.forEach(r => {
        const p = String(r.period);
        if (!periodSummary[p]) periodSummary[p] = { qty: 0, net: 0, count: 0 };
        if (r.type === '注文') {
          periodSummary[p].qty   += Number(r.qty) || 0;
          periodSummary[p].net   += Number(r.net) || 0;
          periodSummary[p].count += 1;
        }
      });
      log('期間別集計', periodSummary);
    }
  }

  // ============================================
  // 5. reorder_history の原価データ確認
  // ============================================
  log('--- [5] reorder_history（原価データ） ---', '');

  const productId = lcRow ? String(lcRow[lcHeaders.indexOf('id')] || '') : '';
  const reorderSheet = ss.getSheetByName('reorder_history');

  if (!reorderSheet || !productId) {
    log('WARNING', 'reorder_history なし または product_id 未取得');
  } else {
    const reorderData    = reorderSheet.getDataRange().getValues();
    const reorderHeaders = reorderData[0];
    const rPidIdx  = reorderHeaders.indexOf('product_id');
    const rSkuIdx  = reorderHeaders.indexOf('sku');
    const rDateIdx = reorderHeaders.indexOf('order_date');
    const rCostIdx = reorderHeaders.indexOf('landed_cost_actual');
    const rQtyIdx  = reorderHeaders.indexOf('quantity');

    const reorderRows = [];
    for (let i = 1; i < reorderData.length; i++) {
      if (String(reorderData[i][rPidIdx] || '').trim() === productId) {
        reorderRows.push({
          order_date:           reorderData[i][rDateIdx],
          quantity:             reorderData[i][rQtyIdx],
          landed_cost_actual:   reorderData[i][rCostIdx],
          sku:                  reorderData[i][rSkuIdx],
        });
      }
    }

    if (reorderRows.length === 0) {
      log('WARNING', `product_id ${productId} の発注履歴なし → 粗利計算に原価が使えない`);
    } else {
      log(`reorder_history ヒット（${reorderRows.length}件）`, reorderRows);
    }
  }

  // ============================================
  // 6. sales_actual の現在値確認
  // ============================================
  log('--- [6] sales_actual（現在の蓄積値） ---', '');

  if (lcRow) {
    const saIdx = lcHeaders.indexOf('sales_actual');
    if (saIdx < 0) {
      log('WARNING', 'sales_actual 列が存在しません');
    } else {
      const rawSa = lcRow[saIdx];
      try {
        const parsed = rawSa ? JSON.parse(rawSa) : [];
        log(`sales_actual（${parsed.length}期間分）`, parsed);
      } catch(e) {
        log('ERROR', `sales_actual のJSONパース失敗: ${rawSa}`);
      }
    }
  }

  // ============================================
  // 7. フロント送信データのキー名チェック用ダミー実行
  // ============================================
  log('--- [7] キー名マッピング診断 ---', '');
  log('syncInventoryFromReport が期待するキー名', {
    'available（在庫数）': 'inv.available',
    'inbound（入荷中）':   'inv.inbound',
    '日販（7日平均）':     'inv.alertDaily ?? inv.dailyT7',  // ← ここが問題の可能性
    '在庫日数':            'inv.daysRemain',
    'アラート':            'inv.alert',
    '同期日時':            'inv.syncedAt',
  });
  log('フロント側で実際に使っているキー名を確認してください', 
    'フロントのコードで inventoryData を組み立てている箇所を検索し、\n各フィールドのキー名が上記と一致しているか確認');

  // ============================================
  // 最終サマリー
  // ============================================
  log('=== デバッグ完了 ===', `ログ行数: ${results.length}`);

  // スプレッドシートにデバッグログを出力（任意）
  writeDebugLog_(ss, results);
}

// ============================================
// product_lifecycle 旧重複レコード統合
// 1) auditLegacyLifecycleDuplicates() で候補確認（読み取り専用）
// 2) dryRunLegacyLifecycleMerge(researchId, sellingId) で差分確認
// 3) applyLegacyLifecycleMerge(researchId, sellingId, 'MERGE') で適用
// ============================================

const LEGACY_MERGE_ARCHIVE_SHEET = 'product_lifecycle_merge_archive';

function legacyMergeNormalizeTitle_(value) {
  return String(value || '').toLowerCase()
    .replace(/haksai/g, '').replace(/[\s　【】()（）・,，.。\/\\\-ー]/g, '');
}

function legacyMergeTitleScore_(a, b) {
  a = legacyMergeNormalizeTitle_(a); b = legacyMergeNormalizeTitle_(b);
  if (!a || !b) return 0;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 1;
  const grams = function(s) { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
  const aa = grams(a), bb = grams(b), counts = {};
  aa.forEach(function(x) { counts[x] = (counts[x] || 0) + 1; });
  let hit = 0; bb.forEach(function(x) { if (counts[x]) { hit++; counts[x]--; } });
  return aa.length + bb.length ? (2 * hit) / (aa.length + bb.length) : 0;
}

function legacyMergeReadCards_() {
  ensureHeaders_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues(), headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  return { sheet:sheet, headers:headers, data:data, cards:data.slice(1).filter(function(r){return r[0];}).map(function(row, i) {
    const card = rowToObject_(headers, row, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE);
    card.__row_num = i + 2; return card;
  }) };
}

function auditLegacyLifecycleDuplicates() {
  const ctx = legacyMergeReadCards_();
  const sellingRows = ctx.cards.filter(function(c) { return String(c.source || '') === 'csv_import' && c.is_deleted !== true; });
  const researchRows = ctx.cards.filter(function(c) {
    return ['csv_import','inventory_import','merged_duplicate'].indexOf(String(c.source || '')) < 0 && c.is_deleted !== true;
  });
  const results = sellingRows.map(function(selling) {
    const candidates = researchRows.map(function(research) {
      const titleScore = legacyMergeTitleScore_(selling.title, research.title);
      const categoryMatch = !!selling.category && String(selling.category) === String(research.category);
      const asinConflict = !!research.asin && String(research.asin).toUpperCase() !== String(selling.asin).toUpperCase();
      return { research_id:research.id, title:research.title, source:research.source, row:research.__row_num,
        title_score:Number(titleScore.toFixed(3)), category_match:categoryMatch, asin:research.asin || '', asin_conflict:asinConflict,
        score:Number((titleScore * 100 + (categoryMatch ? 15 : 0) - (asinConflict ? 100 : 0)).toFixed(1)) };
    }).filter(function(x) { return x.title_score >= 0.2 || x.category_match; })
      .sort(function(a,b){return b.score-a.score;}).slice(0,5);
    return { selling_id:selling.id, row:selling.__row_num, title:selling.title, asin:selling.asin || '',
      sales_periods:Array.isArray(selling.sales_actual) ? selling.sales_actual.length : 0, candidates:candidates };
  });
  Logger.log('auditLegacyLifecycleDuplicates: ' + JSON.stringify(results));
  return results;
}

function legacyMergePlan_(researchId, sellingId) {
  const ctx = legacyMergeReadCards_();
  const research = ctx.cards.find(function(c){return String(c.id)===String(researchId);});
  const selling = ctx.cards.find(function(c){return String(c.id)===String(sellingId);});
  if (!research) throw new Error('リサーチ行が見つかりません: ' + researchId);
  if (!selling) throw new Error('販売行が見つかりません: ' + sellingId);
  if (String(selling.source || '') !== 'csv_import') throw new Error('統合元は source=csv_import に限定しています。');
  if (research.is_deleted === true || selling.is_deleted === true) throw new Error('削除済み行は統合できません。');
  const sellingAsin = String(selling.asin || '').trim().toUpperCase();
  if (!sellingAsin) throw new Error('販売行にASINがありません。');
  if (research.asin && String(research.asin).toUpperCase() !== sellingAsin) throw new Error('ASINが競合しています。research=' + research.asin + ' selling=' + sellingAsin);
  const duplicates = ctx.cards.filter(function(c){return c.is_deleted!==true && String(c.asin||'').trim().toUpperCase()===sellingAsin;});
  if (duplicates.some(function(c){return c.id!==selling.id && c.id!==research.id;})) throw new Error('同じASINの第三の行があります: '+JSON.stringify(duplicates.map(function(c){return c.id;})));

  const transferFields = ['asin','gtin','amazon_url','amazon_published_date','supplier_1688_url','rakumart_linkage_status','barcode_option',
    'current_landed_cost','fba_stock','fba_inbound','fba_daily_t7','fba_days_remain','fba_alert','fba_synced_at','sales_actual'];
  const changes = {}, conflicts = [];
  transferFields.forEach(function(field) {
    const from = selling[field], to = research[field];
    const hasFrom = !(from === '' || from === null || from === undefined || (Array.isArray(from) && !from.length));
    if (!hasFrom) return;
    if (!(to === '' || to === null || to === undefined || (Array.isArray(to) && !to.length)) && JSON.stringify(to)!==JSON.stringify(from)) conflicts.push({field:field,research:to,selling:from,resolution:'sellingを採用'});
    changes[field] = from;
  });
  const oldOwn = normalizeOwnListingObject_(research.own_listing), now = new Date().toISOString();
  const periods = (Array.isArray(selling.sales_actual)?selling.sales_actual:[]).map(function(x){return String((x||{}).period||'');}).filter(function(x){return /^\d{4}-\d{2}$/.test(x);}).sort();
  const connectedAt = oldOwn.connected_at || (periods.length ? periods[0]+'-01T00:00:00+09:00' : now);
  changes.own_listing = {primary_asin:sellingAsin,parent_asin:oldOwn.parent_asin||'',child_asins:oldOwn.child_asins||[],connected_at:connectedAt,updated_at:now,keepa_status:oldOwn.keepa_status||'not_fetched',latest_snapshot_id:oldOwn.latest_snapshot_id||''};
  changes.is_launched = true; changes.is_deleted = false; changes.origin_type = 'research'; changes.updated_at = now;
  return {ctx:ctx,research:research,selling:selling,changes:changes,conflicts:conflicts,asin:sellingAsin};
}

function dryRunLegacyLifecycleMerge(researchId, sellingId) {
  const plan = legacyMergePlan_(researchId, sellingId);
  const result = {dry_run:true,research:{id:plan.research.id,row:plan.research.__row_num,title:plan.research.title,source:plan.research.source},
    selling:{id:plan.selling.id,row:plan.selling.__row_num,title:plan.selling.title,source:plan.selling.source},asin:plan.asin,
    transfer_fields:Object.keys(plan.changes),conflicts:plan.conflicts,
    selling_after:{source:'merged_duplicate',is_deleted:true,is_launched:false,asin:'',merged_into:plan.research.id}};
  Logger.log('dryRunLegacyLifecycleMerge: ' + JSON.stringify(result)); return result;
}

function debugDryRunHandbellLifecycleMerge() {
  return dryRunLegacyLifecycleMerge(
    '0b9e4cbf-e3c1-443a-b095-7fecc41ae886',
    'a5f357e8-ef7a-4bc4-b9e2-1bd53a8a701a'
  );
}

function debugApplyHandbellLifecycleMerge() {
  return applyLegacyLifecycleMerge(
    '0b9e4cbf-e3c1-443a-b095-7fecc41ae886',
    'a5f357e8-ef7a-4bc4-b9e2-1bd53a8a701a',
    'MERGE'
  );
}

function debugDryRunHeatShrinkLifecycleMerge() {
  return dryRunLegacyLifecycleMerge(
    '907e0d26-0693-4336-94e7-cf1b9ab05bef',
    '076e2846-dc69-4ef8-8789-2f3eb7413cf3'
  );
}

function debugApplyHeatShrinkLifecycleMerge() {
  return applyLegacyLifecycleMerge(
    '907e0d26-0693-4336-94e7-cf1b9ab05bef',
    '076e2846-dc69-4ef8-8789-2f3eb7413cf3',
    'MERGE'
  );
}

function legacyMergeArchiveRow_(ctx, selling, researchId) {
  const ss = getSpreadsheet_(); let sheet = ss.getSheetByName(LEGACY_MERGE_ARCHIVE_SHEET);
  const archiveHeaders = ['archived_at','merged_into_id'].concat(ctx.headers);
  if (!sheet) {
    sheet=ss.insertSheet(LEGACY_MERGE_ARCHIVE_SHEET);
    if(sheet.getMaxColumns()<archiveHeaders.length)sheet.insertColumnsAfter(sheet.getMaxColumns(),archiveHeaders.length-sheet.getMaxColumns());
    sheet.getRange(1,1,1,archiveHeaders.length).setValues([archiveHeaders]); sheet.setFrozenRows(1);
  }
  const current = sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getValues()[0].filter(String);
  if (JSON.stringify(current)!==JSON.stringify(archiveHeaders)) throw new Error(LEGACY_MERGE_ARCHIVE_SHEET+' のヘッダーが想定と異なります。');
  const original = ctx.data[selling.__row_num - 1];
  sheet.appendRow([new Date().toISOString(),researchId].concat(original));
}

function applyLegacyLifecycleMerge(researchId, sellingId, confirmation) {
  if (confirmation !== 'MERGE') throw new Error("第3引数に 'MERGE' を指定してください。先にdryRunを確認してください。");
  const lock=LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const plan=legacyMergePlan_(researchId,sellingId), ctx=plan.ctx;
    legacyMergeArchiveRow_(ctx,plan.selling,plan.research.id);
    Object.keys(plan.changes).forEach(function(k){plan.research[k]=plan.changes[k];});
    const mergedNote='[統合元 '+plan.selling.id+' / '+plan.asin+']';
    plan.research.summary=String(plan.research.summary||'')+(String(plan.research.summary||'').indexOf(mergedNote)>=0?'':'\n'+mergedNote);

    plan.selling.source='merged_duplicate'; plan.selling.origin_type='import'; plan.selling.is_deleted=true; plan.selling.is_launched=false;
    plan.selling.asin=''; plan.selling.own_listing={}; plan.selling.updated_at=new Date().toISOString();
    plan.selling.summary=String(plan.selling.summary||'')+'\n[統合済み → '+plan.research.id+' / 元ASIN '+plan.asin+']';

    const researchRow=buildRowFromHeaders_(ctx.headers,plan.research,JSON_COLS_LIFECYCLE,OBJECT_JSON_COLS_LIFECYCLE,BOOLEAN_COLS_LIFECYCLE);
    const sellingRow=buildRowFromHeaders_(ctx.headers,plan.selling,JSON_COLS_LIFECYCLE,OBJECT_JSON_COLS_LIFECYCLE,BOOLEAN_COLS_LIFECYCLE);
    ctx.sheet.getRange(plan.research.__row_num,1,1,researchRow.length).setValues([researchRow]);
    ctx.sheet.getRange(plan.selling.__row_num,1,1,sellingRow.length).setValues([sellingRow]);

    const reorder=getSpreadsheet_().getSheetByName(SHEET_REORDER_HISTORY);
    let reorderUpdated=0;
    if(reorder){const d=reorder.getDataRange().getValues(),h=d[0]||[],idx=h.indexOf('product_id');if(idx>=0){for(let i=1;i<d.length;i++){if(String(d[i][idx])===String(plan.selling.id)){reorder.getRange(i+1,idx+1).setValue(plan.research.id);reorderUpdated++;}}}}

    const project=findPageProjectByCardId_(plan.research.id);
    if(project){project.own_listing=plan.research.own_listing;if(!project.document_status)project.document_status='candidate_selected';updatePageProjectInSheet(project);}
    const result={status:'merged',research_id:plan.research.id,archived_selling_id:plan.selling.id,asin:plan.asin,reorder_rows_updated:reorderUpdated};
    Logger.log('applyLegacyLifecycleMerge: '+JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}

// デバッグ結果をシートに書き出す（ログが流れても後から確認できるように）
function writeDebugLog_(ss, results) {
  let logSheet = ss.getSheetByName('_debug_log');
  if (!logSheet) {
    logSheet = ss.insertSheet('_debug_log');
  } else {
    logSheet.clearContents();
  }

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  logSheet.getRange(1, 1).setValue(`デバッグ実行日時: ${now} / ASIN: ${DEBUG_ASIN}`);
  logSheet.getRange(1, 1).setFontWeight('bold').setBackground('#1c1c21').setFontColor('#e8d5a3');

  results.forEach((line, i) => {
    logSheet.getRange(i + 2, 1).setValue(line);
  });

  logSheet.setColumnWidth(1, 800);
  Logger.log('✅ _debug_log シートに結果を書き出しました');
}

function debugSubtitle() {
  const cards = getAllCards_ProductLifecycle();
  // ベルトだけに絞る
  const belt = cards.find(c => c.asin === 'B0FSZKJWP9');
  Logger.log('subtitle の値: [' + belt.subtitle + ']');
  Logger.log('subtitle の型: ' + typeof belt.subtitle);
}

function debugSubtitleCol() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  Logger.log('subtitle のインデックス: ' + headers.indexOf('subtitle'));
  Logger.log('全ヘッダー: ' + JSON.stringify(headers));
}

function debugSubtitleCol2() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  Logger.log('総列数: ' + data[0].length);
  Logger.log('総行数: ' + data.length);
  // B0FSZKJWP9の行
  const headers = data[0];
  const asinIdx = headers.indexOf('asin');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][asinIdx]) === 'B0FSZKJWP9') {
      Logger.log('行の列数: ' + data[i].length);
      Logger.log('インデックス44の値: [' + data[i][44] + ']');
      Logger.log('インデックス45の値: [' + data[i][45] + ']');
      break;
    }
  }
}

function debugRowToObject() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  Logger.log('getHeaders_の長さ: ' + headers.length);
  Logger.log('data[0]の長さ: ' + data[0].length);
  Logger.log('getHeaders_のsubtitle位置: ' + headers.indexOf('subtitle'));
  Logger.log('data[0]のsubtitle位置: ' + data[0].indexOf('subtitle'));
  Logger.log('getHeaders_末尾5列: ' + JSON.stringify(headers.slice(-5)));
  Logger.log('data[0]末尾5列: ' + JSON.stringify(data[0].slice(-5)));
}

function debugRowToObject2() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result'
  ];
  const boolCols = ['is_deleted', 'is_launched'];

  // B0FSZKJWP9の行を探す
  const asinIdx = headers.indexOf('asin');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][asinIdx]) === 'B0FSZKJWP9') {
      const obj = rowToObject_(headers, data[i], jsonCols, objectCols, boolCols);
      Logger.log('subtitle: [' + obj.subtitle + ']');
      Logger.log('obj keys: ' + Object.keys(obj).join(', '));
      break;
    }
  }
}

function debugGetAllCards() {
  const cards = getAllCards_ProductLifecycle();
  const belt = cards.find(c => c.asin === 'B0FSZKJWP9');
  Logger.log('subtitle: [' + belt.subtitle + ']');
  Logger.log('取得件数: ' + cards.length);
}

function debugGetAllCards2() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  Logger.log('headers.length: ' + headers.length);
  Logger.log('data行の最大列数: ' + Math.max(...data.slice(1).map(r => r.length)));
  Logger.log('headers末尾: ' + JSON.stringify(headers.slice(-3)));
  
  // filter(String)前後の比較
  const raw = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('raw length: ' + raw.length);
  Logger.log('filter後 length: ' + raw.filter(String).length);
  Logger.log('raw末尾5: ' + JSON.stringify(raw.slice(-5)));
}

function debugGetAllCards3() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result'
  ];
  const boolCols = ['is_deleted', 'is_launched'];

  const asinIdx = headers.indexOf('asin');
  const subtitleIdx = headers.indexOf('subtitle');
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][asinIdx]) === 'B0FSZKJWP9') {
      Logger.log('subtitleIdx: ' + subtitleIdx);
      Logger.log('data[i][subtitleIdx]: [' + data[i][subtitleIdx] + ']');
      Logger.log('data[i].length: ' + data[i].length);
      
      // rowToObject_を同じ引数で呼ぶ
      const obj = rowToObject_(headers, data[i], jsonCols, objectCols, boolCols);
      Logger.log('obj.subtitle: [' + obj.subtitle + ']');
      break;
    }
  }
}

function debugGetAllCards4() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_LIFECYCLE);
  
  const jsonCols = [
    'tags', 'urls', 'audit', 'produce', 'scores', 'checks',
    'image_drive_ids', 'profit', 'cost_simulation', 'page_draft',
    'actual_result', 'sales_actual'
  ];
  const objectCols = [
    'audit', 'produce', 'scores', 'checks', 'profit',
    'cost_simulation', 'page_draft', 'actual_result'
  ];
  const boolCols = ['is_deleted', 'is_launched'];

  const asinIdx = headers.indexOf('asin');

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    try {
      const obj = rowToObject_(headers, data[i], jsonCols, objectCols, boolCols);
      if (String(data[i][asinIdx]) === 'B0FSZKJWP9') {
        Logger.log('行' + i + ' subtitle: [' + obj.subtitle + ']');
      }
    } catch(e) {
      Logger.log('行' + i + ' で例外: ' + e.message + ' / asin: ' + data[i][asinIdx]);
    }
  }
}

function checkDeployedVersion() {
  const headers = REQUIRED_HEADERS_LIFECYCLE;
  Logger.log('subtitle含む: ' + headers.includes('subtitle'));
  Logger.log('sales_actual含む: ' + headers.includes('sales_actual'));
  Logger.log('配列長: ' + headers.length);
}

function backfillSubtitles() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const titleIdx    = headers.indexOf('title');
  const subtitleIdx = headers.indexOf('subtitle');
  
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][subtitleIdx]) continue; // 既にある行はスキップ
    const title = String(data[i][titleIdx] || '');
    const match = title.match(/[（(]([^）)]+)[）)]$/);
    if (match) {
      sheet.getRange(i + 1, subtitleIdx + 1).setValue(match[1]);
      count++;
    }
  }
  Logger.log(`subtitle埋め込み完了: ${count}件`);
}

function checkSources() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const sourceIdx   = headers.indexOf('source');
  const launchIdx   = headers.indexOf('is_launched');
  const subtitleIdx = headers.indexOf('subtitle');
  
  const summary = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][launchIdx]) continue;
    const src = String(data[i][sourceIdx] || 'なし');
    if (!summary[src]) summary[src] = { count: 0, subtitleEmpty: 0 };
    summary[src].count++;
    if (!data[i][subtitleIdx]) summary[src].subtitleEmpty++;
  }
  Logger.log(JSON.stringify(summary, null, 2));
}

function checkDuplicateAsins() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const asinIdx     = headers.indexOf('asin');
  const sourceIdx   = headers.indexOf('source');
  const subtitleIdx = headers.indexOf('subtitle');
  const titleIdx    = headers.indexOf('title');

  const asinMap = {};
  for (let i = 1; i < data.length; i++) {
    const asin = String(data[i][asinIdx] || '').trim();
    if (!asin) continue;
    if (!asinMap[asin]) asinMap[asin] = [];
    asinMap[asin].push({
      row:      i + 1,
      source:   data[i][sourceIdx],
      subtitle: data[i][subtitleIdx],
      title:    String(data[i][titleIdx]).slice(0, 20),
    });
  }

  // 重複しているASINだけ出力
  const duplicates = Object.entries(asinMap).filter(([, rows]) => rows.length > 1);
  Logger.log('重複ASIN数: ' + duplicates.length);
  Logger.log(JSON.stringify(duplicates.slice(0, 5), null, 2));
}

function debugHeader() {
  const sheet = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const row1 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = row1.indexOf('subtitle');
  Logger.log('subtitle のインデックス: ' + idx);
  Logger.log('44番目のヘッダー: [' + row1[44] + ']');
  Logger.log('45番目のヘッダー: [' + row1[45] + ']');
}

function testDoGet() {
  const result = doGet({ parameter: { action: 'getCards' } });
  const json = JSON.parse(result.getContent());
  const belt = json.cards.find(c => c.asin === 'B0FSZKJWP9');
  Logger.log('subtitle: [' + belt.subtitle + ']');
}

function checkCache() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('cards');
  Logger.log('キャッシュあり: ' + (cached ? 'YES' : 'NO'));
  if (cached) {
    const json = JSON.parse(cached);
    const belt = json.find(c => c.asin === 'B0FSZKJWP9');
    Logger.log('キャッシュ内のsubtitle: [' + (belt ? belt.subtitle : 'not found') + ']');
  }
}

function clearCache() {
  CacheService.getScriptCache().remove('cards');
  Logger.log('キャッシュをクリアしました');
}

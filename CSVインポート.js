function importSellingProductsFromCSV() {
  /**
   * 使い方：
   * 1. スプレッドシートに「import_csv」シートを作成
   * 2. 1行目にヘッダ、2行目以降にデータを貼り付け
   * 3. この関数を実行
   * 4. product_lifecycle に追記される
   */

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const csvSheet = ss.getSheetByName('import_csv');

  if (!csvSheet) {
    throw new Error('import_csv シートが見つかりません。シートを作成してデータを貼り付けてください。');
  }

  const data = csvSheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('データがありません（ヘッダのみ）');
    return;
  }

  const headers = data[0].map(h => String(h).trim());
  const lifecycleSheet = ss.getSheetByName(SHEET_PRODUCT_LIFECYCLE);
  const lifecycleHeaders = getHeaders_(lifecycleSheet, REQUIRED_HEADERS_LIFECYCLE);

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // title が空の行はスキップ
    const titleIdx = headers.indexOf('title');
    if (titleIdx === -1 || !row[titleIdx]) {
      skipped++;
      continue;
    }

    // CSV行をオブジェクト化
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] !== undefined ? row[idx] : '';
    });

    // product_lifecycle 用のデータを構築
    const now = new Date().toISOString();
    const cardData = {
      id: Utilities.getUuid(),
      status: 'go',
      category: obj.category || '',
      title: obj.title || '',
      summary: obj.summary || '',
      price: obj.price || '',
      monthly_sales: obj.monthly_sales || '',
      reviews: obj.reviews || '',
      emoji: obj.emoji || '📦',
      tags: [],
      supplier_keywords: '',
      weakness: '',
      created_at: now,
      updated_at: now,
      audit: {},
      produce: {},
      scores: {},
      checks: {},
      image_drive_ids: [],
      image_drive_id: '',
      urls: [],
      supplier_keywords_json: '',
      profit: {},
      cost_simulation: {},
      page_draft: {},
      asin: obj.asin || null,
      gtin: obj.gtin || null,
      amazon_url: obj.amazon_url || null,
      amazon_published_date: null,
      supplier_1688_url: obj.supplier_1688_url || null,
      rakumart_linkage_status: null,
      barcode_option: null,
      current_landed_cost: obj.current_landed_cost ? Number(obj.current_landed_cost) : null,
      actual_result: { selling_memo: obj.memo || '' },
      is_deleted: false,
      is_launched: true,  // 販売中として登録
      source: 'csv_import'
    };

    lifecycleSheet.appendRow(
      buildRowFromHeaders_(lifecycleHeaders, cardData, JSON_COLS_LIFECYCLE, OBJECT_JSON_COLS_LIFECYCLE, BOOLEAN_COLS_LIFECYCLE)
    );
    imported++;
    Logger.log('Imported: ' + cardData.title);
  }

  Logger.log('================================');
  Logger.log('Import completed: ' + imported + ' rows imported, ' + skipped + ' rows skipped');
}
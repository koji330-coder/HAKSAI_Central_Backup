// React版HAKSAI CENTRAL向け 国内仕入れ管理。
// ラクマート連携済みのreorder_historyは変更せず、国内発注は入荷確定まで別シートで保持する。

const SHEET_DOMESTIC_ORDERS = 'domestic_orders';
const REQUIRED_HEADERS_DOMESTIC_ORDERS = [
  'id', 'product_id', 'asin', 'sku', 'supplier', 'order_number', 'order_date',
  'quantity', 'input_mode', 'unit_price', 'shipping_total', 'other_cost_total',
  'landed_cost_per_unit', 'expected_arrival_date', 'actual_arrival_date', 'status',
  'notes', 'reorder_record_id', 'created_at', 'updated_at', 'cancelled_at'
];

function domesticText_(value) {
  return String(value == null ? '' : value).trim();
}

function domesticNumber_(value) {
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

function domesticDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
  return match
    ? match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0')
    : text.slice(0, 10);
}

function domesticIso_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
  return String(value);
}

function getDomesticOrderSheet_() {
  const sheet = getSheetByName_(SHEET_DOMESTIC_ORDERS, REQUIRED_HEADERS_DOMESTIC_ORDERS);
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_DOMESTIC_ORDERS);
  REQUIRED_HEADERS_DOMESTIC_ORDERS.forEach(function(header) {
    if (headers.indexOf(header) < 0) {
      sheet.getRange(1, headers.length + 1).setValue(header);
      headers.push(header);
    }
  });
  return sheet;
}

function domesticObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(function(value) { return domesticText_(value); });
  const idIndex = headers.indexOf('id');
  return values.slice(1).map(function(row, offset) {
    const object = { __rowNumber: offset + 2 };
    headers.forEach(function(header, index) { object[header] = row[index]; });
    return object;
  }).filter(function(object) { return idIndex >= 0 && domesticText_(object.id); });
}

function domesticProductIndex_() {
  const lifecycle = getSheetByName_(SHEET_PRODUCT_LIFECYCLE, REQUIRED_HEADERS_LIFECYCLE);
  const values = lifecycle.getDataRange().getValues();
  const headers = values[0] || [];
  const indexOf = function(name) { return headers.indexOf(name); };
  const byId = {};
  const byAsin = {};

  values.slice(1).forEach(function(row) {
    const id = indexOf('id') >= 0 ? domesticText_(row[indexOf('id')]) : '';
    const asin = indexOf('asin') >= 0 ? domesticText_(row[indexOf('asin')]).toUpperCase() : '';
    const deleted = indexOf('is_deleted') >= 0 && (row[indexOf('is_deleted')] === true || domesticText_(row[indexOf('is_deleted')]).toLowerCase() === 'true');
    if (!id || !asin || deleted) return;
    const product = {
      id: id,
      asin: asin,
      title: indexOf('title') >= 0 ? domesticText_(row[indexOf('title')]) || asin : asin,
      subtitle: indexOf('subtitle') >= 0 ? domesticText_(row[indexOf('subtitle')]) : '',
      emoji: indexOf('emoji') >= 0 ? domesticText_(row[indexOf('emoji')]) || '📦' : '📦',
      current_landed_cost: indexOf('current_landed_cost') >= 0 ? domesticNumber_(row[indexOf('current_landed_cost')]) : 0,
      skus: []
    };
    byId[id] = product;
    byAsin[asin] = product;
  });

  const skuSheet = getSpreadsheet_().getSheetByName(SHEET_SKU_MASTER);
  if (skuSheet && skuSheet.getLastRow() > 1) {
    const skuValues = skuSheet.getDataRange().getValues();
    const skuHeaders = skuValues[0] || [];
    const skuIndex = skuHeaders.indexOf('sku');
    const asinIndex = skuHeaders.indexOf('asin');
    skuValues.slice(1).forEach(function(row) {
      const sku = skuIndex >= 0 ? domesticText_(row[skuIndex]) : '';
      const asin = asinIndex >= 0 ? domesticText_(row[asinIndex]).toUpperCase() : '';
      if (sku && byAsin[asin] && byAsin[asin].skus.indexOf(sku) < 0) byAsin[asin].skus.push(sku);
    });
  }

  const products = Object.keys(byId).map(function(id) { return byId[id]; });
  products.sort(function(a, b) { return a.title.localeCompare(b.title, 'ja'); });
  return { byId: byId, byAsin: byAsin, products: products };
}

function normalizeDomesticOrderForClient_(row, productIndex) {
  const product = productIndex.byId[domesticText_(row.product_id)] || productIndex.byAsin[domesticText_(row.asin).toUpperCase()] || {};
  const status = domesticText_(row.status) || 'pending';
  return {
    id: domesticText_(row.id),
    product_id: domesticText_(row.product_id),
    asin: domesticText_(row.asin).toUpperCase() || product.asin || '',
    sku: domesticText_(row.sku),
    title: product.title || domesticText_(row.asin),
    subtitle: product.subtitle || '',
    emoji: product.emoji || '📦',
    supplier: domesticText_(row.supplier),
    order_number: domesticText_(row.order_number),
    order_date: domesticDate_(row.order_date),
    quantity: domesticNumber_(row.quantity),
    input_mode: domesticText_(row.input_mode) === 'direct' ? 'direct' : 'calculated',
    unit_price: domesticNumber_(row.unit_price),
    shipping_total: domesticNumber_(row.shipping_total),
    other_cost_total: domesticNumber_(row.other_cost_total),
    landed_cost_per_unit: domesticNumber_(row.landed_cost_per_unit),
    expected_arrival_date: domesticDate_(row.expected_arrival_date),
    actual_arrival_date: domesticDate_(row.actual_arrival_date),
    status: status,
    notes: domesticText_(row.notes),
    reorder_record_id: domesticText_(row.reorder_record_id),
    created_at: domesticIso_(row.created_at),
    updated_at: domesticIso_(row.updated_at),
    cancelled_at: domesticIso_(row.cancelled_at),
    source: 'domestic_manual',
    editable: status === 'pending',
    current_landed_cost: domesticNumber_(product.current_landed_cost)
  };
}

function getAllReorderRowsForReact_(productIndex) {
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(function(value) { return domesticText_(value); });
  const at = function(row, name) {
    const index = headers.indexOf(name);
    return index >= 0 ? row[index] : '';
  };
  const markerPattern = /^\[DOMESTIC:([^\]]+)\]/;

  return values.slice(1).filter(function(row) { return domesticText_(at(row, 'id')); }).map(function(row) {
    const productId = domesticText_(at(row, 'product_id'));
    const product = productIndex.byId[productId] || {};
    const notes = domesticText_(at(row, 'notes'));
    const marker = notes.match(markerPattern);
    return {
      id: domesticText_(at(row, 'id')),
      product_id: productId,
      asin: product.asin || '',
      sku: domesticText_(at(row, 'sku')),
      title: product.title || product.asin || productId,
      subtitle: product.subtitle || '',
      emoji: product.emoji || '📦',
      order_date: domesticDate_(at(row, 'order_date')),
      quantity: domesticNumber_(at(row, 'quantity')),
      unit_price_1688: domesticNumber_(at(row, 'unit_price_1688')),
      landed_cost_actual: domesticNumber_(at(row, 'landed_cost_actual')),
      lead_time_days: domesticNumber_(at(row, 'lead_time_days')),
      expected_arrival_date: domesticDate_(at(row, 'expected_arrival_date')),
      fba_fee_at_order: domesticNumber_(at(row, 'fba_fee_at_order')),
      selling_price_at_order: domesticNumber_(at(row, 'selling_price_at_order')),
      notes: notes,
      created_at: domesticIso_(at(row, 'created_at')),
      source: marker ? 'domestic_manual' : 'linked',
      domestic_order_id: marker ? marker[1] : '',
      editable: false
    };
  }).sort(function(a, b) {
    return String(b.order_date).localeCompare(String(a.order_date)) || String(b.created_at).localeCompare(String(a.created_at));
  });
}

function getReorderManagementData_() {
  const productIndex = domesticProductIndex_();
  const domesticOrders = domesticObjects_(getDomesticOrderSheet_()).map(function(row) {
    return normalizeDomesticOrderForClient_(row, productIndex);
  }).sort(function(a, b) { return String(b.order_date).localeCompare(String(a.order_date)); });
  return {
    generatedAt: new Date().toISOString(),
    products: productIndex.products,
    history: getAllReorderRowsForReact_(productIndex),
    domesticOrders: domesticOrders
  };
}

function calculateDomesticCost_(input) {
  const quantity = Math.floor(domesticNumber_(input.quantity));
  if (quantity <= 0) throw new Error('数量は1以上で入力してください。');
  const mode = domesticText_(input.input_mode) === 'direct' ? 'direct' : 'calculated';
  const unitPrice = domesticNumber_(input.unit_price);
  const shipping = Math.max(0, domesticNumber_(input.shipping_total));
  const other = Math.max(0, domesticNumber_(input.other_cost_total));
  let landed = domesticNumber_(input.landed_cost_per_unit);
  if (mode === 'calculated') {
    if (unitPrice <= 0) throw new Error('商品単価を入力してください。');
    landed = (unitPrice * quantity + shipping + other) / quantity;
  }
  if (!isFinite(landed) || landed <= 0) throw new Error('着地原価は0より大きい値が必要です。');
  return {
    quantity: quantity,
    mode: mode,
    unitPrice: Math.round(unitPrice * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    other: Math.round(other * 100) / 100,
    landed: Math.round(landed * 100) / 100
  };
}

function validateDomesticInput_(input, productIndex) {
  input = input || {};
  const productId = domesticText_(input.product_id);
  const product = productIndex.byId[productId];
  if (!product) throw new Error('商品が見つかりません。');
  const sku = domesticText_(input.sku);
  if (!sku) throw new Error('SKUを選択してください。');
  if (product.skus.length && product.skus.indexOf(sku) < 0) throw new Error('選択した商品のSKUではありません。');
  const orderDate = domesticDate_(input.order_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) throw new Error('発注日を入力してください。');
  const expectedArrivalDate = domesticDate_(input.expected_arrival_date);
  if (expectedArrivalDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedArrivalDate)) throw new Error('入荷予定日の形式が正しくありません。');
  return { product: product, productId: productId, sku: sku, orderDate: orderDate, expectedArrivalDate: expectedArrivalDate, cost: calculateDomesticCost_(input) };
}

function ensureNoDomesticDuplicate_(rows, validated, excludeId) {
  const duplicate = rows.some(function(row) {
    return domesticText_(row.id) !== domesticText_(excludeId)
      && domesticText_(row.status) !== 'cancelled'
      && domesticText_(row.sku) === validated.sku
      && domesticDate_(row.order_date) === validated.orderDate
      && domesticNumber_(row.quantity) === validated.cost.quantity;
  });
  if (duplicate) throw new Error('同一SKU・発注日・数量の国内仕入れがすでに登録されています。');
}

function domesticRowValues_(headers, object) {
  return headers.map(function(header) {
    return object[header] === undefined || object[header] === null ? '' : object[header];
  });
}

function createDomesticOrder_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const productIndex = domesticProductIndex_();
    const validated = validateDomesticInput_(input, productIndex);
    const sheet = getDomesticOrderSheet_();
    const rows = domesticObjects_(sheet);
    ensureNoDomesticDuplicate_(rows, validated, '');
    const now = new Date().toISOString();
    const object = {
      id: Utilities.getUuid(),
      product_id: validated.productId,
      asin: validated.product.asin,
      sku: validated.sku,
      supplier: domesticText_(input.supplier),
      order_number: domesticText_(input.order_number),
      order_date: validated.orderDate,
      quantity: validated.cost.quantity,
      input_mode: validated.cost.mode,
      unit_price: validated.cost.unitPrice,
      shipping_total: validated.cost.shipping,
      other_cost_total: validated.cost.other,
      landed_cost_per_unit: validated.cost.landed,
      expected_arrival_date: validated.expectedArrivalDate,
      actual_arrival_date: '',
      status: 'pending',
      notes: domesticText_(input.notes),
      reorder_record_id: '',
      created_at: now,
      updated_at: now,
      cancelled_at: ''
    };
    const headers = getHeaders_(sheet, REQUIRED_HEADERS_DOMESTIC_ORDERS);
    sheet.appendRow(domesticRowValues_(headers, object));
    return normalizeDomesticOrderForClient_(object, productIndex);
  } finally {
    lock.releaseLock();
  }
}

function updateDomesticOrder_(id, input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getDomesticOrderSheet_();
    const rows = domesticObjects_(sheet);
    const current = rows.find(function(row) { return domesticText_(row.id) === domesticText_(id); });
    if (!current) throw new Error('国内仕入れが見つかりません。');
    if (domesticText_(current.status) !== 'pending') throw new Error('未入荷の国内仕入れだけ編集できます。');
    const productIndex = domesticProductIndex_();
    const validated = validateDomesticInput_(input, productIndex);
    ensureNoDomesticDuplicate_(rows, validated, id);
    const updates = {
      product_id: validated.productId,
      asin: validated.product.asin,
      sku: validated.sku,
      supplier: domesticText_(input.supplier),
      order_number: domesticText_(input.order_number),
      order_date: validated.orderDate,
      quantity: validated.cost.quantity,
      input_mode: validated.cost.mode,
      unit_price: validated.cost.unitPrice,
      shipping_total: validated.cost.shipping,
      other_cost_total: validated.cost.other,
      landed_cost_per_unit: validated.cost.landed,
      expected_arrival_date: validated.expectedArrivalDate,
      notes: domesticText_(input.notes),
      updated_at: new Date().toISOString()
    };
    const headers = getHeaders_(sheet, REQUIRED_HEADERS_DOMESTIC_ORDERS);
    headers.forEach(function(header, index) {
      if (updates[header] !== undefined) sheet.getRange(current.__rowNumber, index + 1).setValue(updates[header]);
    });
    return normalizeDomesticOrderForClient_(Object.assign({}, current, updates), productIndex);
  } finally {
    lock.releaseLock();
  }
}

function cancelDomesticOrder_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getDomesticOrderSheet_();
    const rows = domesticObjects_(sheet);
    const current = rows.find(function(row) { return domesticText_(row.id) === domesticText_(id); });
    if (!current) throw new Error('国内仕入れが見つかりません。');
    if (domesticText_(current.status) !== 'pending') throw new Error('未入荷の国内仕入れだけ取消できます。');
    const headers = getHeaders_(sheet, REQUIRED_HEADERS_DOMESTIC_ORDERS);
    const now = new Date().toISOString();
    sheet.getRange(current.__rowNumber, headers.indexOf('status') + 1).setValue('cancelled');
    sheet.getRange(current.__rowNumber, headers.indexOf('cancelled_at') + 1).setValue(now);
    sheet.getRange(current.__rowNumber, headers.indexOf('updated_at') + 1).setValue(now);
    return { id: domesticText_(id), status: 'cancelled' };
  } finally {
    lock.releaseLock();
  }
}

function findDomesticReorderMarker_(domesticId) {
  const marker = '[DOMESTIC:' + domesticId + ']';
  const sheet = getSheetByName_(SHEET_REORDER_HISTORY, REQUIRED_HEADERS_REORDER);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return '';
  const headers = values[0].map(function(value) { return domesticText_(value); });
  const noteIndex = headers.indexOf('notes');
  const idIndex = headers.indexOf('id');
  for (let index = 1; index < values.length; index++) {
    if (domesticText_(values[index][noteIndex]).indexOf(marker) === 0) return domesticText_(values[index][idIndex]);
  }
  return '';
}

function receiveDomesticOrder_(id, actualArrivalDate) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const arrival = domesticDate_(actualArrivalDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival)) throw new Error('実際の入荷日を入力してください。');
    const sheet = getDomesticOrderSheet_();
    const rows = domesticObjects_(sheet);
    const current = rows.find(function(row) { return domesticText_(row.id) === domesticText_(id); });
    if (!current) throw new Error('国内仕入れが見つかりません。');
    if (domesticText_(current.status) === 'cancelled') throw new Error('取消済みの国内仕入れは入荷確定できません。');
    if (domesticText_(current.status) === 'arrived' && domesticText_(current.reorder_record_id)) {
      return {
        id: domesticText_(id),
        status: 'arrived',
        actual_arrival_date: domesticDate_(current.actual_arrival_date),
        reorder_record_id: domesticText_(current.reorder_record_id)
      };
    }

    let reorderId = domesticText_(current.reorder_record_id) || findDomesticReorderMarker_(id);
    if (!reorderId) {
      const noteParts = ['[DOMESTIC:' + id + ']'];
      if (domesticText_(current.supplier)) noteParts.push('仕入先:' + domesticText_(current.supplier));
      if (domesticText_(current.order_number)) noteParts.push('注文番号:' + domesticText_(current.order_number));
      if (domesticText_(current.notes)) noteParts.push(domesticText_(current.notes));
      const result = addReorderRecord(domesticText_(current.product_id), {
        sku: domesticText_(current.sku),
        order_date: arrival,
        quantity: domesticNumber_(current.quantity),
        landed_cost_actual: domesticNumber_(current.landed_cost_per_unit),
        expected_arrival_date: domesticDate_(current.expected_arrival_date),
        notes: noteParts.join(' / ')
      });
      reorderId = result.id;
    }

    const headers = getHeaders_(sheet, REQUIRED_HEADERS_DOMESTIC_ORDERS);
    const now = new Date().toISOString();
    sheet.getRange(current.__rowNumber, headers.indexOf('actual_arrival_date') + 1).setValue(arrival);
    sheet.getRange(current.__rowNumber, headers.indexOf('status') + 1).setValue('arrived');
    sheet.getRange(current.__rowNumber, headers.indexOf('reorder_record_id') + 1).setValue(reorderId);
    sheet.getRange(current.__rowNumber, headers.indexOf('updated_at') + 1).setValue(now);
    return { id: domesticText_(id), status: 'arrived', actual_arrival_date: arrival, reorder_record_id: reorderId };
  } finally {
    lock.releaseLock();
  }
}

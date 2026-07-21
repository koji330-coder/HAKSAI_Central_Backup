// Inbound plan storage for the reorder recommendation report.
// The frontend posts ASIN-level quantities from the report's "入荷待ち" column.

const SHEET_INBOUND_PLAN = 'inbound_plan';
const REQUIRED_HEADERS_INBOUND_PLAN = [
  'asin',
  'inbound_qty',
  'snapshot_date',
  'updated_at'
];

function getInboundPlanSheet_() {
  return getReportSheet_(SHEET_INBOUND_PLAN, REQUIRED_HEADERS_INBOUND_PLAN);
}

function normalizeInboundPlanDate_(snapshotDate) {
  return (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate))
    ? snapshotDate
    : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function syncInboundPlan(rows, snapshotDate) {
  rows = Array.isArray(rows) ? rows : [];
  const sheet = getInboundPlanSheet_();
  const headers = getHeaders_(sheet, REQUIRED_HEADERS_INBOUND_PLAN);

  REQUIRED_HEADERS_INBOUND_PLAN.forEach(h => {
    if (headers.indexOf(h) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
    }
  });

  const cAsin = headers.indexOf('asin');
  const cQty = headers.indexOf('inbound_qty');
  const cDate = headers.indexOf('snapshot_date');
  const cUpdated = headers.indexOf('updated_at');
  const data = sheet.getDataRange().getValues();
  const rowByAsin = {};

  for (let i = 1; i < data.length; i++) {
    const asin = String(data[i][cAsin] || '').trim();
    if (asin) rowByAsin[asin] = i + 1;
  }

  const snapDate = normalizeInboundPlanDate_(snapshotDate);
  const now = new Date().toISOString();
  const newRows = [];
  let upserted = 0;
  let removed = 0;

  rows.forEach(r => {
    const asin = String(r && r.asin || '').trim();
    if (!asin) return;

    const qty = Math.max(0, Number(r.inbound_qty || r.inboundPlan || r.qty || 0) || 0);
    const rowNum = rowByAsin[asin];

    if (qty > 0) {
      if (rowNum) {
        sheet.getRange(rowNum, cQty + 1).setValue(qty);
        sheet.getRange(rowNum, cDate + 1).setValue(snapDate);
        sheet.getRange(rowNum, cUpdated + 1).setValue(now);
      } else {
        const row = headers.map(h => {
          if (h === 'asin') return asin;
          if (h === 'inbound_qty') return qty;
          if (h === 'snapshot_date') return snapDate;
          if (h === 'updated_at') return now;
          return '';
        });
        newRows.push(row);
      }
      upserted++;
    } else if (rowNum) {
      sheet.deleteRow(rowNum);
      Object.keys(rowByAsin).forEach(key => {
        if (rowByAsin[key] > rowNum) rowByAsin[key]--;
      });
      delete rowByAsin[asin];
      removed++;
    }
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { upserted, removed };
}

function getInboundPlan() {
  const sheet = getInboundPlanSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  const headers = data[0];
  const cAsin = headers.indexOf('asin');
  const cQty = headers.indexOf('inbound_qty');
  const map = {};

  for (let i = 1; i < data.length; i++) {
    const asin = String(data[i][cAsin] || '').trim();
    const qty = Number(data[i][cQty] || 0) || 0;
    if (asin && qty > 0) map[asin] = qty;
  }

  return map;
}

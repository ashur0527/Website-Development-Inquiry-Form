const SHEET_ID = '131szyHCuTlb920N85HDwBpi7v12m3VknRcLvU2zqCi0';
const HEADERS = ['送出時間', '稱呼', '聯絡方式', '品牌名稱', '風格偏好', '網站用途', '色彩偏好', '參考與補充'];
const BUSINESS_HEADERS = ['是否已有網站', '現有網站網址', '素材使用授權', '商家簡介與品牌特色', '主要產品或服務介紹'];
const RECEIPT_KEY = 'consult_submission_id';

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    const { submissionId, values, businessValues } = readSubmission(event);

    // 寫入諮詢資料分頁，並保護同時送出的資料。
    lock.waitLock(20000);
    const sheet = getConsultSheet();
    prepareHeaders(sheet);
    // 編號保存在列的內部記錄，不佔試算表欄位。
    const receipts = getReceipts(sheet);
    const receipt = receipts.find(item => item.id === submissionId);
    const row = receipt ? receipt.row : receipts.reduce((last, item) => Math.max(last, item.row), sheet.getLastRow()) + 1;
    if (!receipt) addReceipt(sheet, row, submissionId);
    const range = sheet.getRange(row, 1, 1, HEADERS.length + BUSINESS_HEADERS.length);
    if (range.getValues()[0].every(value => value === '')) {
      const safe = value => /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
      range.setValues([[new Date(), ...values.map(safe), ...businessValues.map(safe)]]);
    }
    SpreadsheetApp.flush();
    return jsonResponse({ ok: true, submissionId });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: 'Unable to save submission' });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function getConsultSheet() {
  const sheets = SpreadsheetApp.openById(SHEET_ID).getSheets();
  const matches = sheets.filter(sheet => {
    if (sheet.getLastRow() === 0 || sheet.getMaxColumns() < HEADERS.length) return false;
    const header = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    return HEADERS.every((value, index) => value === header[index]);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0 && sheets.length === 1) return sheets[0];
  throw new Error(matches.length > 1 ? '找到多個符合格式的分頁，無法確定收件分頁。' : '找不到可辨識的諮詢資料分頁。');
}

function getReceipts(sheet) {
  return sheet.createDeveloperMetadataFinder().withKey(RECEIPT_KEY)
    .withVisibility(SpreadsheetApp.DeveloperMetadataVisibility.PROJECT)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.ROW).find()
    .map(item => ({ id: item.getValue(), row: item.getLocation().getRow().getRow() }));
}

function addReceipt(sheet, row, id) {
  const maxRows = sheet.getMaxRows();
  if (row > maxRows) sheet.insertRowsAfter(maxRows, row - maxRows);
  sheet.getRange(`${row}:${row}`)
    .addDeveloperMetadata(RECEIPT_KEY, id, SpreadsheetApp.DeveloperMetadataVisibility.PROJECT);
}

// 可在 Apps Script 手動執行，立即移除既有編號欄。
function removeSubmissionNumberColumn() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const sheet = getConsultSheet();
    prepareHeaders(sheet);
    SpreadsheetApp.flush();
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function prepareHeaders(sheet) {
  const allHeaders = [...HEADERS, ...BUSINESS_HEADERS];
  if (sheet.getLastRow() === 0) {
    ensureColumns(sheet, allHeaders.length);
    sheet.appendRow(allHeaders);
    sheet.setFrozenRows(1);
    return;
  }
  const header = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (HEADERS.some((value, index) => value !== header[index])) throw new Error('Unexpected headers');
  const businessColumn = HEADERS.length + 1;
  const extraCount = sheet.getMaxColumns() - HEADERS.length;
  const extra = extraCount > 0 ? sheet.getRange(1, businessColumn, 1, extraCount).getValues()[0] : [];
  const idOffset = extra.indexOf('提交編號');
  if (idOffset !== extra.lastIndexOf('提交編號')) throw new Error('Multiple ID columns');
  const idColumn = idOffset < 0 ? 0 : businessColumn + idOffset;
  ensureColumns(sheet, allHeaders.length + (idColumn ? 1 : 0));
  const range = sheet.getRange(1, businessColumn + (idColumn === businessColumn ? 1 : 0), 1, BUSINESS_HEADERS.length);
  const existing = range.getValues()[0];
  if (existing.some((value, index) => value !== '' && value !== BUSINESS_HEADERS[index])) {
    throw new Error('New columns contain unrelated data');
  }
  if (idColumn) {
    // 先保存舊編號，全部成功後才刪欄，保留歷史資料與重試防護。
    const lastRow = sheet.getLastRow();
    const receipts = new Map(getReceipts(sheet).map(item => [item.row, item.id]));
    if (lastRow > 1) {
      sheet.getRange(2, idColumn, lastRow - 1, 1).getValues().forEach(([id], index) => {
        if (id === '') return;
        const row = index + 2;
        if (receipts.has(row) && receipts.get(row) !== String(id)) throw new Error('Receipt conflict');
        if (!receipts.has(row)) addReceipt(sheet, row, String(id));
      });
    }
    SpreadsheetApp.flush();
    sheet.deleteColumn(idColumn);
  }
  if (existing.some(value => value === '')) {
    sheet.getRange(1, businessColumn, 1, BUSINESS_HEADERS.length).setValues([BUSINESS_HEADERS]);
  }
}

function ensureColumns(sheet, count) {
  const current = sheet.getMaxColumns();
  if (current < count) sheet.insertColumnsAfter(current, count - current);
}

function readSubmission(event) {
  const raw = event?.parameter?.payload;
  if (!raw || raw.length > 20000) throw new Error('Invalid payload');
  const data = JSON.parse(raw);
  if (!data || !/^[a-f0-9-]{36}$/i.test(data.submissionId || '')) throw new Error('Invalid ID');
  if (data.schemaVersion !== undefined && data.schemaVersion !== 2) throw new Error('Unknown schema');

  const styles = ['清爽簡約', '溫暖親切', '專業可靠', '活潑有記憶點', '高級精緻', '自然療癒'];
  const goals = ['', '介紹品牌或服務', '收集客戶詢問', '展示作品或案例', '讓客人線上預約或購買'];
  if (!Array.isArray(data.style) || data.style.length > 6 || data.style.some(value => !styles.includes(value))) {
    throw new Error('Invalid styles');
  }
  if (!goals.includes(data.goal)) throw new Error('Invalid goal');

  const text = (key, max, required = false) => {
    const value = data[key];
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new Error('Invalid field: ' + key);
    }
    return value.trim();
  };
  let businessValues = BUSINESS_HEADERS.map(() => '');
  if (data.schemaVersion === 2) {
    if (!['有', '沒有'].includes(data.hasWebsite)) throw new Error('Invalid website selection');
    if (!['同意授權', '不同意授權'].includes(data.materialsConsent)) throw new Error('Invalid consent');
    const websiteUrl = text('websiteUrl', 2000, true);
    if (data.hasWebsite === '有' && !/^https?:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/.test(websiteUrl)) {
      throw new Error('Invalid website URL');
    }
    if (data.hasWebsite === '沒有' && websiteUrl !== '無') throw new Error('Unexpected website URL');
    businessValues = [
      data.hasWebsite, websiteUrl, data.materialsConsent,
      text('businessIntro', 1000), text('services', 1000)
    ];
  }
  return {
    submissionId: data.submissionId,
    businessValues,
    values: [
      text('name', 200, true), text('contact', 500, true), text('brand', 200, data.schemaVersion === 2),
      data.style.join('、'), data.goal, text('colors', 500), text('references', 5000)
    ]
  };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

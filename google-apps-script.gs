const SHEET_ID = '131szyHCuTlb920N85HDwBpi7v12m3VknRcLvU2zqCi0';
const TARGET_TAB_ID = 5553746;
const HEADERS = ['送出時間', '稱呼', '聯絡方式', '品牌名稱', '風格偏好', '網站用途', '色彩偏好', '參考與補充', '提交編號'];
const BUSINESS_HEADERS = ['是否已有網站', '現有網站網址', '素材使用授權', '商家簡介與品牌特色', '主要產品或服務介紹'];

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    const { submissionId, values, businessValues } = readSubmission(event);

    // 寫入指定分頁，並保護同時送出的資料。
    lock.waitLock(20000);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetById(TARGET_TAB_ID);
    if (!sheet) throw new Error('Target tab is missing');
    prepareHeaders(sheet);
    // 相同提交編號只記錄一次；文字不當成公式執行。
    const rowCount = sheet.getLastRow();
    const duplicate = rowCount > 1 && sheet.getRange(2, HEADERS.length, rowCount - 1, 1)
      .createTextFinder(submissionId).matchEntireCell(true).findNext();
    if (!duplicate) {
      const safe = value => /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
      sheet.appendRow([new Date(), ...values.map(safe), submissionId, ...businessValues.map(safe)]);
      SpreadsheetApp.flush();
    }
    return jsonResponse({ ok: true, submissionId });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: 'Unable to save submission' });
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
  ensureColumns(sheet, allHeaders.length);
  const range = sheet.getRange(1, HEADERS.length + 1, 1, BUSINESS_HEADERS.length);
  const existing = range.getValues()[0];
  if (existing.some((value, index) => value !== '' && value !== BUSINESS_HEADERS[index])) {
    throw new Error('New columns contain unrelated data');
  }
  if (existing.some(value => value === '')) range.setValues([BUSINESS_HEADERS]);
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

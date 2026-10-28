const form = document.querySelector('#consultForm');
const progressBar = document.querySelector('#progressBar');
const progressText = document.querySelector('#progressText');
const resultCard = document.querySelector('#resultCard');
const resultText = document.querySelector('#resultText');
const submitButton = form.querySelector('button[type="submit"]');
const submitStatus = document.querySelector('#submitStatus');
const textFields = ['brand', 'hasWebsite', 'websiteUrl', 'materialsConsent', 'businessIntro', 'services', 'name', 'contact', 'colors'];
const websiteInput = form.elements.websiteUrl;
let previousWebsiteUrl = '';
let pendingSubmission = null;
let submitting = false;
let lastSent = '';

function getCheckedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function getValue(name) {
  return new FormData(form).get(name)?.toString().trim() || '';
}

function syncWebsiteField() {
  const noWebsite = getValue('hasWebsite') === '沒有';
  if (noWebsite && !websiteInput.readOnly) {
    previousWebsiteUrl = websiteInput.value === '無' ? '' : websiteInput.value;
    websiteInput.value = '無';
  } else if (!noWebsite && websiteInput.readOnly) {
    websiteInput.value = previousWebsiteUrl;
  }
  websiteInput.readOnly = noWebsite;
}

function updateProgress() {
  const completed = [
    getValue('brand'), getValue('hasWebsite'), getValue('websiteUrl'), getValue('materialsConsent'),
    getValue('businessIntro'), getValue('services'), getValue('name') && getValue('contact'),
    getCheckedValues('style').length || getValue('colors')
  ].filter(Boolean).length;
  progressBar.style.width = `${Math.round(completed / 8 * 100)}%`;
  progressText.textContent = `已完成 ${completed} / 8 項`;
}

function addRow(list, label, value) {
  const row = document.createElement('div');
  row.className = 'row';
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = value || '尚未填寫';
  row.append(term, detail);
  list.append(row);
}

function buildPayload() {
  const payload = Object.fromEntries(textFields.map(field => [field, getValue(field)]));
  payload.style = getCheckedValues('style');
  payload.schemaVersion = 2;
  payload.goal = '';
  // Older Google receivers retain every new answer in their existing notes column.
  payload.references = [
    ['是否已有網站', payload.hasWebsite], ['現有網站網址', payload.websiteUrl],
    ['素材使用授權', payload.materialsConsent], ['商家簡介與品牌特色', payload.businessIntro],
    ['主要產品或服務介紹', payload.services]
  ].map(([label, value]) => `${label}：${value || '未填寫'}`).join('\n');
  return payload;
}

form.addEventListener('input', updateProgress);
form.addEventListener('change', () => { syncWebsiteField(); updateProgress(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  syncWebsiteField();
  if (!form.reportValidity()) return;
  const payload = buildPayload();
  const required = ['brand', 'hasWebsite', 'websiteUrl', 'materialsConsent', 'name', 'contact'];
  const missing = required.find(field => !payload[field]);
  submitStatus.dataset.state = 'error';
  if (missing) {
    submitStatus.textContent = '請完成標示為必填的欄位，再送出諮詢。';
    form.querySelector(`[name="${missing}"]`).focus();
    return;
  }
  if (payload.hasWebsite === '有') {
    try {
      const url = new URL(payload.websiteUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid URL');
    } catch {
      submitStatus.textContent = '請提供以 https:// 或 http:// 開頭的完整網站網址。';
      websiteInput.focus();
      return;
    }
  }
  const fingerprint = JSON.stringify(payload);
  if (fingerprint === lastSent) {
    submitStatus.dataset.state = 'success';
    submitStatus.textContent = '這份諮詢已成功送出，謝謝您！';
    return;
  }
  const endpoint = window.CONSULT_CONFIG?.googleScriptUrl || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    submitStatus.textContent = '表單暫時無法送出，請稍後再試。';
    return;
  }
  if (!pendingSubmission || pendingSubmission.fingerprint !== fingerprint) {
    pendingSubmission = { fingerprint, id: crypto.randomUUID() };
  }
  const submissionId = pendingSubmission.id;
  submitting = true;
  submitButton.disabled = true;
  submitButton.textContent = '正在送出…';
  form.setAttribute('aria-busy', 'true');
  submitStatus.dataset.state = 'pending';
  submitStatus.textContent = '正在傳送您的諮詢資料…';
  resultCard.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ payload: JSON.stringify({ ...payload, submissionId }) }),
      credentials: 'omit', redirect: 'follow', signal: controller.signal
    });
    if (!response.ok) throw new Error('Request failed');
    const result = await response.json();
    if (result.ok !== true || result.submissionId !== submissionId) throw new Error('Missing save confirmation');
    lastSent = fingerprint;
    submitStatus.dataset.state = 'success';
    submitStatus.textContent = '諮詢已成功送出，我們會依照您留下的聯絡方式與您聯繫。';
    const list = document.createElement('dl');
    addRow(list, '商家名稱', payload.brand);
    addRow(list, '是否已有網站', payload.hasWebsite);
    addRow(list, '現有網站網址', payload.websiteUrl);
    addRow(list, '素材使用授權', payload.materialsConsent);
    addRow(list, '商家簡介與特色', payload.businessIntro);
    addRow(list, '產品或服務介紹', payload.services);
    addRow(list, '聯絡人資訊', [payload.name, payload.contact].join(' / '));
    addRow(list, '網站風格與色調', [payload.style.join('、'), payload.colors].filter(Boolean).join('；'));
    resultText.replaceChildren(list);
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {
    submitStatus.dataset.state = 'error';
    submitStatus.textContent = '暫時無法確認送出結果，請再試一次。已填資料會保留。';
  } finally {
    clearTimeout(timeout);
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = '送出網站諮詢';
    form.removeAttribute('aria-busy');
  }
});

syncWebsiteField();
updateProgress();

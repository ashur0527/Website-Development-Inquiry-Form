const form = document.querySelector('#consultForm');
const progressBar = document.querySelector('#progressBar');
const resultCard = document.querySelector('#resultCard');
const resultText = document.querySelector('#resultText');
const submitButton = form.querySelector('button[type="submit"]');
const submitStatus = document.querySelector('#submitStatus');
const watchedFields = ['style', 'goal', 'brand', 'colors', 'references', 'name', 'contact'];
let pendingSubmission = null;
let submitting = false;
let lastSent = '';

function getCheckedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function getValue(name) {
  return new FormData(form).get(name)?.toString().trim() || '';
}

function updateProgress() {
  const completed = watchedFields.filter(field => field === 'style'
    ? getCheckedValues(field).length > 0 : getValue(field).length > 0).length;
  progressBar.style.width = `${Math.max(14, Math.round(completed / watchedFields.length * 100))}%`;
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

form.addEventListener('input', updateProgress);
form.addEventListener('change', updateProgress);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const payload = Object.fromEntries(watchedFields.map(field => [
    field, field === 'style' ? getCheckedValues(field) : getValue(field)
  ]));
  const fingerprint = JSON.stringify(payload);
  submitStatus.dataset.state = 'error';
  if (!payload.name || !payload.contact) {
    submitStatus.textContent = '請留下稱呼與聯絡方式，讓我們可以與你討論。';
    form.elements[!payload.name ? 'name' : 'contact'].focus();
    return;
  }
  if (fingerprint === lastSent) {
    submitStatus.dataset.state = 'success';
    submitStatus.textContent = '這份諮詢已成功送出，謝謝你！';
    return;
  }
  const endpoint = window.CONSULT_CONFIG?.googleScriptUrl || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    submitStatus.textContent = '表單暫時無法送出，請稍後再試。';
    return;
  }
  // Retry the same content with the same ID after a timeout.
  if (!pendingSubmission || pendingSubmission.fingerprint !== fingerprint) {
    pendingSubmission = { fingerprint, id: crypto.randomUUID() };
  }
  const submissionId = pendingSubmission.id;
  submitting = true;
  submitButton.disabled = true;
  submitButton.textContent = '正在送出…';
  form.setAttribute('aria-busy', 'true');
  submitStatus.dataset.state = 'pending';
  submitStatus.textContent = '正在傳送你的諮詢資料…';
  resultCard.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ payload: JSON.stringify({ ...payload, submissionId }) }),
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Request failed');
    const result = await response.json();
    if (result.ok !== true || result.submissionId !== submissionId) {
      throw new Error('Missing save confirmation');
    }
    lastSent = fingerprint;
    submitStatus.dataset.state = 'success';
    submitStatus.textContent = '諮詢已成功送出，我們會依照你留下的聯絡方式與你聯繫。';
    const list = document.createElement('dl');
    addRow(list, '品牌名稱', payload.brand);
    addRow(list, '第一印象', payload.style.join('、'));
    addRow(list, '網站目標', payload.goal);
    addRow(list, '色彩偏好', payload.colors);
    addRow(list, '補充方向', payload.references);
    addRow(list, '聯絡資訊', [payload.name, payload.contact].join(' / '));
    resultText.replaceChildren(list);
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    submitStatus.dataset.state = 'error';
    submitStatus.textContent = '暫時無法確認送出結果，請再試一次。已填資料會保留。';
  } finally {
    clearTimeout(timeout);
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = '送出諮詢';
    form.removeAttribute('aria-busy');
  }
});

updateProgress();

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const legacyHeaders = ['送出時間', '稱呼', '聯絡方式', '品牌名稱', '風格偏好', '網站用途', '色彩偏好', '參考與補充', '提交編號'];
const extraHeaders = ['是否已有網站', '現有網站網址', '素材使用授權', '商家簡介與品牌特色', '主要產品或服務介紹'];

function backend(options = {}) {
  const rows = (options.rows || []).map(row => [...row]);
  let columns = options.columns || 26;
  let fail = false;
  let held = false;
  let deleted = false;
  const sheet = {
    getMaxColumns: () => columns,
    insertColumnsAfter: (after, count) => { assert.equal(after, columns); columns += count; },
    getLastRow: () => rows.length,
    appendRow: row => { if (fail) throw new Error('Write failed'); rows.push([...row]); },
    setFrozenRows() {},
    getRange: (row, column, height, width) => {
      if (column + width - 1 > columns) throw new Error('Range exceeds sheet');
      return {
        getValues: () => Array.from({ length: height }, (_, y) =>
          Array.from({ length: width }, (_, x) => rows[row - 1 + y]?.[column - 1 + x] ?? '')),
        setValues: values => {
          if (fail) throw new Error('Write failed');
          values.forEach((valuesRow, y) => {
            rows[row - 1 + y] ||= [];
            valuesRow.forEach((value, x) => { rows[row - 1 + y][column - 1 + x] = value; });
          });
        },
        createTextFinder: id => ({
          matchEntireCell: () => ({
            findNext: () => rows.slice(row - 1, row - 1 + height).find(values => values[column - 1] === id)
          })
        })
      };
    }
  };
  const lock = { waitLock: () => { held = true; }, hasLock: () => held, releaseLock: () => { held = false; } };
  const ctx = vm.createContext({
    console: { error() {} },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: {
      openById: id => {
        assert.equal(id, '131szyHCuTlb920N85HDwBpi7v12m3VknRcLvU2zqCi0');
        return {
          getSheetById: id => { assert.equal(id, 5553746); return deleted ? null : sheet; },
          insertSheet: () => { throw new Error('Unexpected new tab'); }
        };
      },
      flush() {}
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) }
  });
  vm.runInContext(fs.readFileSync('google-apps-script.gs', 'utf8'), ctx);
  return {
    rows, send: data => ctx.doPost({ parameter: { payload: JSON.stringify(data) } }),
    fail: () => { fail = true; }, locked: () => held,
    deleteTab: () => { deleted = true; }, columns: () => columns
  };
}

const legacySample = () => ({
  submissionId: randomUUID(), name: 'Test customer', contact: 'test@example.com',
  brand: '', style: [], goal: '', colors: '', references: ''
});
const sample = () => ({
  ...legacySample(), schemaVersion: 2, brand: '晨光甜點工作室',
  hasWebsite: '有', websiteUrl: 'https://example.com', materialsConsent: '同意授權',
  businessIntro: '在地食材，手工製作', services: '客製生日蛋糕與甜點禮盒',
  style: ['清爽簡約'], colors: '白色、綠色'
});

test('saves all new answers in the correct columns and acknowledges the ID', () => {
  const app = backend();
  const data = sample();
  assert.deepEqual(app.send(data), { ok: true, submissionId: data.submissionId });
  assert.deepEqual(app.rows[0], [...legacyHeaders, ...extraHeaders]);
  assert.equal(app.rows[1][3], data.brand);
  assert.equal(app.rows[1][8], data.submissionId);
  assert.deepEqual(app.rows[1].slice(9), [data.hasWebsite, data.websiteUrl, data.materialsConsent, data.businessIntro, data.services]);
  assert.equal(app.locked(), false);
});

test('declining materials authorization is retained and does not block submission', () => {
  const app = backend();
  assert.equal(app.send({ ...sample(), materialsConsent: '不同意授權' }).ok, true);
  assert.equal(app.rows[1][11], '不同意授權');
});

test('a business without a website can submit 無', () => {
  const app = backend();
  assert.equal(app.send({ ...sample(), hasWebsite: '沒有', websiteUrl: '無' }).ok, true);
  assert.equal(app.rows[1][10], '無');
});

test('legacy records remain unchanged when the five new headers are added', () => {
  const oldRow = ['old date', 'Old customer', 'old@example.com', 'Old brand', '', '', '', '', randomUUID()];
  const app = backend({ rows: [legacyHeaders, oldRow], columns: 9 });
  assert.equal(app.send(sample()).ok, true);
  assert.deepEqual(app.rows[1], oldRow);
  assert.deepEqual(app.rows[0], [...legacyHeaders, ...extraHeaders]);
  assert.equal(app.columns(), 14);
});

test('legacy clients can still submit after upgrading the receiver', () => {
  const app = backend();
  const data = legacySample();
  assert.equal(app.send(data).ok, true);
  assert.equal(app.rows[1][8], data.submissionId);
  assert.deepEqual(app.rows[1].slice(9), ['', '', '', '', '']);
});

test('existing new headers and duplicate IDs do not create extra rows', () => {
  const app = backend();
  const data = sample();
  app.send(data);
  assert.equal(app.send(data).ok, true);
  assert.equal(app.rows.length, 2);
});

test('unrelated column headers are not overwritten', () => {
  const app = backend({ rows: [[...legacyHeaders, 'Internal notes']] });
  assert.equal(app.send(sample()).ok, false);
  assert.equal(app.rows[0][9], 'Internal notes');
  assert.equal(app.rows.length, 1);
});

test('rejects missing consent, invalid URLs and overlong values before writing', () => {
  for (const extra of [
    { contact: '' }, { brand: '' }, { style: ['invalid'] }, { submissionId: 'bad' },
    { materialsConsent: '' }, { materialsConsent: 'yes' }, { hasWebsite: 'maybe' },
    { websiteUrl: 'javascript:alert(1)' }, { hasWebsite: '沒有', websiteUrl: 'https://example.com' },
    { businessIntro: 'x'.repeat(1001) }, { services: 'x'.repeat(1001) }, { schemaVersion: 3 }
  ]) {
    const app = backend();
    assert.equal(app.send({ ...sample(), ...extra }).ok, false, JSON.stringify(extra).slice(0, 100));
    assert.equal(app.rows.length, 0);
  }
});

test('formula-like values are literal in both old and new columns', () => {
  const app = backend();
  app.send({ ...sample(), brand: '=IMPORTXML("url")', contact: '+886123456789', services: '=1+1' });
  assert.equal(app.rows[1][3], "'=IMPORTXML(\"url\")");
  assert.equal(app.rows[1][2], "'+886123456789");
  assert.equal(app.rows[1][13], "'=1+1");
});

test('write failure and deleted target never acknowledge success', () => {
  const app = backend();
  app.fail();
  assert.equal(app.send(sample()).ok, false);
  assert.equal(app.locked(), false);
  const missing = backend();
  missing.deleteTab();
  assert.equal(missing.send(sample()).ok, false);
  assert.equal(missing.rows.length, 0);
});

function frontend(fetcher, endpoint = 'https://script.google.com/macros/s/test/exec') {
  const handlers = {};
  const fields = {
    style: [], brand: 'Test shop', hasWebsite: '有', websiteUrl: 'https://example.com',
    materialsConsent: '同意授權', businessIntro: '', services: '',
    colors: '', name: 'Test', contact: 'test@example.com'
  };
  const element = () => ({
    dataset: {}, style: {}, children: [], focus() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, scrollIntoView() {}
  });
  const button = element();
  const status = element();
  const card = { ...element(), hidden: true };
  const fieldElements = Object.fromEntries(Object.keys(fields).map(key => [key, element()]));
  Object.defineProperty(fieldElements.websiteUrl, 'value', {
    get: () => fields.websiteUrl, set: value => { fields.websiteUrl = value; }
  });
  const form = {
    querySelector: selector => selector.startsWith('button') ? button : fieldElements[selector.match(/name="([^"]+)"/)[1]],
    querySelectorAll: () => fields.style.map(value => ({ value })),
    addEventListener: (type, handler) => { handlers[type] = handler; },
    elements: fieldElements, reportValidity: () => true,
    setAttribute() {}, removeAttribute() {}
  };
  const nodes = {
    '#consultForm': form, '#progressBar': element(), '#progressText': element(),
    '#resultCard': card, '#resultText': element(), '#submitStatus': status
  };
  const ctx = vm.createContext({
    document: { querySelector: key => nodes[key], createElement: element },
    window: { CONSULT_CONFIG: { googleScriptUrl: endpoint } },
    FormData: class { get(key) { return fields[key]; } },
    crypto: { randomUUID }, fetch: fetcher, AbortController, URLSearchParams, URL, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync('dist/script.js', 'utf8'), ctx);
  return {
    fields, status, button, card, fieldElements, nodes,
    change: () => handlers.change(), submit: () => handlers.submit({ preventDefault() {} })
  };
}

const acknowledge = async (_url, options) => ({
  ok: true, json: async () => ({ ok: true, submissionId: JSON.parse(options.body.get('payload')).submissionId })
});

test('unconfigured form never sends or claims success', async () => {
  const ui = frontend(() => { throw new Error('must not send'); }, '');
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.card.hidden, true);
});

test('successful submission renders all eight questions in the summary', async () => {
  const ui = frontend(acknowledge);
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'success');
  assert.equal(ui.card.hidden, false);
  assert.equal(ui.nodes['#resultText'].children[0].children.length, 8);
  assert.equal(ui.button.disabled, false);
});

test('no-website selection fills 無 and switching back restores the previous URL', () => {
  const ui = frontend(acknowledge);
  ui.fields.hasWebsite = '沒有';
  ui.change();
  assert.equal(ui.fields.websiteUrl, '無');
  assert.equal(ui.fieldElements.websiteUrl.readOnly, true);
  ui.fields.hasWebsite = '有';
  ui.change();
  assert.equal(ui.fields.websiteUrl, 'https://example.com');
  assert.equal(ui.fieldElements.websiteUrl.readOnly, false);
});

test('consent is required but may be explicitly declined', async () => {
  let calls = 0;
  const ui = frontend(async (...args) => { calls++; return acknowledge(...args); });
  ui.fields.materialsConsent = '';
  await ui.submit();
  assert.equal(calls, 0);
  ui.fields.materialsConsent = '不同意授權';
  await ui.submit();
  assert.equal(calls, 1);
  assert.equal(ui.status.dataset.state, 'success');
});

test('a website must use HTTP or HTTPS', async () => {
  let calls = 0;
  const ui = frontend(async () => { calls++; });
  ui.fields.websiteUrl = 'javascript:alert(1)';
  await ui.submit();
  assert.equal(calls, 0);
  assert.equal(ui.status.dataset.state, 'error');
});

test('new answers are also included in notes for legacy Google receivers', async () => {
  let payload;
  const ui = frontend(async (url, options) => {
    payload = JSON.parse(options.body.get('payload'));
    return acknowledge(url, options);
  });
  ui.fields.businessIntro = 'x'.repeat(1000);
  ui.fields.services = 'y'.repeat(1000);
  ui.fields.websiteUrl = 'https://example.com/?q=' + 'z'.repeat(1970);
  ui.fields.materialsConsent = '不同意授權';
  await ui.submit();
  assert.equal(payload.schemaVersion, 2);
  assert.ok(payload.references.includes('不同意授權'));
  assert.ok(payload.references.includes(ui.fields.businessIntro));
  assert.ok(payload.references.includes(ui.fields.services));
  assert.ok(payload.references.includes(ui.fields.websiteUrl));
  assert.ok(payload.references.length <= 5000);
});

test('network failure preserves all new answers and reuses the same retry ID', async () => {
  const ids = [];
  const ui = frontend(async (_url, options) => {
    ids.push(JSON.parse(options.body.get('payload')).submissionId);
    throw new Error('Network failed');
  });
  ui.fields.services = '商業攝影';
  await ui.submit();
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.fields.services, '商業攝影');
  assert.equal(ids[0], ids[1]);
  assert.equal(ui.button.disabled, false);
});

test('invalid acknowledgement never displays a success summary', async () => {
  const ui = frontend(async () => ({ ok: true, json: async () => ({ ok: true, submissionId: 'wrong' }) }));
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.card.hidden, true);
});

test('a second click while pending cannot submit twice', async () => {
  let resolve;
  let calls = 0;
  const ui = frontend((_url, options) => {
    calls++;
    const id = JSON.parse(options.body.get('payload')).submissionId;
    return new Promise(done => { resolve = () => done({ ok: true, json: async () => ({ ok: true, submissionId: id }) }); });
  });
  const first = ui.submit();
  await ui.submit();
  assert.equal(calls, 1);
  resolve();
  await first;
});

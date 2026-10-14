const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function backend(options = {}) {
  const rows = [];
  let fail = false;
  let held = false;
  let tabName = options.tabName || '網站諮詢';
  let deleted = false;
  const sheet = {
    getSheetId: () => 5553746,
    getMaxColumns: () => 26,
    getLastRow: () => rows.length,
    appendRow: row => { if (fail) throw new Error('Write failed'); rows.push([...row]); },
    setFrozenRows() {},
    getRange: () => ({
      getValues: () => [rows[0]],
      createTextFinder: id => ({ matchEntireCell: () => ({ findNext: () => rows.find(row => row[8] === id) }) })
    })
  };
  const lock = { waitLock: () => { held = true; }, hasLock: () => held, releaseLock: () => { held = false; } };
  const ctx = vm.createContext({
    console: { error() {} },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: {
      openById: id => {
        assert.equal(id, '131szyHCuTlb920N85HDwBpi7v12m3VknRcLvU2zqCi0');
        return {
          getSheetByName: name => !deleted && name === tabName ? sheet : null,
          getSheetById: id => {
            assert.equal(id, 5553746);
            return deleted ? null : sheet;
          },
          getSheets: () => deleted ? [] : [sheet],
          insertSheet: () => { throw new Error('Unexpected new tab'); }
        };
      },
      flush() {}
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) }
  });
  vm.runInContext(fs.readFileSync('google-apps-script.gs', 'utf8'), ctx);
  return {
    rows,
    send: data => ctx.doPost({ parameter: { payload: JSON.stringify(data) } }),
    fail: () => { fail = true; }, locked: () => held,
    rename: name => { tabName = name; },
    deleteTab: () => { deleted = true; }
  };
}

const sample = () => ({ submissionId: randomUUID(), name: 'Test customer', contact: 'test@example.com', brand: '', style: [], goal: '', colors: '', references: '' });

test('writes one complete row and acknowledges the matching ID', () => {
  const app = backend();
  const data = sample();
  assert.deepEqual(app.send(data), { ok: true, submissionId: data.submissionId });
  assert.equal(app.rows.length, 2);
  assert.equal(app.rows[1][1], data.name);
  assert.equal(app.rows[1][2], data.contact);
  assert.equal(app.locked(), false);
});
test('retries do not append another row', () => {
  const app = backend();
  const data = sample();
  app.send(data);
  assert.equal(app.send(data).ok, true);
  assert.equal(app.rows.length, 2);
});
test('rejects invalid and missing fields before writing', () => {
  for (const extra of [{ contact: '' }, { style: ['invalid'] }, { references: 'x'.repeat(5001) }, { submissionId: 'bad' }]) {
    const app = backend();
    assert.equal(app.send({ ...sample(), ...extra }).ok, false);
    assert.equal(app.rows.length, 0);
  }
});
test('formula input is saved as literal text', () => {
  const app = backend();
  app.send({ ...sample(), brand: '=IMPORTXML("url")', contact: '+886123456789' });
  assert.equal(app.rows[1][3], "'=IMPORTXML(\"url\")");
  assert.equal(app.rows[1][2], "'+886123456789");
});
test('write failure never acknowledges success and releases the lock', () => {
  const app = backend();
  app.fail();
  assert.equal(app.send(sample()).ok, false);
  assert.equal(app.locked(), false);
});

test('renaming the fixed target tab keeps writing into the same tab', () => {
  const app = backend();
  assert.equal(app.send(sample()).ok, true);
  app.rename('客戶網站需求');
  assert.equal(app.send(sample()).ok, true);
  assert.equal(app.rows.length, 3);
});
test('an existing renamed target accepts new submissions', () => {
  const app = backend({ tabName: '新的分頁名稱' });
  app.rows.push(['送出時間', '稱呼', '聯絡方式', '品牌名稱', '風格偏好', '網站用途', '色彩偏好', '參考與補充', '提交編號']);
  assert.equal(app.send(sample()).ok, true);
  assert.equal(app.rows.length, 2);
});
test('deleted bound tab fails without creating a replacement', () => {
  const app = backend();
  app.send(sample());
  app.deleteTab();
  assert.equal(app.send(sample()).ok, false);
  assert.equal(app.rows.length, 2);
  assert.equal(app.locked(), false);
});
test('an empty renamed target is initialized without creating a tab', () => {
  const app = backend({ tabName: '客戶需求' });
  assert.equal(app.send(sample()).ok, true);
  assert.equal(app.rows.length, 2);
});

function frontend(fetcher, endpoint = 'https://script.google.com/macros/s/test/exec') {
  const handlers = {};
  const fields = { style: [], goal: '', brand: '', colors: '', references: '', name: 'Test', contact: 'test@example.com' };
  const element = () => ({ dataset: {}, style: {}, append() {}, replaceChildren() {}, scrollIntoView() {} });
  const button = element();
  const status = element();
  const card = { ...element(), hidden: true };
  const form = {
    querySelector: () => button,
    querySelectorAll: () => fields.style.map(value => ({ value })),
    addEventListener: (type, handler) => { handlers[type] = handler; },
    elements: { name: { focus() {} }, contact: { focus() {} } },
    setAttribute() {}, removeAttribute() {}
  };
  const nodes = { '#consultForm': form, '#progressBar': element(), '#resultCard': card, '#resultText': element(), '#submitStatus': status };
  const ctx = vm.createContext({
    document: { querySelector: key => nodes[key], createElement: element },
    window: { CONSULT_CONFIG: { googleScriptUrl: endpoint } },
    FormData: class { get(key) { return fields[key]; } },
    crypto: { randomUUID }, fetch: fetcher, AbortController, URLSearchParams, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync('dist/script.js', 'utf8'), ctx);
  return { fields, status, button, card, submit: () => handlers.submit({ preventDefault() {} }) };
}

test('unconfigured form does not send or claim success', async () => {
  const ui = frontend(() => { throw new Error('must not send'); }, '');
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.card.hidden, true);
});
test('only matching server confirmation shows success', async () => {
  const ui = frontend(async (_url, options) => ({ ok: true, json: async () => ({ ok: true, submissionId: JSON.parse(options.body.get('payload')).submissionId }) }));
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'success');
  assert.equal(ui.card.hidden, false);
  assert.equal(ui.button.disabled, false);
});
test('network failure preserves data and retry ID', async () => {
  const ids = [];
  const ui = frontend(async (_url, options) => {
    ids.push(JSON.parse(options.body.get('payload')).submissionId);
    throw new Error('Network failed');
  });
  await ui.submit();
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.fields.contact, 'test@example.com');
  assert.equal(ids[0], ids[1]);
  assert.equal(ui.button.disabled, false);
});
test('invalid acknowledgement does not show success', async () => {
  const ui = frontend(async () => ({ ok: true, json: async () => ({ ok: true, submissionId: 'wrong' }) }));
  await ui.submit();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.card.hidden, true);
});

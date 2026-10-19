// 成果物を機械的に検証するスクリプト
// 使い方: node tools/verify.js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const failures = [];
let passed = 0;

// 1 件のチェックを実行し、結果を記録する
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${String(e.message).split('\n')[0]}`);
  }
}

// --- 必須ファイルの存在確認 ---
const required = [
  'index.html', 'style.css', 'app.js', 'lib/parsers.js', 'test/parsers.test.js',
  'samples/sample.csv', 'samples/sample.json', 'samples/sample.jsonl',
];
for (const f of required) {
  check(`exists ${f}`, () => assert.ok(fs.existsSync(path.join(root, f)), 'missing'));
}

// --- ソースの静的チェック ---
const sources = ['index.html', 'style.css', 'app.js', 'lib/parsers.js', 'test/parsers.test.js']
  .filter((f) => fs.existsSync(path.join(root, f)))
  .map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]);

for (const [f, src] of sources) {
  check(`no external url in ${f}`, () => assert.ok(!/https?:\/\//.test(src), 'contains http(s) URL'));
  check(`no cat language in ${f}`, () => assert.ok(!/にゃ|ニャ|ご主人/.test(src), 'contains cat language'));
  if (f !== 'test/parsers.test.js') {
    check(`no ES module syntax in ${f}`, () => {
      assert.ok(!/type\s*=\s*["']module["']/.test(src), 'type=module');
      assert.ok(!/^\s*(import|export)\s/m.test(src), 'import/export');
    });
  }
  check(`no alert in ${f}`, () => assert.ok(!/\balert\s*\(/.test(src), 'alert('));
}

const html = sources.find(([f]) => f === 'index.html')?.[1] ?? '';
check('index.html loads parsers before app', () => {
  const p = html.indexOf('lib/parsers.js');
  const a = html.indexOf('app.js');
  assert.ok(p >= 0 && a >= 0 && p < a);
});
check('index.html links style.css', () => assert.ok(html.includes('style.css')));

// --- parsers.js の動作チェック ---
let P = null;
check('require lib/parsers.js', () => {
  P = require(path.join(root, 'lib/parsers.js'));
  for (const fn of ['parseCSV', 'compareValues', 'sortRows', 'parseJSONL', 'detectType', 'decodeBytes']) {
    assert.equal(typeof P[fn], 'function', `${fn} is not exported`);
  }
});

if (P) {
  check('csv basic', () => {
    assert.deepEqual(P.parseCSV('a,b\n1,2\n3,4\n'), { headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] });
  });
  check('csv empty', () => assert.deepEqual(P.parseCSV(''), { headers: [], rows: [] }));
  check('csv quoted comma/newline/escape', () => {
    const r = P.parseCSV('name,note\r\n"Sato, Taro","line1\r\nline2"\r\n"say ""hi""",x\r\n');
    assert.deepEqual(r.headers, ['name', 'note']);
    assert.deepEqual(r.rows, [['Sato, Taro', 'line1\r\nline2'], ['say "hi"', 'x']]);
  });
  check('csv quoted LF newline kept', () => {
    assert.deepEqual(P.parseCSV('a\n"x\ny"\n').rows, [['x\ny']]);
  });
  check('csv BOM', () => assert.deepEqual(P.parseCSV('﻿a,b\n1,2').headers, ['a', 'b']));
  check('csv CR only newline', () => assert.deepEqual(P.parseCSV('a,b\r1,2\r3,4').rows, [['1', '2'], ['3', '4']]));
  check('csv no trailing newline / blank lines', () => {
    assert.deepEqual(P.parseCSV('a,b\n1,2\n\n3,4\n\n\n').rows, [['1', '2'], ['3', '4']]);
  });
  check('csv short row padded', () => assert.deepEqual(P.parseCSV('a,b,c\n1\n').rows, [['1', '', '']]));
  check('csv long row extends headers', () => {
    const r = P.parseCSV('a,b\n1,2,3,4\n5,6\n');
    assert.deepEqual(r.headers, ['a', 'b', 'col3', 'col4']);
    assert.deepEqual(r.rows, [['1', '2', '3', '4'], ['5', '6', '', '']]);
  });
  check('csv empty header name', () => assert.deepEqual(P.parseCSV('a,,c\n1,2,3').headers, ['a', 'col2', 'c']));
  check('csv empty fields', () => assert.deepEqual(P.parseCSV('a,b,c\n,,\n1,,3').rows.at(-1), ['1', '', '3']));
  check('csv tab autodetect', () => {
    assert.deepEqual(P.parseCSV('a\tb\n1,5\t2\n'), { headers: ['a', 'b'], rows: [['1,5', '2']] });
  });
  check('csv semicolon autodetect', () => assert.deepEqual(P.parseCSV('a;b\n1;2').rows, [['1', '2']]));
  check('csv delimiter ignores quoted header', () => {
    assert.deepEqual(P.parseCSV('"x;y;z",b\n1,2').headers, ['x;y;z', 'b']);
  });
  check('csv explicit delimiter', () => assert.deepEqual(P.parseCSV('a|b\n1|2', '|').rows, [['1', '2']]));
  check('csv japanese', () => assert.deepEqual(P.parseCSV('名前,住所\n山田,"東京都,港区"').rows, [['山田', '東京都,港区']]));
  check('csv large', () => {
    const lines = ['id,v'];
    for (let i = 0; i < 200000; i++) lines.push(`${i},"v,${i}"`);
    const t0 = Date.now();
    const r = P.parseCSV(lines.join('\n'));
    assert.equal(r.rows.length, 200000);
    assert.deepEqual(r.rows[199999], ['199999', 'v,199999']);
    assert.ok(Date.now() - t0 < 5000, 'too slow');
  });

  check('compare numeric', () => {
    assert.ok(P.compareValues('2', '10') < 0);
    assert.ok(P.compareValues(' 3.5 ', '-1') > 0);
    assert.ok(P.compareValues('1e3', '999') > 0);
    assert.equal(P.compareValues('7', '7.0'), 0);
  });
  check('compare number before text', () => {
    assert.ok(P.compareValues('100', 'abc') < 0);
    assert.ok(P.compareValues('abc', '100') > 0);
    assert.ok(P.compareValues('1,234', '5') > 0);
  });
  check('compare empty last', () => {
    assert.ok(P.compareValues('', 'a') > 0);
    assert.ok(P.compareValues('5', '  ') < 0);
    assert.equal(P.compareValues('', ' '), 0);
  });
  check('compare text natural', () => assert.ok(P.compareValues('item2', 'item10') < 0));

  check('sortRows asc/desc/empty last/immutable/stable', () => {
    const rows = [['b', '2'], ['', '9'], ['a', '10'], ['c', ''], ['a', '1']];
    const copy = JSON.parse(JSON.stringify(rows));
    assert.deepEqual(P.sortRows(rows, 1, 'asc').map((r) => r[1]), ['1', '2', '9', '10', '']);
    assert.deepEqual(P.sortRows(rows, 1, 'desc').map((r) => r[1]), ['10', '9', '2', '1', '']);
    assert.deepEqual(P.sortRows(rows, 0, 'asc'), [['a', '10'], ['a', '1'], ['b', '2'], ['c', ''], ['', '9']]);
    assert.deepEqual(P.sortRows(rows, 0, 'desc'), [['c', ''], ['b', '2'], ['a', '10'], ['a', '1'], ['', '9']]);
    assert.deepEqual(rows, copy);
  });

  check('jsonl basic + limit + truncated', () => {
    const text = Array.from({ length: 15 }, (_, i) => JSON.stringify({ i })).join('\n');
    const r = P.parseJSONL(text);
    assert.equal(r.items.length, 10);
    assert.equal(r.truncated, true);
    assert.deepEqual(r.items[9], { line: 10, value: { i: 9 } });
    assert.equal(P.parseJSONL(text, 3).items.length, 3);
    assert.equal(P.parseJSONL(text, 15).truncated, false);
    assert.equal(P.parseJSONL(text + '\n\n', 15).truncated, false);
  });
  check('jsonl blank lines / line numbers / errors / BOM / CRLF', () => {
    const r = P.parseJSONL('﻿{"a":1}\r\n\r\n   \r\n{bad}\r\n[1,2]\r\n');
    assert.equal(r.items.length, 3);
    assert.equal(r.truncated, false);
    assert.deepEqual(r.items[0], { line: 1, value: { a: 1 } });
    assert.equal(r.items[1].line, 4);
    assert.equal(typeof r.items[1].error, 'string');
    assert.equal(r.items[1].raw.trim(), '{bad}');
    assert.ok(!('value' in r.items[1]));
    assert.deepEqual(r.items[2], { line: 5, value: [1, 2] });
  });
  check('jsonl null value', () => assert.deepEqual(P.parseJSONL('null\n').items, [{ line: 1, value: null }]));
  check('jsonl empty', () => assert.deepEqual(P.parseJSONL(''), { items: [], truncated: false }));

  check('detectType by extension', () => {
    assert.equal(P.detectType('a.CSV', ''), 'csv');
    assert.equal(P.detectType('a.tsv', ''), 'csv');
    assert.equal(P.detectType('a.json', '{"a":1}'), 'json');
    assert.equal(P.detectType('a.jsonl', '{"a":1}'), 'jsonl');
    assert.equal(P.detectType('a.NDJSON', '{"a":1}'), 'jsonl');
  });
  check('detectType by content', () => {
    assert.equal(P.detectType('data.txt', '{\n "a": [1,2]\n}'), 'json');
    assert.equal(P.detectType('data', '{"a":1}\n{"a":2}\n'), 'jsonl');
    assert.equal(P.detectType('data.txt', 'a,b\n1,2\n'), 'csv');
    assert.equal(P.detectType('data.txt', '1\n2\n3\n'), 'csv');
  });
  check('detectType .json containing jsonl', () => {
    assert.equal(P.detectType('x.json', '{"a":1}\n{"a":2}\n'), 'jsonl');
    assert.equal(P.detectType('x.json', '{"a":'), 'json');
  });

  check('decodeBytes utf8 / bom / sjis', () => {
    assert.equal(P.decodeBytes(new Uint8Array(Buffer.from('日本語,abc', 'utf8'))), '日本語,abc');
    assert.equal(P.decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a');
    // Shift_JIS の「日本語」
    assert.equal(P.decodeBytes(new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea])), '日本語');
  });

  // --- サンプルファイルのチェック ---
  check('sample.csv parses', () => {
    const r = P.parseCSV(fs.readFileSync(path.join(root, 'samples/sample.csv'), 'utf8'));
    assert.ok(r.headers.length >= 3 && r.rows.length >= 10);
  });
  check('sample.json parses', () => JSON.parse(fs.readFileSync(path.join(root, 'samples/sample.json'), 'utf8')));
  check('sample.jsonl has >=15 lines and a broken line', () => {
    const r = P.parseJSONL(fs.readFileSync(path.join(root, 'samples/sample.jsonl'), 'utf8'), 1000);
    assert.ok(r.items.length >= 15);
    assert.ok(r.items.some((it) => 'error' in it));
  });
}

// --- 結果の出力 ---
console.log(`checks passed: ${passed}, failed: ${failures.length}`);
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(failures.length === 0 ? 'VERIFY: PASS' : 'VERIFY: FAIL');
process.exit(failures.length === 0 ? 0 : 1);

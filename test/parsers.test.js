'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCSV,
  compareValues,
  sortRows,
  parseJSONL,
  detectType,
  detectTextType,
  decodeBytes,
} = require('../lib/parsers.js');

// CSV の基本構造、BOM、空入力、空ヘッダを検証します。
test('parseCSV は基本構造とヘッダを処理する', () => {
  assert.deepEqual(parseCSV('\ufeffa,,c\n1,2,3'), {
    headers: ['a', 'col2', 'c'],
    rows: [['1', '2', '3']],
  });
  assert.deepEqual(parseCSV(''), { headers: [], rows: [] });
});

// 引用符内の区切り、改行、二重引用符を検証します。
test('parseCSV は RFC 4180 の引用フィールドを処理する', () => {
  const result = parseCSV('name,note\r\n"A,B","x\r\ny"\r\n"say ""ok""",z');
  assert.deepEqual(result.rows, [['A,B', 'x\r\ny'], ['say "ok"', 'z']]);
  assert.deepEqual(parseCSV('a\n"x\ny"').rows, [['x\ny']]);
});

// LF、CRLF、CR と空行の扱いを検証します。
test('parseCSV は各改行形式を受け付け完全な空行を無視する', () => {
  assert.deepEqual(parseCSV('a,b\r1,2\r\r3,4\r').rows, [['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCSV('a,b\n1,2\n\n3,4\n\n').rows, [['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCSV('a,b\r\n1,2\r\n').rows, [['1', '2']]);
});

// 不ぞろいな列数の補完と拡張を検証します。
test('parseCSV は行を最大列数にそろえる', () => {
  const result = parseCSV('a,b\n1\n2,3,4');
  assert.deepEqual(result.headers, ['a', 'b', 'col3']);
  assert.deepEqual(result.rows, [['1', '', ''], ['2', '3', '4']]);
  assert.deepEqual(parseCSV('a,b,c\n,,').rows, [['', '', '']]);
});

// 自動判定、同数時のカンマ優先、明示指定を検証します。
test('parseCSV は区切り文字を判定または明示指定する', () => {
  assert.deepEqual(parseCSV('a\tb\n1,5\t2').rows, [['1,5', '2']]);
  assert.deepEqual(parseCSV('a;b\n1;2').rows, [['1', '2']]);
  assert.deepEqual(parseCSV('"x;y;y",b\n1,2').headers, ['x;y;y', 'b']);
  assert.deepEqual(parseCSV('a;b,c\n1;2,3').headers, ['a;b', 'c']);
  assert.deepEqual(parseCSV('a|b\n1|2', '|').rows, [['1', '2']]);
});

// 数値、文字列、空文字の比較順を検証します。
test('compareValues は仕様どおり値を比較する', () => {
  assert.ok(compareValues(' 2 ', '10') < 0);
  assert.equal(compareValues('7', '7.0'), 0);
  assert.ok(compareValues('1e3', '999') > 0);
  assert.ok(compareValues('5', 'text') < 0);
  assert.ok(compareValues('1,234', '5') > 0);
  assert.ok(compareValues('', 'a') > 0);
  assert.equal(compareValues(' ', ''), 0);
  assert.ok(compareValues('item2', 'item10') < 0);
});

// 安定性、不変性、降順でも空文字が末尾になることを検証します。
test('sortRows は安定かつ非破壊で空文字を末尾に置く', () => {
  const rows = [['a', '2'], ['b', ''], ['c', '10'], ['d', '2'], ['e', '1']];
  const original = rows.map((row) => row.slice());
  assert.deepEqual(sortRows(rows, 1, 'asc').map((row) => row[0]), ['e', 'a', 'd', 'c', 'b']);
  assert.deepEqual(sortRows(rows, 1, 'desc').map((row) => row[0]), ['c', 'a', 'd', 'e', 'b']);
  assert.deepEqual(rows, original);
});

// JSON Lines の既定上限、任意上限、打ち切り判定を検証します。
test('parseJSONL は非空行を上限まで解析する', () => {
  const text = Array.from({ length: 15 }, (_, index) => JSON.stringify({ index })).join('\n');
  assert.equal(parseJSONL(text).items.length, 10);
  assert.equal(parseJSONL(text).truncated, true);
  assert.deepEqual(parseJSONL(text, 2).items[1], { line: 2, value: { index: 1 } });
  assert.equal(parseJSONL(text, 15).truncated, false);
});

// 空行を含む行番号、BOM、解析エラー、null を検証します。
test('parseJSONL は行番号とエラーを保持して処理を続ける', () => {
  const result = parseJSONL('\ufeff{"a":1}\r\n\r\n  \r\n{bad}\r\nnull\r\n');
  assert.deepEqual(result.items[0], { line: 1, value: { a: 1 } });
  assert.equal(result.items[1].line, 4);
  assert.equal(result.items[1].raw, '{bad}');
  assert.equal(typeof result.items[1].error, 'string');
  assert.deepEqual(result.items[2], { line: 5, value: null });
  assert.deepEqual(parseJSONL(''), { items: [], truncated: false });
});

// 拡張子による種別判定を検証します。
test('detectType は拡張子を大文字小文字を無視して判定する', () => {
  assert.equal(detectType('a.CSV', '{}'), 'csv');
  assert.equal(detectType('a.tsv', '{}'), 'csv');
  assert.equal(detectType('a.JSON', '{"a":1}'), 'json');
  assert.equal(detectType('a.JSONL', 'x'), 'jsonl');
  assert.equal(detectType('a.ndjson', 'x'), 'jsonl');
});

// 内容および JSON 拡張子の例外規則による判定を検証します。
test('detectType は内容から JSON、JSONL、CSV を判定する', () => {
  assert.equal(detectType('data.txt', '{\n"a":1\n}'), 'json');
  assert.equal(detectType('data', '{"a":1}\n{"a":2}'), 'jsonl');
  assert.equal(detectType('data', '1\n2'), 'csv');
  assert.equal(detectType('data', 'a,b\n1,2'), 'csv');
  assert.equal(detectType('bad.json', '{"a":1}\n{"a":2}'), 'jsonl');
  assert.equal(detectType('bad.json', '{bad}'), 'json');
});

// 貼り付けテキストの内容による判定と、壊れた JSON の扱いを検証します。
test('detectTextType は貼り付けテキストの種別を判定する', () => {
  assert.equal(detectTextType('{\n  "a": [1, 2]\n}'), 'json');
  assert.equal(detectTextType('{"a":1}\n{"a":2}\n'), 'jsonl');
  assert.equal(detectTextType('a,b\n1,2\n'), 'csv');
  assert.equal(detectTextType('a\tb\n1\t2\n'), 'csv');
  assert.equal(detectTextType('﻿\n  {\n  "a": 1,\n}'), 'json');
  assert.equal(detectTextType('[1, 2,'), 'json');
  assert.equal(detectTextType(''), 'csv');
});

// UTF-8、UTF-8 BOM、Shift_JIS の復号を検証します。
test('decodeBytes は UTF-8 を優先し Shift_JIS にフォールバックする', () => {
  assert.equal(decodeBytes(new Uint8Array(Buffer.from('日本語', 'utf8'))), '日本語');
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a');
  assert.equal(decodeBytes(new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea])), '日本語');
});

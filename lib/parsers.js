(function (root) {
  'use strict';

  // 先頭の BOM を除去します。入力は文字列、出力は BOM 除去後の文字列です。
  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // 先頭レコードにある候補区切り文字を数えます。入力は CSV 文字列、出力は区切り文字です。
  function detectDelimiter(text) {
    const counts = { ',': 0, '\t': 0, ';': 0 };
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') {
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && (character === '\r' || character === '\n')) {
        break;
      } else if (!quoted && Object.prototype.hasOwnProperty.call(counts, character)) {
        counts[character] += 1;
      }
    }

    const maximum = Math.max(counts[','], counts['\t'], counts[';']);
    const winners = Object.keys(counts).filter((candidate) => counts[candidate] === maximum);
    return maximum > 0 && winners.length === 1 ? winners[0] : ',';
  }

  // CSV を解析します。入力は CSV 文字列と任意の区切り文字、出力はヘッダと行の配列です。
  function parseCSV(input, explicitDelimiter) {
    const text = stripBom(String(input == null ? '' : input));
    if (text.length === 0) {
      return { headers: [], rows: [] };
    }

    const delimiter = explicitDelimiter === undefined ? detectDelimiter(text) : String(explicitDelimiter);
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    let recordHasContent = false;

    // 現在のレコードを確定します。入力は内部状態、出力はありません。
    function finishRecord() {
      record.push(field);
      if (recordHasContent) {
        records.push(record);
      }
      record = [];
      field = '';
      recordHasContent = false;
    }

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += character;
        }
        continue;
      }

      if (character === '"' && field.length === 0) {
        quoted = true;
        recordHasContent = true;
      } else if (character === delimiter) {
        record.push(field);
        field = '';
        recordHasContent = true;
      } else if (character === '\r' || character === '\n') {
        finishRecord();
        if (character === '\r' && text[index + 1] === '\n') {
          index += 1;
        }
      } else {
        field += character;
        recordHasContent = true;
      }
    }

    if (recordHasContent || record.length > 0 || field.length > 0) {
      finishRecord();
    }

    if (records.length === 0) {
      return { headers: [], rows: [] };
    }

    const sourceHeaders = records.shift();
    let maximumColumns = sourceHeaders.length;
    for (const row of records) {
      maximumColumns = Math.max(maximumColumns, row.length);
    }

    const headers = [];
    for (let index = 0; index < maximumColumns; index += 1) {
      const name = index < sourceHeaders.length ? sourceHeaders[index] : '';
      headers.push(name === '' ? `col${index + 1}` : name);
    }

    const rows = records.map((sourceRow) => {
      const row = sourceRow.slice(0, maximumColumns);
      while (row.length < maximumColumns) {
        row.push('');
      }
      return row;
    });

    return { headers, rows };
  }

  // 数値として比較可能か判定します。入力は文字列、出力は判定結果です。
  function numericValue(value) {
    const trimmed = String(value).trim();
    if (trimmed === '' || trimmed.includes(',')) {
      return null;
    }
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }

  // 2 つの値を昇順で比較します。入力は文字列 2 個、出力は比較結果です。
  function compareValues(a, b) {
    const left = String(a);
    const right = String(b);
    const leftEmpty = left.trim() === '';
    const rightEmpty = right.trim() === '';

    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return 0;
      return leftEmpty ? 1 : -1;
    }

    const leftNumber = numericValue(left);
    const rightNumber = numericValue(right);
    if (leftNumber !== null || rightNumber !== null) {
      if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
      return leftNumber !== null ? -1 : 1;
    }

    return left.localeCompare(right, 'ja', { numeric: true });
  }

  // 行を安定ソートします。入力は行配列・列番号・方向、出力は新しい行配列です。
  function sortRows(rows, colIndex, direction) {
    const descending = direction === 'desc';
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftValue = String(left.row[colIndex] == null ? '' : left.row[colIndex]);
        const rightValue = String(right.row[colIndex] == null ? '' : right.row[colIndex]);
        const leftEmpty = leftValue.trim() === '';
        const rightEmpty = rightValue.trim() === '';

        if (leftEmpty || rightEmpty) {
          if (leftEmpty && rightEmpty) return left.index - right.index;
          return leftEmpty ? 1 : -1;
        }

        const result = compareValues(leftValue, rightValue);
        return result === 0 ? left.index - right.index : (descending ? -result : result);
      })
      .map((entry) => entry.row.slice());
  }

  // JSON Lines を解析します。入力は文字列と上限、出力は解析結果と打ち切り状態です。
  function parseJSONL(input, limit) {
    const text = stripBom(String(input == null ? '' : input));
    const maximum = limit === undefined ? 10 : Math.max(0, Number(limit) || 0);
    const lines = text.split(/\r\n|\n|\r/);
    const items = [];
    let truncated = false;

    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      if (raw.trim() === '') continue;
      if (items.length >= maximum) {
        truncated = true;
        break;
      }

      try {
        items.push({ line: index + 1, value: JSON.parse(raw) });
      } catch (error) {
        items.push({ line: index + 1, error: error.message, raw });
      }
    }

    return { items, truncated };
  }

  // ファイルの種別を判定します。入力はファイル名と内容、出力は種別名です。
  function detectType(fileName, input) {
    const name = String(fileName || '').toLowerCase();
    const text = stripBom(String(input == null ? '' : input));
    if (/\.(csv|tsv)$/.test(name)) return 'csv';
    if (/\.(jsonl|ndjson)$/.test(name)) return 'jsonl';

    let wholeJson = false;
    try {
      JSON.parse(text);
      wholeJson = true;
    } catch (error) {
      wholeJson = false;
    }

    if (name.endsWith('.json')) {
      if (wholeJson) return 'json';
      const nonEmptyLines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '');
      if (nonEmptyLines.length >= 2) {
        try {
          JSON.parse(nonEmptyLines[0]);
          return 'jsonl';
        } catch (error) {
          return 'json';
        }
      }
      return 'json';
    }

    if (wholeJson) return 'json';
    const firstLine = text.split(/\r\n|\n|\r/).find((line) => line.trim() !== '');
    if (firstLine) {
      const trimmed = firstLine.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
          return 'jsonl';
        } catch (error) {
          // JSON Lines として解析できない場合は CSV として扱います。
        }
      }
    }
    return 'csv';
  }

  // 貼り付けテキストの種別を内容だけで判定します。入力は文字列、出力は種別名です。
  // { または [ で始まる壊れた JSON は、CSV ではなく JSON として扱い解析エラーを見せます。
  function detectTextType(input) {
    const text = stripBom(String(input == null ? '' : input));
    const type = detectType('', text);
    if (type === 'csv' && /^\s*[[{]/.test(text)) return 'json';
    return type;
  }

  // バイト列を UTF-8、失敗時は Shift_JIS で復号します。入力は Uint8Array、出力は文字列です。
  function decodeBytes(uint8Array) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(uint8Array);
    } catch (error) {
      text = new TextDecoder('shift_jis').decode(uint8Array);
    }
    return stripBom(text);
  }

  const api = { parseCSV, compareValues, sortRows, parseJSONL, detectType, detectTextType, decodeBytes };
  root.DataParsers = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

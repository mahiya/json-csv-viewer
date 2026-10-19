(function () {
  'use strict';

  const parsers = globalThis.DataParsers;
  const fileBar = document.getElementById('file-bar');
  const fileInfo = document.getElementById('file-info');
  const backButton = document.getElementById('back-button');
  const emptyState = document.getElementById('empty-state');
  const selectButton = document.getElementById('select-button');
  const fileInput = document.getElementById('file-input');
  const textInput = document.getElementById('text-input');
  const typeSelect = document.getElementById('type-select');
  const renderButton = document.getElementById('render-button');
  const errorMessage = document.getElementById('error-message');
  const viewer = document.getElementById('viewer');
  const dropIndicator = document.getElementById('drop-indicator');
  let dragDepth = 0;

  // 要素を生成して任意のクラスと文字列を設定します。入力はタグ・クラス・文字列、出力は要素です。
  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // ファイルサイズを読みやすい単位に変換します。入力はバイト数、出力は表示文字列です。
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  // 表示領域を初期化します。入力と出力はありません。
  function clearOutput() {
    viewer.replaceChildren();
    viewer.hidden = true;
    errorMessage.textContent = '';
    errorMessage.hidden = true;
  }

  // 画面内にエラーを表示します。入力はメッセージ、出力はありません。
  function showError(message) {
    viewer.hidden = true;
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  // 読み込み元の概要を上部バーへ表示します。入力は name と size を持つ読み込み元・種別・件数、出力はありません。
  function showFileBar(source, type, countText) {
    fileInfo.textContent = `${source.name}　種別: ${type.toUpperCase()}　サイズ: ${formatSize(source.size)}　件数: ${countText}`;
    fileBar.hidden = false;
  }

  // JSONL の先頭 10 件と超過確認に必要な範囲だけ読みます。入力は File、出力は文字列です。
  async function readJSONLPrefix(file) {
    const chunkSize = 1024 * 1024;
    const chunks = [];
    let offset = 0;
    let absolutePosition = 0;
    let completedLines = 0;
    let lineHasContent = false;
    let previousCarriageReturn = false;
    let tenthLineEnd = -1;
    let hasEleventhLine = false;

    while (offset < file.size && !hasEleventhLine) {
      const buffer = await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      chunks.push(bytes);

      for (let index = 0; index < bytes.length; index += 1) {
        const byte = bytes[index];
        const currentPosition = absolutePosition + index;
        if (byte === 13) {
          if (lineHasContent) completedLines += 1;
          lineHasContent = false;
          previousCarriageReturn = true;
          if (completedLines === 10 && tenthLineEnd < 0) tenthLineEnd = currentPosition + 1;
        } else if (byte === 10) {
          if (!previousCarriageReturn) {
            if (lineHasContent) completedLines += 1;
            lineHasContent = false;
            if (completedLines === 10 && tenthLineEnd < 0) tenthLineEnd = currentPosition + 1;
          }
          previousCarriageReturn = false;
        } else {
          previousCarriageReturn = false;
          if (byte !== 32 && byte !== 9 && byte !== 11 && byte !== 12) {
            lineHasContent = true;
            if (completedLines >= 10) {
              hasEleventhLine = true;
              break;
            }
          }
        }
      }

      absolutePosition += bytes.length;
      offset += bytes.length;
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let destination = 0;
    for (const chunk of chunks) {
      combined.set(chunk, destination);
      destination += chunk.length;
    }

    if (hasEleventhLine && tenthLineEnd >= 0) {
      return `${parsers.decodeBytes(combined.slice(0, tenthLineEnd))}\n0`;
    }
    return parsers.decodeBytes(combined);
  }

  // セル値が有限数値か判定します。入力は文字列、出力は判定結果です。
  function isNumericCell(value) {
    const trimmed = String(value).trim();
    return trimmed !== '' && !trimmed.includes(',') && Number.isFinite(Number(trimmed));
  }

  // CSV データを検索・ソート・ページング可能な表として描画します。入力は解析結果、出力はありません。
  function renderCSV(data) {
    const layout = createElement('div', 'csv-layout data-font');
    const toolbar = createElement('div', 'toolbar');
    const filterInput = createElement('input');
    filterInput.type = 'search';
    filterInput.placeholder = '絞り込み';
    filterInput.setAttribute('aria-label', '絞り込み');
    const countLabel = createElement('span', 'count-label');
    toolbar.append(filterInput, countLabel);

    const tableScroll = createElement('div', 'table-scroll');
    const table = createElement('table');
    const tableHead = createElement('thead');
    const tableBody = createElement('tbody');
    table.append(tableHead, tableBody);
    tableScroll.append(table);

    layout.append(toolbar, tableScroll);
    viewer.replaceChildren(layout);
    viewer.hidden = false;

    const sourceRows = data.rows.map((cells, index) => ({ cells, sourceIndex: index }));
    const numericColumns = data.headers.map((header, columnIndex) => {
      const values = data.rows.map((row) => row[columnIndex]).filter((value) => String(value).trim() !== '');
      return values.length > 0 && values.every(isNumericCell);
    });
    let sortColumn = -1;
    let sortDirection = null;
    // 絞り込み・ソート後の先頭 100 行だけを表示します。
    const displayLimit = 100;
    // 絞り込み・ソート結果のキャッシュ (条件が変わったときだけ null に戻して再計算する)
    let cachedRows = null;

    // 現在の条件から表示対象行を作ります。入力は内部状態、出力は行オブジェクト配列です。
    function visibleRows() {
      if (cachedRows) return cachedRows;
      cachedRows = computeVisibleRows();
      return cachedRows;
    }

    // 絞り込みとソートを適用した行を計算します。入力は内部状態、出力は行オブジェクト配列です。
    function computeVisibleRows() {
      const query = filterInput.value.toLocaleLowerCase('ja');
      let rows = query === ''
        ? sourceRows.slice()
        : sourceRows.filter((row) => row.cells.some((cell) => String(cell).toLocaleLowerCase('ja').includes(query)));

      if (sortColumn >= 0 && sortDirection) {
        rows = rows
          .map((row, index) => ({ row, index }))
          .sort((left, right) => {
            const leftValue = left.row.cells[sortColumn];
            const rightValue = right.row.cells[sortColumn];
            const leftEmpty = String(leftValue).trim() === '';
            const rightEmpty = String(rightValue).trim() === '';
            if (leftEmpty || rightEmpty) {
              if (leftEmpty && rightEmpty) return left.index - right.index;
              return leftEmpty ? 1 : -1;
            }
            const result = parsers.compareValues(leftValue, rightValue);
            return result === 0 ? left.index - right.index : (sortDirection === 'desc' ? -result : result);
          })
          .map((entry) => entry.row);
      }
      return rows;
    }

    // ソート状態を含むテーブルヘッダを再描画します。入力と出力はありません。
    function renderHeader() {
      const row = createElement('tr');
      row.append(createElement('th', 'row-number', '行'));
      data.headers.forEach((header, columnIndex) => {
        const cell = createElement('th', numericColumns[columnIndex] ? 'numeric' : '');
        const marker = sortColumn === columnIndex ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
        const button = createElement('button', '', `${header}${marker}`);
        button.type = 'button';
        button.addEventListener('click', () => {
          if (sortColumn !== columnIndex) {
            sortColumn = columnIndex;
            sortDirection = 'asc';
          } else if (sortDirection === 'asc') {
            sortDirection = 'desc';
          } else {
            sortColumn = -1;
            sortDirection = null;
          }
          cachedRows = null;
          render();
        });
        cell.append(button);
        row.append(cell);
      });
      tableHead.replaceChildren(row);
    }

    // 先頭 100 行だけを DOM に描画します。入力と出力はありません。
    function render() {
      const rows = visibleRows();
      const fragment = document.createDocumentFragment();

      for (const rowData of rows.slice(0, displayLimit)) {
        const row = createElement('tr');
        row.append(createElement('td', 'row-number', String(rowData.sourceIndex + 2)));
        rowData.cells.forEach((value, columnIndex) => {
          const cell = createElement('td', numericColumns[columnIndex] ? 'numeric' : '');
          const valueElement = createElement('span', 'cell-value', value);
          valueElement.title = 'クリックで全文表示';
          valueElement.addEventListener('click', () => valueElement.classList.toggle('expanded'));
          cell.append(valueElement);
          row.append(cell);
        });
        fragment.append(row);
      }

      tableBody.replaceChildren(fragment);
      countLabel.textContent = rows.length > displayLimit
        ? `${rows.length} 件中 先頭 ${displayLimit} 件を表示`
        : `${rows.length} 件`;
      renderHeader();
    }

    filterInput.addEventListener('input', () => {
      cachedRows = null;
      render();
    });
    render();
  }

  // JSON の値を型別の表示要素に変換します。入力は値、出力は要素です。
  function createPrimitive(value) {
    if (value === null) return createElement('span', 'tree-null', 'null');
    if (typeof value === 'string') return createElement('span', 'tree-string', JSON.stringify(value));
    if (typeof value === 'number') return createElement('span', 'tree-number', String(value));
    if (typeof value === 'boolean') return createElement('span', 'tree-boolean', String(value));
    return createElement('span', 'tree-null', String(value));
  }

  // 遅延描画用の JSON ツリー環境を生成します。入力は初期展開深度、出力は環境です。
  function createTreeContext(initialDepth) {
    return { initialDepth, nodeCount: 0, controllers: [] };
  }

  // JSON の 1 ノードを生成します。入力はキー・値・深度・環境、出力は要素です。
  function createTreeNode(key, value, depth, context) {
    context.nodeCount += 1;
    const node = createElement('div', 'tree-node');
    const row = createElement('div', 'tree-row');
    const hasKey = key !== null && key !== undefined;

    if (value === null || typeof value !== 'object') {
      row.append(createElement('span', 'tree-spacer'));
      if (hasKey) {
        row.append(createElement('span', 'tree-key', `${key}:`));
      }
      row.append(createPrimitive(value));
      node.append(row);
      return node;
    }

    const isArray = Array.isArray(value);
    const keys = Object.keys(value);
    const toggle = createElement('button', 'tree-toggle');
    toggle.type = 'button';
    const summary = createElement('span', 'tree-summary');
    const children = createElement('div', 'tree-children');
    children.hidden = true;
    row.append(toggle);
    if (hasKey) row.append(createElement('span', 'tree-key', `${key}:`));
    row.append(summary);
    node.append(row, children);

    let expanded = false;
    let loaded = 0;
    let moreButton = null;
    let closingBracketAdded = false;
    const controller = { element: node, setOpen, loadNext, remaining: () => keys.length - loaded };
    context.controllers.push(controller);

    // 開閉状態に合わせて要約表示を更新します。入力と出力はありません。
    function updateSummary() {
      toggle.textContent = expanded ? '−' : '+';
      toggle.setAttribute('aria-expanded', String(expanded));
      if (expanded) {
        summary.textContent = isArray ? '[' : '{';
      } else {
        summary.textContent = isArray ? `[…] ${keys.length} items` : `{…} ${keys.length} keys`;
      }
      children.hidden = !expanded;
    }

    // 未描画の子を最大 200 件追加します。入力は生成上限、出力は生成数です。
    function loadNext(budget) {
      if (moreButton) {
        moreButton.remove();
        moreButton = null;
      }
      const allowance = Number.isFinite(budget) ? Math.max(0, budget) : 200;
      const amount = Math.min(200, keys.length - loaded, allowance);
      for (let index = 0; index < amount; index += 1) {
        const childKey = keys[loaded];
        children.append(createTreeNode(isArray ? loaded : childKey, value[childKey], depth + 1, context));
        loaded += 1;
      }
      if (loaded < keys.length) {
        moreButton = createElement('button', 'tree-more', 'さらに表示');
        moreButton.type = 'button';
        moreButton.addEventListener('click', () => loadNext(Number.POSITIVE_INFINITY));
        children.append(moreButton);
      } else if (!closingBracketAdded) {
        children.append(createElement('div', 'tree-bracket', isArray ? ']' : '}'));
        closingBracketAdded = true;
      }
      return amount;
    }

    // ノードを開閉し、初回展開時だけ子を生成します。入力は開閉状態と生成上限、出力はありません。
    function setOpen(open, budget) {
      expanded = open;
      if (expanded && loaded === 0) loadNext(budget);
      updateSummary();
    }

    toggle.addEventListener('click', () => setOpen(!expanded, Number.POSITIVE_INFINITY));
    updateSummary();
    if (depth < context.initialDepth && context.nodeCount < 5000) {
      setOpen(true, 5000 - context.nodeCount);
    }
    return node;
  }

  // JSON 全体を開閉可能なツリーとして描画します。入力は JSON 値、出力はありません。
  function renderJSON(value) {
    const layout = createElement('div', 'json-layout data-font');
    const toolbar = createElement('div', 'toolbar');
    const expandButton = createElement('button', '', 'すべて開く');
    const collapseButton = createElement('button', '', 'すべて閉じる');
    const notice = createElement('span', 'tree-notice');
    toolbar.append(expandButton, collapseButton, notice);
    const scroll = createElement('div', 'tree-scroll');
    const context = createTreeContext(2);
    scroll.append(createTreeNode(null, value, 0, context));
    layout.append(toolbar, scroll);
    viewer.replaceChildren(layout);
    viewer.hidden = false;

    // 生成済みと新規生成されるノードを上限まで展開します。入力と出力はありません。
    function expandAll() {
      const limit = 5000;
      let index = 0;
      while (index < context.controllers.length) {
        const controller = context.controllers[index];
        controller.setOpen(true, Math.max(0, limit - context.nodeCount));
        while (controller.remaining() > 0 && context.nodeCount < limit) {
          const created = controller.loadNext(limit - context.nodeCount);
          if (created === 0) break;
        }
        index += 1;
      }
      notice.textContent = context.nodeCount >= limit ? '表示上限 5000 ノード' : '';
    }

    expandButton.addEventListener('click', expandAll);
    collapseButton.addEventListener('click', () => {
      context.controllers.forEach((controller) => controller.setOpen(false, 0));
      notice.textContent = '';
    });
  }

  // JSON Lines の各解析結果をカードとして描画します。入力は解析結果、出力はありません。
  function renderJSONL(result) {
    const layout = createElement('div', 'json-layout data-font');
    if (result.truncated) {
      const toolbar = createElement('div', 'toolbar');
      toolbar.append(createElement('span', 'jsonl-notice', '先頭 10 件を表示'));
      layout.append(toolbar);
    }
    const scroll = createElement('div', 'jsonl-scroll');
    for (const item of result.items) {
      const card = createElement('article', 'jsonl-card');
      card.append(createElement('h2', '', `行 ${item.line}`));
      if (Object.prototype.hasOwnProperty.call(item, 'error')) {
        card.append(createElement('div', 'jsonl-error', item.error));
        card.append(createElement('div', 'jsonl-raw', item.raw));
      } else {
        const context = createTreeContext(1);
        card.append(createTreeNode(null, item.value, 0, context));
      }
      scroll.append(card);
    }
    layout.append(scroll);
    viewer.replaceChildren(layout);
    viewer.hidden = false;
  }

  // 本文を種別に応じて解析し描画します。入力は name と size を持つ読み込み元・種別・本文・区切り文字、出力はありません。
  function renderContent(source, type, text, delimiter) {
    try {
      if (type === 'csv') {
        const data = parsers.parseCSV(text, delimiter);
        showFileBar(source, type, `${data.rows.length}×${data.headers.length}`);
        renderCSV(data);
      } else if (type === 'json') {
        const value = JSON.parse(text);
        const count = value && typeof value === 'object' ? Object.keys(value).length : 1;
        showFileBar(source, type, String(count));
        renderJSON(value);
      } else {
        const result = parsers.parseJSONL(text, 10);
        showFileBar(source, type, String(result.items.length));
        renderJSONL(result);
      }
    } catch (error) {
      showFileBar(source, 'error', '0');
      showError(`解析できませんでした: ${error.message}`);
    }
  }

  // ファイルを読み込み、判定した種別に応じて描画します。入力は File、出力は Promise です。
  async function handleFile(file) {
    clearOutput();
    emptyState.hidden = true;
    fileInfo.textContent = `${file.name}　読み込み中`;
    fileBar.hidden = false;

    try {
      const knownJSONL = /\.(jsonl|ndjson)$/i.test(file.name);
      const text = knownJSONL
        ? await readJSONLPrefix(file)
        : parsers.decodeBytes(new Uint8Array(await file.arrayBuffer()));
      const type = parsers.detectType(file.name, text);
      renderContent(file, type, text, /\.tsv$/i.test(file.name) ? '\t' : undefined);
    } catch (error) {
      showFileBar(file, 'error', '0');
      showError(`解析できませんでした: ${error.message}`);
    }
  }

  // 貼り付けたテキストを解析して描画します。入力は本文と種別 (auto は自動判定)、出力はありません。
  function handleText(text, selectedType) {
    clearOutput();
    emptyState.hidden = true;
    const source = { name: '貼り付けテキスト', size: new TextEncoder().encode(text).length };
    const type = selectedType === 'auto' ? parsers.detectTextType(text) : selectedType;
    renderContent(source, type, text);
  }

  // テキスト欄の内容を表示します。空のときは何もしません。入力と出力はありません。
  function submitText() {
    if (textInput.value.trim() === '') {
      textInput.focus();
      return;
    }
    handleText(textInput.value, typeSelect.value);
  }

  // 表示を消して入力画面に戻ります。入力と出力はありません。
  function showInput() {
    clearOutput();
    fileBar.hidden = true;
    emptyState.hidden = false;
    textInput.focus();
  }

  // 選択ボタンとファイル入力を接続します。
  selectButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // テキスト欄は表示ボタンまたは Ctrl+Enter / Command+Enter で表示します。
  renderButton.addEventListener('click', submitText);
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitText();
    }
  });
  backButton.addEventListener('click', showInput);

  // 入力欄以外での貼り付けは、クリップボードのファイルまたはテキストをそのまま表示します。
  document.addEventListener('paste', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return;
    const transfer = event.clipboardData;
    if (!transfer) return;

    const file = transfer.files && transfer.files[0];
    if (file) {
      event.preventDefault();
      handleFile(file);
      return;
    }
    const text = transfer.getData('text/plain');
    if (text.trim() === '') return;
    event.preventDefault();
    textInput.value = text;
    typeSelect.value = 'auto';
    handleText(text, 'auto');
  });

  // ファイルをドラッグしている間だけドロップ枠を表示します。
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
    if (types.includes('Files')) dropIndicator.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropIndicator.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    dragDepth = 0;
    dropIndicator.hidden = true;
    const file = event.dataTransfer && event.dataTransfer.files[0];
    // テキスト欄へのテキストのドロップは、ブラウザ標準の挿入に任せます。
    if (!file && event.target === textInput) return;
    event.preventDefault();
    if (file) handleFile(file);
  });
})();

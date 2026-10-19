# CSV / JSON / JSONL ビューア

## 概要
- CSV / JSON / JSONL を、ファイルのドロップ・選択、またはテキストの貼り付けで読み込み、可視化して探索する Web アプリ
- 読み込んだ内容はブラウザの中だけで処理し、外部へ送らない
- `index.html` をブラウザで直接開いても (file://)、GitHub Pages などの静的配信でも動くこと。サーバ側の処理、ビルド工程、npm パッケージ、CDN、外部フォントは使わない

## ファイル構成
- `index.html`: 画面本体。`lib/parsers.js` → `app.js` の順にクラシックスクリプトで読み込む
- `style.css`: スタイル
- `lib/parsers.js`: DOM に依存しない解析ロジック。ブラウザでは `globalThis.DataParsers`、Node.js では `module.exports` として同じオブジェクトを公開する
- `app.js`: DOM 操作、ファイル読み込み、貼り付け、描画
- `test/parsers.test.js`: `lib/parsers.js` の単体テスト
- `tools/verify.js`: 公開 API の動作と、ソースの禁止事項 (外部 URL、ES Modules、`alert`、猫語) を機械的に確認するスクリプト
- `samples/`: 動作確認用のサンプルファイル
- `favicon.svg`: ファビコンの原本。`favicon-32.png` (SVG 非対応ブラウザ向け) と `apple-touch-icon.png` (ホーム画面用、180px) はこれから書き出した PNG なので、図案を変えたら PNG も作り直す
- `.nojekyll`: GitHub Pages で Jekyll の変換をさせず、ファイルをそのまま配信するための空ファイル

## 公開
- GitHub リポジトリ `mahiya/json-csv-viewer` の main ブランチのルートを GitHub Pages で公開している
- main に push すると Pages に反映される

## テスト
- `node --test test/`
- `node tools/verify.js` (最後に `VERIFY: PASS` と表示されれば成功)
- Node.js が入っていない端末では、`uvx --from nodejs-wheel node --test test/` のように uv 経由で一時的に実行する
- `lib/parsers.js` を変更したら、上の 2 つを両方通すこと

## 技術上の制約
- 素の HTML / CSS / JavaScript のみ。フレームワーク、ライブラリは使わない
- file:// で動かすため、ES Modules (`type="module"`、`import` / `export`) は使わない
- 外部への通信を行うコードを書かない。ソースに http:// や https:// の URL を含めない
- 読み込んだ内容を DOM に入れるときは `textContent` / `createTextNode` を使う。`innerHTML` に読み込んだ内容由来の文字列を渡さない
- パッケージを追加しない。テストは Node.js 標準の `node --test` と `node:assert` だけで書く
- 参照パスは相対パスにする (GitHub Pages ではリポジトリ名のサブパスで配信されるため)
- `alert` などのダイアログは使わず、エラーは画面内に表示する

## 意図している挙動
- JSONL は先頭 10 件 (非空行) だけを表示する。拡張子が `.jsonl` / `.ndjson` のファイルは、全体を読まずに先頭から必要な分だけ読む
- CSV は絞り込み・ソート後の先頭 100 行だけを DOM にする
- JSON ツリーは子ノードを開いたときに初めて生成し、200 件ずつ表示する。「すべて開く」は 5000 ノードで打ち切る
- 貼り付けたテキストは `detectTextType` で種別を判定する。`{` / `[` で始まる壊れた JSON は CSV ではなく JSON として扱い、解析エラーを見せる
- テキスト欄や絞り込み欄の外で貼り付けた場合は、その内容をすぐに表示する

## UI の方針
- 配色は常にダークモード
- 機能重視。説明書き、キャッチコピー、アイコン装飾、アニメーション、絵文字は入れない
- UI の文言は日本語で、必要最小限のラベルのみ

## 文体
- ソースコード内のコメントは日本語の通常の文体 (です・ます調、または体言止め) で書く
- 成果物 (ソース、コメント、UI 文言、ドキュメント) に猫語 (語尾の「にゃ」「にゃん」など) や「ご主人様」という語を含めない
- コードブロックごとに、何をしているかを日本語コメントで書く。関数には目的・入力・出力を簡潔に書く

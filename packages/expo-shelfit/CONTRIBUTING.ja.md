# コントリビューションガイド

[English](./CONTRIBUTING.md) | 日本語

`shelfit` へのコントリビューションをご検討いただきありがとうございます。これは依存関係のない小さな CLI なので、変更を取り入れる基準は「その変更は入れる価値があるか」です。

## 開発環境のセットアップ

このパッケージは `shelfit` モノレポ（npm workspaces）内にあります。Node.js **22 LTS以降**が必要です（`engines` フィールドで22以降が必須です）。

```bash
git clone https://github.com/my-shelfio/shelfit.git
cd shelfit
npm install
```

リポジトリルートで `npm install` を実行すると、`packages/*` 配下の全パッケージ（このパッケージを含む）の依存関係がインストールされます。

CLIをローカルで実行する:

```bash
export EXPO_TOKEN=xxxxx
npm start --workspace=packages/expo-shelfit
```

## チェック

リポジトリルートから、このパッケージを指定して実行します:

```bash
npm test --workspace=packages/expo-shelfit               # Vitest
npm run test:coverage --workspace=packages/expo-shelfit  # Vitest（カバレッジ付き）
```

lint/format はモノレポ全体に適用され、リポジトリルートから実行します:

```bash
npm run lint    # Biome（lint + フォーマットチェック）
npm run format  # Biome（フォーマットを自動修正）
```

上記はすべて、PRごとにCI（Node 20 / 22 / 24）で実行されます。PRを開く前にローカルで通過することを確認してください — チェックリストは `.github/pull_request_template.md` を参照してください。

## プロジェクト構成

以下のパスは `packages/expo-shelfit/` からの相対パスです:

```
bin/cli.mjs           シンプルな実行エントリポイント（shebang + src/cli.mjs#run を呼ぶだけ）
src/cli.mjs           トップレベルの run() フロー: 認証解決・アカウント取得、
                      src/commands/ 内の表示モードへのディスパッチ
src/args.mjs          引数パース、バリデーション上限値、ヘルプテキスト
src/commands/
  list.mjs            デフォルトのアプリ一覧（および --history）
  usage.mjs           --usage（UTC暦月ごとの成功ビルド数）
  plan.mjs            --plan（アカウントごとの現在のサブスクリプション）
src/api.mjs           EAS GraphQLクライアント（throwのみ、exit/printしない）+
                      mapWithConcurrency/CONCURRENCY
src/format.mjs        エントリ → JSON/CSV/表示行への変換（FIELDS/
                      USAGE_FIELDS/PLAN_FIELDS が機械可読な出力契約）
src/render.mjs        テーブル描画と列幅
src/dates.mjs         UTC日付ヘルパー（暦月境界、表示用フォーマット） —
                      このCLIが表示する日時はすべてUTC
src/progress.mjs      TTY限定のstderr進捗表示
test/                 Vitestテスト。srcの各モジュールに1ファイル対応（run-*.test.mjs
                      はモックしたfetchを使った run() のモードごとの統合テスト。
                      共通部分は helpers.mjs にまとめている）
```

importの流れは一方向です — `bin → cli → args / commands/* → api / format /
render / dates / progress`（`format` は `dates`/`render` も使用） — 逆方向になることはありません（例: `api.mjs` は `commands/` からimportしてはいけない）。

`src/*` のファイルは `process.exit` を呼んだり `process.argv` を直接読んだりしないため、単体テスト可能な状態を保っています。プロセスを終了できるのは `bin/cli.mjs` だけです。

## ブランチ戦略

- `develop` — 統合ブランチ。日々の作業はここにマージされる
- `main` — リリース済みブランチ。リリースPRで `develop` → `main` に反映される。npmへの公開はそこから自動で行われる（下記リリース参照）— 手動でのタグ付けは不要

## コミット / PRの規約

コミットメッセージの形式は強制していません。コミットは焦点を絞り、PRは小さく保ってください。PRテンプレートの検証チェックリストを使用してください。

## リリース（メンテナー向け）

モノレポのため、`packages/*` 配下の各パッケージはそれぞれ独立してバージョン管理・公開されます。バージョンアップには [Changesets](https://github.com/changesets/changesets) を使用しています（CHANGELOG生成は無効化しています — GitHub Releasesがリリースノートの正となります。`.github/RELEASE_TEMPLATE.md` を参照）。リポジトリルートから:

```bash
npx changeset          # 変更内容を記述し、対象パッケージとバンプ種別を選択
```

変更を説明するchangesetは、その変更と同じPRに追加してください（`changeset` 実行時に `packages/*` のどのパッケージが対象か聞かれます）。changesetが `main` に反映されると（`develop` → `main` のリリースPR経由）、`.github/workflows/release.yml`（[`changesets/action`](https://github.com/changesets/action) を使用）が対象パッケージの `package.json` をバンプする "Version Packages" PR を自動作成・更新します。そのPRをマージすると、バージョンが変わった各パッケージについて実際の `npm publish` がトリガーされます — Trusted Publishing経由（トークン不要）。手動での `npm version` / `git tag` は不要です。

## バグ報告・機能リクエスト

Issueテンプレートを使用してください — このCLIが依存するEAS APIは非公式かつ非文書化のため、実際に重要な詳細（Nodeのバージョン、`shelfit --version`、トークンの種類）を尋ねる内容になっています。

## セキュリティに関する問題

公開Issueを作成しないでください。[SECURITY.md](./SECURITY.md) を参照してください。

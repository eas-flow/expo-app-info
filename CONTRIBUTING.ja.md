# コントリビューションガイド

[English](./CONTRIBUTING.md) | 日本語

`expo-app-info` へのコントリビューションをご検討いただきありがとうございます。これは依存関係のない小さな CLI なので、変更を取り入れる基準は「その変更は入れる価値があるか」です。

## 開発環境のセットアップ

Node.js **22 LTS以降**が必要です（`engines` フィールドは20以降を許容していますが、開発は22以降で行ってください）。

```bash
git clone https://github.com/eas-flow/expo-app-info.git
cd expo-app-info
npm install
```

CLIをローカルで実行する:

```bash
export EXPO_TOKEN=xxxxx
npm start
```

## チェック

```bash
npm test              # Vitest
npm run test:coverage # Vitest（カバレッジ付き）
npm run lint           # Biome（lint + フォーマットチェック）
npm run format         # Biome（フォーマットを自動修正）
```

上記はすべて、PRごとにCI（Node 20 / 22 / 24）で実行されます。PRを開く前にローカルで通過することを確認してください — チェックリストは `.github/pull_request_template.md` を参照してください。

## プロジェクト構成

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
- `main` — リリース済みブランチ。リリースPRで `develop` → `main` に反映した後、`vX.Y.Z` タグをpushして公開ワークフローをトリガーする

## コミット / PRの規約

コミットメッセージの形式は強制していません。コミットは焦点を絞り、PRは小さく保ってください。PRテンプレートの検証チェックリストを使用してください。

## リリース（メンテナー向け）

このリポジトリはバージョンアップに [Changesets](https://github.com/changesets/changesets) を使用しています（CHANGELOG生成は無効化しています — GitHub Releasesがリリースノートの正となります。`.github/RELEASE_TEMPLATE.md` を参照）:

```bash
npx changeset          # 変更内容を記述し、バンプ種別を選択
```

変更を説明するchangesetは、その変更と同じPRに追加してください。リリース時には `npx changeset version` を実行して `package.json` をバンプし、それをコミットして `main` にマージした後、タグを付けてpushします:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

タグのpushにより `.github/workflows/release.yml` がトリガーされ、Trusted Publishing経由でnpmに公開されます（トークン不要）。

## バグ報告・機能リクエスト

Issueテンプレートを使用してください — このCLIが依存するEAS APIは非公式かつ非文書化のため、実際に重要な詳細（Nodeのバージョン、`expo-app-info --version`、トークンの種類）を尋ねる内容になっています。

## セキュリティに関する問題

公開Issueを作成しないでください。[SECURITY.md](./SECURITY.md) を参照してください。

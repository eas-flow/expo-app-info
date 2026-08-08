# コントリビューションガイド

[English](./CONTRIBUTING.md) | 日本語

`expo-shelfit` へのコントリビューションをご検討いただきありがとうございます。これは依存関係のない小さな CLI なので、変更を取り入れる基準は「その変更は入れる価値があるか」です。

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

上記はすべて、PRごとにCI（Node 22 / 24）で実行されます。PRを開く前にローカルで通過することを確認してください — チェックリストは `.github/pull_request_template.md` を参照してください。

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
                      createSemaphore/mapWithConcurrency/CONCURRENCY
src/format.mjs        エントリ → 表示行への変換（機械可読な出力モードは
                      存在せず、テーブルが唯一のサポート対象出力）
src/render.mjs        テーブル描画と列幅
src/dates.mjs         UTC日付ヘルパー（暦月境界、表示用フォーマット） —
                      このCLIが表示する日時はすべてUTC
src/progress.mjs      TTY限定のstderr進捗表示
test/                 Vitestテスト。srcの各モジュールに1ファイル対応（run-*.test.mjs
                      はモックしたfetchを使った run() のモードごとの統合テスト。
                      共通部分は helpers.mjs にまとめている）
```

importの流れは一方向です — `bin → cli → args / commands/* → api / format /
render / dates / progress`（`format` は `dates` を、`progress` は `render` も使用） — 逆方向になることはありません（例: `api.mjs` は `commands/` からimportしてはいけない）。

`src/*` のファイルは `process.exit` を呼んだり `process.argv` を直接読んだりしないため、単体テスト可能な状態を保っています。プロセスを終了できるのは `bin/cli.mjs` だけです。

## ブランチ戦略

- `develop` — 統合ブランチ。日々の作業はここにマージされる
- `main` — リリース済みブランチ。リリースPRで `develop` → `main` に反映される。npmへの公開は、そこからGitHub Releaseを作成することでトリガーされる（下記リリース参照）

## コミット / PRの規約

コミットメッセージの形式は強制していません。コミットは焦点を絞り、PRは小さく保ってください。PRテンプレートの検証チェックリストを使用してください。

## リリース（メンテナー向け）

モノレポのため、`packages/*` 配下の各パッケージはそれぞれ独立してバージョン管理・公開されます。CHANGELOGを自動生成する仕組みはありません — GitHub Releasesがリリースノートの正です（`.github/RELEASE_TEMPLATE.md` を参照）。

1. 対象パッケージの `package.json`（例: `packages/expo-shelfit/package.json`）の `version` を手動で編集し、続けてリポジトリルートで `npm install --package-lock-only` を実行して `package-lock.json` を追従させます。`package-lock.json` の `packages/*` エントリにも `version` が記録されているため、追従させないとリリースワークフローの `npm ci` が lock 不整合で失敗します。`develop` → `main` のリリースPRに含めるか、軽量な version bump 用の別PRとして行ってください。
2. そのPRを `main` にマージします。
3. `v*.*.*` 形式のベアなタグ（例: `v1.0.1`）でGitHub Releaseを作成します — Releaseページでタグを指定するだけでよく、別途 `git tag` をpushする必要はありません。タグにはどのパッケージが対象か含まれないため、**Releaseの本文にどのパッケージが変更されたかを明記してください**（RELEASE_TEMPLATE.mdの各項目にその記載欄があります）。
4. Releaseを公開すると `.github/workflows/release.yml` がトリガーされ、`packages/*` の全パッケージを走査してローカルの `package.json` バージョンとnpm上の公開済みバージョンを比較し、差分があるパッケージだけ `npm publish` を実行します（Trusted Publishing経由、トークン不要）。バージョンが変わっていないパッケージには手を付けないため、1回のReleaseで複数パッケージのバージョンアップをまとめて扱えます。

なお、バージョンの更新を忘れた場合、手順4は何も publish せずに（`::warning::` を出して）正常終了します。また npm は同一バージョンの再 publish を許さないため、公開後に問題が見つかった場合はパッチ版を切り直すことになります。

Claude Code を使用している場合、上記を代行しつつこれらの罠を防ぐスキルが `.claude/skills/` にあります。`/shelfit-release-draft <package>@<version>` が手順1〜3（バージョン更新＋lockファイル追従、リリースPR、**ドラフト** Release の作成。この時点では何も公開されません）を、`/shelfit-publish` がPRマージ後の手順4（ローカルでの lint/test、npm上のバージョンと差分があるかのドライチェック、ドラフト Release の公開）を担当します。詳細はリポジトリルートの `CLAUDE.md` を参照してください。上記の手作業手順が正であり、スキルはそれをなぞるだけです。

## バグ報告・機能リクエスト

Issueテンプレートを使用してください — このCLIが依存するEAS APIは非公式かつ非文書化のため、実際に重要な詳細（Nodeのバージョン、`expo-shelfit --version`、トークンの種類）を尋ねる内容になっています。

## セキュリティに関する問題

公開Issueを作成しないでください。[SECURITY.md](./SECURITY.md) を参照してください。

---
name: shelfit-publish
description: リリース PR を main にマージした後に実行する公開スキル。ローカルで npm ci・lint・test を release.yml と同じ順に流し、各パッケージの package.json と npm 上のバージョンを比較するドライチェックを行った上で、ドラフト Release を公開して npm publish を発火させ、反映を確認する。使用例: /shelfit-publish
hint: main ブランチ上で実行してください。gh CLI が認証済みであることを確認してください（gh auth status）。Release の公開は不可逆です。
tools: Bash, Read
allowed-tools:
  - Bash(git branch *)
  - Bash(git status *)
  - Bash(git fetch *)
  - Bash(git pull *)
  - Bash(git rev-parse *)
  - Bash(ls packages)
  - Bash(npm ci)
  - Bash(npm run lint)
  - Bash(npm test --workspaces --if-present)
  - Bash(npm view *)
  - Bash(gh auth status)
  - Bash(gh release list *)
  - Bash(gh release view *)
  - Bash(gh release edit *)
  - Bash(gh run list *)
  - Bash(gh run watch *)
  - Read(packages/*/package.json)
---

あなたはリリースエンジニアとして以下の手順を順番に実行します。途中でエラーが発生した場合は処理を停止してユーザーに報告してください。

> **前提**: このスキルはリポジトリルート（`CLAUDE.md` や `.claude/` がある階層）を作業ディレクトリとして実行します。本ドキュメント中のパスはすべてリポジトリルートからの相対パスです。
>
> **前提スキル**: `/shelfit-release-draft` でリリース PR とドラフト Release を作成し、その PR が `main` にマージ済みであること。

## 定数

- **GitHub リポジトリ**: `my-shelfio/shelfit`
- **本番ブランチ**: `main`

## このリポジトリ固有の前提（重要）

- **ドラフト Release の公開が唯一の不可逆点。** `.github/workflows/release.yml` は `on.release.types: [published]` で発火するため、`gh release edit --draft=false` を実行した瞬間に npm publish が走る。
- `release.yml` は `packages/*` を走査し、ローカルの `package.json` の version と `npm view <name> version` を比較して**差分があるパッケージだけ** publish する。**差分が1件もない場合は `::warning::` を出して正常終了する** — CI は緑なのに何も公開されていない、という事故が起きる。だから手順3のドライチェックを必ず行う。
- **同一バージョンの再 publish はできない。** 公開後に問題が見つかった場合は、パッチ版を切り直す（`/shelfit-release-draft <package>@<patch>` からやり直す）。
- `release.yml` の job には `environment: npm-publish` が設定されている。この environment に承認レビュアーが設定されている場合、ワークフローは承認待ちで停止する。

---

## 手順

### 1. 事前確認

```bash
git branch --show-current
git status --porcelain
gh auth status
```

- 現在のブランチが `main` でなければ停止し「`main` ブランチに切り替えてから実行してください」と伝える
- uncommitted な変更がある場合は停止し、変更内容をリストアップしてユーザーに確認を求める
- `gh auth status` が失敗した場合は停止し「`gh auth login` で認証してから実行してください」と伝える

続けて最新の `main` に同期し、リモートとの一致を確認する。

```bash
git pull origin main
git fetch origin
git rev-parse HEAD origin/main
```

`HEAD` が `origin/main` と一致しない場合は停止して報告する。

---

### 2. ローカル事前検証

`release.yml` と同じ順序で流す。ここで落ちるものは CI でも落ちる。

```bash
npm ci
npm run lint
npm test --workspaces --if-present
```

いずれかが失敗した場合は停止し、エラー内容をユーザーに報告する。**Release を公開してはいけない。**

---

### 3. 公開前ドライチェック（最重要）

`packages/` を走査し、各パッケージについてローカルの version と npm 上の version を比較する。

```bash
ls packages
```

各パッケージの `packages/<package>/package.json` を Read して `name` と `version` を取得し、npm 上の版を確認する。

```bash
npm view <name> version
```

- npm に未公開のパッケージ（`npm view` が 404）は「初回公開」として差分ありに数える
- 比較結果を表にまとめる

| パッケージ                 | ローカル | npm   | 判定         |
| -------------------------- | -------- | ----- | ------------ |
| `@my-shelfio/expo-shelfit` | 1.1.0    | 1.0.1 | ✅ 公開される |
| `@my-shelfio/other`        | 0.1.0    | 0.1.0 | ⏭️ スキップ   |

**差分が1件もない場合は、ここで停止する。**

```
❌ 公開対象がありません

すべてのパッケージのバージョンが npm 上の公開済みバージョンと一致しています。
この状態で Release を公開すると、release.yml は警告を出して正常終了し、
何も publish されないまま CI だけが緑になります。

`package.json` のバージョン更新が漏れていないか確認してください。
バージョンを上げ直す場合は `/shelfit-release-draft <package>@<version>` からやり直してください。
```

---

### 4. ドラフト Release の確認と承認取得

公開対象のドラフト Release を特定する。

```bash
gh release list --repo my-shelfio/shelfit --limit 10
gh release view <tag> --repo my-shelfio/shelfit --json tagName,isDraft,targetCommitish,body
```

- ドラフト Release が見つからない場合は停止し、`/shelfit-release-draft` を先に実行するよう伝える
- ドラフトが複数ある場合はユーザーにどれを公開するか確認する
- `isDraft` が `false`（＝すでに公開済み）の場合は停止して報告する

リリースノート本文について、以下を確認する。

- 各行頭にパッケージ名（`` `@my-shelfio/<package>`: ``）が付いているか
- 手順3で「公開される」と判定したパッケージがすべて本文に登場しているか

不足があればユーザーに指摘し、修正するか確認する。

ユーザーに次のように提示し、承認を得る:

```
⚠️ これから Release を公開します。これは不可逆な操作です。

タグ: <tag>
対象ブランチ: main（<HEAD の短縮 SHA>）

公開されるパッケージ:
  @my-shelfio/<package>: <npm 上の版> → <ローカルの版>

--- リリースノート ---
<Release 本文>
---

公開すると release.yml が発火し、上記パッケージが npm に publish されます。
同一バージョンの再 publish はできません。公開してよいですか？
```

**ユーザーの明示的な承認を得るまで、次のステップへ進んではいけない。**

---

### 5. Release の公開

```bash
gh release edit <tag> --repo my-shelfio/shelfit --draft=false
```

これにより `release: published` イベントが発火し、`.github/workflows/release.yml` が起動する。

---

### 6. ワークフローの追跡

```bash
gh run list --repo my-shelfio/shelfit --workflow=release.yml --limit 3
gh run watch <run-id> --repo my-shelfio/shelfit
```

- ワークフローが `environment: npm-publish` の承認待ちで停止している場合は、その旨とワークフローの URL をユーザーに提示し、GitHub 上で承認するよう伝える
- ワークフローが失敗した場合は、失敗したステップとログをユーザーに報告する。**同一バージョンの再 publish はできない**ため、`npm publish` まで進んで途中失敗した場合はパッチ版を切り直す方針を伝える

---

### 7. npm への反映確認

```bash
npm view <name> version
npm view <name> dist-tags
```

- 手順3で「公開される」と判定した各パッケージについて実行する
- npm レジストリへの反映には数十秒かかることがある。すぐに反映されていない場合は少し待って再確認する

---

### 8. 完了報告

```
✅ リリースを公開しました

タグ: <tag>
Release URL: <Release の URL>
ワークフロー: <run の URL>（<結論: success / 承認待ち / failure>）

npm 反映状況:
  @my-shelfio/<package>: <npm view で確認した version>（dist-tags: latest = <version>）
```

失敗時は以下を報告する:

```
❌ 公開処理が失敗しました

失敗ステップ: <ステップ名>
ログ: <抜粋>

対応方針:
同一バージョンの再 publish はできません。修正後、
`/shelfit-release-draft <package>@<次のパッチ版>` からやり直してください。
```

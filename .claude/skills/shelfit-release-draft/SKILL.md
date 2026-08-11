---
name: shelfit-release-draft
description: develop→main へのリリース PR とドラフト Release を作成する。引数に `<package>@<version>`（例: expo-shelfit@1.1.0）を必ず指定すること。複数パッケージ同時リリースはスペース区切りで指定する。package.json と package-lock.json のバージョンを更新してコミット・プッシュし、PR とリリースノートドラフトを生成する。使用例: /shelfit-release-draft expo-shelfit@1.1.0
hint: 引数に `<package>@<version>` を必ず指定してください（例: /shelfit-release-draft expo-shelfit@1.1.0）。develop ブランチ上で実行してください。このスキルは npm publish を発火しません（発火するのは /shelfit-publish のみ）。
tools: Bash, Read, Edit
allowed-tools:
  - Bash(git branch *)
  - Bash(git status *)
  - Bash(git fetch *)
  - Bash(git rev-parse *)
  - Bash(git log *)
  - Bash(git describe *)
  - Bash(git diff *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git push *)
  - Bash(ls packages)
  - Bash(npm install --package-lock-only)
  - Bash(grep *)
  - Bash(gh release list *)
  - Bash(gh pr create *)
  - Bash(gh release create *)
  - Read(packages/*/package.json)
  - Edit(packages/*/package.json)
  - Read(packages/*/test/*.mjs)
  - Edit(packages/*/test/*.mjs)
  - Read(.github/ISSUE_TEMPLATE/*.yml)
  - Edit(.github/ISSUE_TEMPLATE/*.yml)
---

あなたはリリースエンジニアとして以下の手順を順番に実行します。途中でエラーが発生した場合は処理を停止してユーザーに報告してください。

> **前提**: このスキルはリポジトリルート（`CLAUDE.md` や `.claude/` がある階層）を作業ディレクトリとして実行します。本ドキュメント中のパスはすべてリポジトリルートからの相対パスです。

## 引数

`$ARGUMENTS` に `<package>@<version>` 形式の指定が渡されます（例: `expo-shelfit@1.1.0`）。複数パッケージを同時にリリースする場合はスペース区切りで指定します（例: `expo-shelfit@1.1.0 github-shelfit@0.2.0`）。

- 引数が空の場合は「対象パッケージとバージョンを引数に指定してください（例: /shelfit-release-draft expo-shelfit@1.1.0）」と伝えて処理を停止する
- `<package>` は `packages/` 配下のディレクトリ名（npm スコープ `@my-shelfio/` は付けない）
- `<version>` は `X.Y.Z` 形式。形式が不正な場合は停止する

## 定数

- **GitHub リポジトリ**: `my-shelfio/shelfit`
- **統合ブランチ**: `develop`
- **本番ブランチ**: `main`
- **タグ形式**: `vX.Y.Z`（パッケージ名を含まないベアタグ）

## このリポジトリ固有の前提（重要）

- モノレポで `packages/*` は独立にバージョニングされるが、**Release のタグは `vX.Y.Z` 1本のみ**。どのパッケージのリリースかはリリースノート本文にしか現れない。
- `.github/workflows/release.yml` は `on.release.types: [published]` で発火する。**ドラフト Release の作成は publish を発火しない**ため、このスキルの操作はすべて可逆である（不可逆なのは `/shelfit-publish` のみ）。
- `release.yml` は各パッケージのローカル `package.json` の version と npm 上の version を比較し、**差分があるものだけ** publish する。

---

## 手順

### 1. 事前確認

```bash
git branch --show-current
git status --porcelain
git fetch origin
git rev-parse HEAD origin/develop
```

以下のいずれかに該当する場合は停止してユーザーに報告する。

| 条件                                    | 停止時のメッセージ                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| 現在のブランチが `develop` でない       | `develop` ブランチに切り替えてから実行してください                                       |
| uncommitted な変更がある                | 変更内容をリストアップし、コミットまたは退避してから実行するよう伝える                   |
| `HEAD` が `origin/develop` と一致しない | ローカルが `origin/develop` と乖離しています。`git pull origin develop` してから再実行を |

`HEAD` と `origin/develop` の一致確認は必須。ローカルが古いままバージョンを上げると、マージ済みの変更を巻き戻すコミットを作ってしまう。

---

### 2. 対象パッケージと新バージョンの確認

`packages/` を走査し、引数で指定された各パッケージについて現行バージョンを読み取る。

```bash
ls packages
```

各パッケージの `packages/<package>/package.json` を Read し、`name` と `version` を取得する。

- 指定されたパッケージが `packages/` に存在しない場合は停止し、存在するパッケージ一覧を提示する
- 新バージョンが現行バージョン以下の場合は停止して指摘する（npm は同一バージョンの再 publish を許さないため、必ず繰り上げる）

ユーザーに次のように確認する:

```
リリース対象:
  @my-shelfio/<package>: <現行バージョン> → <新バージョン>
  （複数指定時は行を追加）

タグ: v<version>

この内容でバージョンを更新してよいですか？
```

複数パッケージを同時にリリースする場合、タグは1本しか付けられないため、**どのバージョンをタグにするかを必ずユーザーに確認する**。

ユーザーの承認を得てから次のステップへ進む。

---

### 3. バージョンの更新（package-lock.json の追従を含む）

#### 3-1. package.json の更新

Edit ツールで、対象パッケージの `packages/<package>/package.json` の `version` フィールドを新バージョンに書き換える。

#### 3-2. package-lock.json の追従（必須）

```bash
npm install --package-lock-only
```

**この手順を飛ばしてはいけない。** ルートの `package-lock.json` には `packages/<package>` エントリにも `version` が記録されている。`package.json` だけ上げると lock ファイルと不整合になり、`release.yml` の `npm ci` が失敗する。

実行後、差分を確認する。

```bash
git diff --name-only
```

`packages/<package>/package.json` と `package-lock.json` の**両方**が変更されていなければ停止して報告する。

#### 3-3. バージョン文字列のハードコードの追従（必須）

`package.json` の `version` 以外にも、旧バージョン文字列をそのまま書いている箇所がないか確認する。**特に以下は既知の見落としポイント**:

- `packages/<package>/test/features/list/command.test.mjs` の `--version` 出力を検証するテスト（例: `expect(logSpy).toHaveBeenCalledWith('1.0.1')`）。実装（`src/cli.mjs`）は`package.json` の `version` をそのまま出力するだけなので、このテストの期待値を更新し忘れると `npm test` が新バージョンで確実に失敗する（CI も PR も red になる）。
- `.github/ISSUE_TEMPLATE/bug_report.yml` の `cli-version` フィールドの `placeholder`（例: `"1.0.1"`）。テスト失敗には繋がらないが、Issue テンプレートの例示が古いままになる。

```bash
grep -rn "<現行バージョン>" packages/<package>/test .github/ISSUE_TEMPLATE
```

ヒットした箇所は Edit で新バージョンに書き換える。無関係な一致（たまたま同じ数字列）でないか目視で確認してから書き換えること。何もヒットしなければこのステップは何もせず次へ進む。

#### 3-4. コミット＆プッシュ

```bash
git add packages/<package>/package.json package-lock.json
# 3-3 で変更したファイルがあればここに追加する
git commit -m "chore(release): @my-shelfio/<package> v<version>"
git push origin develop
```

複数パッケージの場合はコミットメッセージにすべて列挙する（例: `chore(release): @my-shelfio/expo-shelfit v1.1.0, @my-shelfio/github-shelfit v0.2.0`）。

---

### 4. コミット一覧の取得と分類

```bash
git log origin/main..develop --oneline
git log origin/main..develop --oneline --merges
git log origin/main..develop --name-only --pretty=format:"---%h %s"
```

#### 4-0. PR 番号は「マージコミット」からのみ取得する（必須）

**コミット件名中の `(#NN)` を PR 番号として使ってはいけない。** このリポジトリでは feature ブランチを
`feat/<issue番号>` のように issue 番号で命名する慣習があり、`feat(#85): ...` のようなコミット件名の
`#NN` は**そのコミットが属する issue の番号**であって、そのコミット群を実際に `develop` へマージした
PR の番号ではないことが多い（例: `feat(#85): --local で...` を含む一連のコミットは issue #85 に対応す
るが、実際にマージした PR は別番号）。取り違えるとリリースノートのリンクが無関係な issue/PR を指す。

実際の PR 番号は `git log origin/main..develop --oneline --merges` に出てくる
`Merge pull request #NN from my-shelfio/<branch>` の行からのみ取得する。手順:

1. `--merges` の出力で PR 境界（マージコミットとその PR 番号）を一覧化する。
2. `--oneline`（全体）の出力で、各マージコミットの直下から次のマージコミットの直前までに並ぶ非マージコミットを、そのマージコミットの PR 番号に属するグループとして束ねる。
3. マージコミットを介さず `develop` に直接 push されたコミット（該当すれば）は対応する PR が無いため、番号を付けない。

**同一 PR に属する複数コミットは、リリースノート上は1本の項目に統合する。** コミットメッセージをそのまま
並べず、その PR 全体で何が変わったかを簡潔な日本語でまとめる（例: 同じ PR に feat コミットと、その実装
を仕上げる fix コミットが両方含まれる場合、分けずに Features 側の1項目にまとめてよい）。

#### 4-1. 分類

グループ化したコミット群を**2軸**で分類する。

**軸1: コミットプレフィックス**（グループ内に複数の種類が混在する場合は、グループ全体を代表する変更内
容で分類する）

| プレフィックス                            | リリースノートの分類 |
| ----------------------------------------- | -------------------- |
| `feat:`                                   | 🚀 Features           |
| `fix:`                                    | 🐛 Bug Fixes          |
| `perf:`                                   | 📈 Performance        |
| `<type>!:` / `BREAKING CHANGE` を含むもの | 🚨 Breaking Changes   |
| `docs:` / `chore:` / `refactor:` / test   | Notes（または省略）  |

**軸2: 変更パスから判定したパッケージ**

各コミットの変更ファイルパスが `packages/<package>/` 配下なら、そのパッケージの変更として扱う。ルート直下や `.github/` のみの変更はリポジトリ全体の変更として扱い、原則リリースノートには載せない（載せる場合はパッケージ名を付けられないため Notes に回す）。

手順3で作った `chore(release):` コミットはリリースノートから除外する。
コミットメッセージのプレフィックスは除去する。末尾に付ける PR 番号は、必ず 4-0 で特定した**実際にマージした PR の番号**を使う。

---

### 5. 直前タグの取得

`Full Changelog` のリンクに使う直前タグを取得する。

```bash
gh release list --repo my-shelfio/shelfit --limit 5
git describe --tags --abbrev=0
```

- 直前タグが取得できた場合: `https://github.com/my-shelfio/shelfit/compare/<previous_tag>...v<version>`
- タグが1つも存在しない（初回リリース）場合: `https://github.com/my-shelfio/shelfit/commits/v<version>`

---

### 6. リリース PR の作成

`.github/pull_request_template.md` に従って PR を作成する。

```bash
gh pr create \
  --repo my-shelfio/shelfit \
  --base main \
  --head develop \
  --title "release: @my-shelfio/<package> v<version>" \
  --body "$(cat <<'PRBODY'
## Summary

<リリース内容の要約。どのパッケージがどのバージョンに上がるかを明記する>

## Changes

<手順4で分類・統合したコミット一覧。各行頭にパッケージ名を付ける。PR 番号を付ける場合は 4-0 で特定した実際のマージ PR 番号を使う（コミット件名中の `(#NN)` は issue 番号であり流用しない）>

-

## Verification

- [ ] `node packages/<package>/bin/cli.mjs --help` / `--version` works (e.g. `packages/expo-shelfit`)
- [ ] If CLI behavior changed: `EXPO_TOKEN` unset and an invalid option both exit non-zero
- [ ] If `package.json` / `files` changed: `npm pack --dry-run` output still looks correct
- [ ] README updated, if user-facing behavior changed

## Related issues

<リリースに含まれる issue の Closes 行。無ければ省略>

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

Verification チェックリストは、手順4で判定した変更内容に照らして**実際に確認できた項目だけ**チェックを入れる。確認していない項目を勝手にチェックしない。該当しない項目はチェックせずに行末へ `(N/A)` を付ける。

タイトルは複数パッケージの場合 `release: @my-shelfio/expo-shelfit v1.1.0, @my-shelfio/github-shelfit v0.2.0` のように列挙する。

---

### 7. リリースノートの確認とドラフト Release の作成

`.github/RELEASE_TEMPLATE.md` に従ってリリースノートを整形する。

```markdown
## 🚀 Features

- `@my-shelfio/<package>`: <内容> (#NNN)

## 🐛 Bug Fixes

- `@my-shelfio/<package>`: <内容> (#NNN)

## 📈 Performance

- `@my-shelfio/<package>`: <内容> (#NNN)

## 🚨 Breaking Changes

- `@my-shelfio/<package>`: <内容> (#NNN)

## Notes

<任意。移行手順・既知の問題など。無ければセクションごと省略>

**Full Changelog**: https://github.com/my-shelfio/shelfit/compare/<previous_tag>...v<version>
```

- **各行頭に必ずパッケージ名（`` `@my-shelfio/<package>`: ``）を付ける。** タグはパッケージ名を含まないため、本文だけがパッケージとの対応を示す唯一の情報源になる。
- **`(#NNN)` は 4-0 で特定した実際のマージ PR 番号のみを使う。** コミット件名中の `(#NN)`（issue 番号であることが多い）をそのまま転記しない。PR 番号が特定できないコミット（マージコミットを介さないもの）には番号を付けない。
- 同一 PR に属する複数コミットは1行に統合し、コミットメッセージの羅列にしない
- 該当するコミットがないセクションは、セクションごと省略する
- 初回リリースの場合は `Full Changelog` を `https://github.com/my-shelfio/shelfit/commits/v<version>` に置き換える

整形したリリースノートをユーザーに提示し、修正の有無を確認する。

確認後、ドラフト Release を作成する:

```bash
gh release create "v<version>" \
  --repo my-shelfio/shelfit \
  --target main \
  --title "v<version>" \
  --notes "<確認済みのリリースノート内容>" \
  --draft
```

- `--draft` により publish は発火しない（`release.yml` は `published` のみを見る）
- `--target main` を指定する。この時点で PR は未マージなので、タグは Release 公開時に `main` の先頭に対して作成される
- 作成後、Release の URL を記録する

---

### 8. 完了報告

```
✅ リリース PR とドラフト Release を作成しました

対象:
  @my-shelfio/<package>: <旧バージョン> → <新バージョン>

タグ: v<version>（ドラフト。この時点では npm publish は発火しません）
PR URL: <作成された PR の URL>
Release URL: <作成された Release の URL>

次の手順:
1. PR をレビューして `main` にマージする
2. `main` に切り替えて `/shelfit-publish` を実行する

--- リリースノートドラフト ---
<確認済みのリリースノート内容>
```

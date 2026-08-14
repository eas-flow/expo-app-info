# expo-shelfit

[English](./README.md) | 日本語

[![npm version](https://img.shields.io/npm/v/@my-shelfio/expo-shelfit.svg)](https://www.npmjs.com/package/@my-shelfio/expo-shelfit)
[![license](https://img.shields.io/npm/l/@my-shelfio/expo-shelfit.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@my-shelfio/expo-shelfit.svg)](https://nodejs.org)

> アカウント内のすべての Expo (EAS) アプリを、プラットフォームごとの最新ビルドバージョンとともに一覧表示 — **どのディレクトリからでも**実行できます。

> **非公式です。** Expo による提供・承認を受けたものではありません。作り上げたアプリを本棚に並べて眺める、という意味を込めた名前です。

```
$ npx @my-shelfio/expo-shelfit

┌─────────┬────────────┬──────────┬────────────┬────────┬────────┬─────────────────────┬─────────────────────┬───────────────────────┐
│ ACCOUNT │ APP        │ PLATFORM │ VERSION    │ SDK    │ CLI    │ BUILD               │ SUBMIT              │ UPDATE                │
├─────────┼────────────┼──────────┼────────────┼────────┼────────┼─────────────────────┼─────────────────────┼───────────────────────┤
│ myorg   │ storefront │ ios      │ 3.2.2 (42) │ 54.0.0 │ 18.0.4 │ Errored 2026-08-10  │ Finished 2026-08-09 │ production 2026-08-12 │
│ myorg   │ storefront │ android  │ 3.2.0 (38) │ 53.0.0 │ 17.0.0 │ Finished 2026-06-30 │ In queue 2026-06-30 │ production 2026-08-12 │
│ myorg   │ prototype  │ -        │ -          │ -      │ -      │ -                   │ -                   │ -                     │
└─────────┴────────────┴──────────┴────────────┴────────┴────────┴─────────────────────┴─────────────────────┴───────────────────────┘
```

## インストール & 認証

### 📦 インストール

```bash
# npx を使う場合
npx @my-shelfio/expo-shelfit

# インストール不要。もしくは:
npm install -g @my-shelfio/expo-shelfit
expo-shelfit
```

Node.js **22以降**が必要です（この CLI はグローバルの `fetch` を使用します）。

### 🔑 認証

**`EXPO_TOKEN`** 環境変数に設定したパーソナルアクセストークン — これが唯一サポートされる認証情報です。

```bash
export EXPO_TOKEN=xxxxxxxx
npx @my-shelfio/expo-shelfit
```

[expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) で作成できます。

これは意図的に唯一の選択肢としています。トークンは `argv` から読み取られることも、ディスクに書き込まれることも、出力されることもないため、シェル履歴・プロセス一覧・置き忘れた設定ファイル・CLI自身の出力を経由して漏洩することがありません。送信先はただ1つ、EAS GraphQLエンドポイント（`https://api.expo.dev/graphql`）に、HTTPS経由で `Authorization` ヘッダーとして送信されます。`EXPO_TOKEN` が未設定の場合、CLI は非ゼロのステータスで終了します — プロンプトで待機することはなく、CI 上での実行も安全です。

> **`EXPO_API_URL`** でエンドポイントを上書きできます。これはローカルテスト用に存在するもので、この注記以外に文書化されておらず、互換性の保証対象外です。信頼できないホストを指定しないでください — そうするとトークンがそのホストに送信されてしまいます。

脆弱性を非公開で報告する方法は [SECURITY.md](../../.github/SECURITY.md)（英語のみ）を参照してください。

## 🛠️ 使い方

```bash
# ヘルプ / バージョン
npx @my-shelfio/expo-shelfit --help
npx @my-shelfio/expo-shelfit --version

# 絞り込み
npx @my-shelfio/expo-shelfit --platform ios
npx @my-shelfio/expo-shelfit --account myorg
npx @my-shelfio/expo-shelfit --app storefront

# BUILD/SUBMIT/UPDATE の日付をローカル暦日で表示
npx @my-shelfio/expo-shelfit --local

# ビルド履歴
npx @my-shelfio/expo-shelfit --history 5

# 月別集計
npx @my-shelfio/expo-shelfit --stats
npx @my-shelfio/expo-shelfit --stats --group-by app --month 1

# アカウント・メンバー情報
npx @my-shelfio/expo-shelfit --members
```

```
$ npx @my-shelfio/expo-shelfit --stats

┌──────────┬──────────────────────┬──────────┬─────────┬─────────┬──────────┬───────┬───────────────┐
│ ACCOUNT  │ PERIOD               │ PLATFORM │ SUCCESS │ ERRORED │ CANCELED │ TOTAL │ BUILD MINUTES │
├──────────┼──────────────────────┼──────────┼─────────┼─────────┼──────────┼───────┼───────────────┤
│ itokohei │ 2026-07-01 → (today) │ ios      │ 1       │ 1       │ 0        │ 2     │ 6.9           │
│ itokohei │ 2026-07-01 → (today) │ android  │ 2       │ 0       │ 0        │ 2     │ 9.4           │
└──────────┴──────────────────────┴──────────┴─────────┴─────────┴──────────┴───────┴───────────────┘
```

```
$ npx @my-shelfio/expo-shelfit --members

┌──────────┬───────────┬───────────┬──────┬─────────┬────────┬─────────────────────────────┬───────────┐
│ ORG      │ MEMBER    │ ROLE      │ PLAN │ PLAN ID │ STATUS │ CONCURRENCY (TOTAL/IOS/AND) │ TRIAL END │
├──────────┼───────────┼───────────┼──────┼─────────┼────────┼─────────────────────────────┼───────────┤
│ itokohei │ it0       │ OWNER     │ Free │ free    │ -      │ -                           │ -         │
│ itokohei │ kohei-dev │ DEVELOPER │ Free │ free    │ -      │ -                           │ -         │
│ -        │ it0       │ OWNER     │ Free │ free    │ -      │ -                           │ -         │
└──────────┴───────────┴───────────┴──────┴─────────┴────────┴─────────────────────────────┴───────────┘
```

#### 非推奨

`--usage` は `--stats` の非推奨エイリアス、`--plan` は `--members` の非推奨エイリアスです。どちらも現在は動作し同じ表を出力しますが、stderr に非推奨の警告を出力し、次のメジャーバージョンで削除されます。

## 🚀 機能

- **どのディレクトリからでも、出荷状態を一目で把握したい** — （デフォルト）アカウントに紐づく全ての Expo (EAS) アプリを、アプリ×プラットフォームごとに1行で、バージョン・Expo SDK/eas-cli バージョン・最新の **BUILD**（ビルド結果）・最新の **SUBMIT**（ストア提出結果）・最新の **UPDATE**（OTA配信）を一覧表示。expo.dev の Builds / Submissions / Updates タブを行き来する必要がなくなる
- **これまでのビルド結果を確認したい** — `--history <N>` で最新の1件だけでなく、プラットフォームごとに直近 `N` 件のビルド試行を表示（SUBMIT/UPDATE はビルド試行ごとの事実ではないため、全ての行でそのプラットフォームの現在値のまま）
- **ビルド結果と時間を月単位で把握したい** — `--stats` でUTC暦月ごとの成功/エラー/キャンセルのビルド数と合計ビルド時間（`BUILD MINUTES`、キュー待ちは含まない）を集計（`--group-by app` でアプリ単位、`--month <n>` でウィンドウを拡大）
- **アカウント・メンバー・サブスクリプションを確認したい** — `--members` で組織メンバー1人につき1行（`ROLE` 付き）と、現在のサブスクリプション（プラン、プランID、ステータス、同時実行数、トライアル終了日）を表示。個人アカウントは `ORG` が `-` の1行になる

## 📚 ドキュメント

### 仕組み

`https://api.expo.dev/graphql` に対する3つの GraphQL クエリ:

1. `meActor { accounts }` — トークンが参照できるすべてのアカウント（テーブルの `ACCOUNT` 列にのみ使われる各アカウントの `displayName` を含む）
2. `account.byId(...).appsPaginated(first: 100)` — アカウントごとのアプリ、カーソルベースのページネーション
3. `app.byId(...)` に対してアプリ1つにつき1リクエスト: `builds(offset: 0, limit: $limit, filter: { platform })` でプラットフォームごとの直近 `N` 件のビルド試行（ステータスを問わない、`--history` を指定しない限り `limit` は1。`SDK`/`CLI` 列のための各ビルドの `sdkVersion`/`cliVersion` も含む）に加え、`submissions(offset: 0, limit: 1, filter: { platform })` と `updateGroups(offset: 0, limit: 1, filter: { platform })` でそのプラットフォームの最新の提出・配信を1件ずつ取得 — この3つは同じクエリ内でプラットフォームごとにエイリアスされているため、追加リクエストは発生しません。レスポンスはすべてクライアント側で `createdAt` の降順にソートされます（APIの並び順が未文書のため）

SUBMIT/UPDATE はビルド試行ごとの事実ではなく、そのプラットフォームの「現在の」出荷状態を表します — `--history` を指定しても、同じプラットフォームの全ての行は同じ SUBMIT/UPDATE の値になります。

`--stats` はステップ1〜2を再利用し、ステップ3の代わりに各アプリのビルドをページングしてクライアント側で集計します。`BUILD MINUTES` 列のために各ビルドの `metrics.buildDuration` も含みます（キュー待ちを意図的に除外する理由は FAQ を参照）。

`--members` はステップ2〜3をスキップし、アカウントごとに `account.byId(...) { subscription ownerUserActor membersPaginated }` のみを並列でクエリします — メンバー数に関わらずアカウントあたり1クエリで、1ページに収まらない組織のみさらにページングします。`ownerUserActor` は個人アカウントのときのみ非 null（実 API で確認済み）で、個人アカウントは1行（`ORG` が `-`）、組織アカウントは `membersPaginated` のメンバーごとに1行を出力します。

### さらに詳しく

- [CONTRIBUTING.md](./CONTRIBUTING.md)（英語のみ） — 開発環境のセットアップ、テスト/lint コマンド、プロジェクト構成、リリースプロセス
- [SECURITY.md](../../.github/SECURITY.md)（英語のみ） — 脆弱性報告のポリシーと、非公開で問題を報告する方法

## ❓ FAQ

**これは公式の Expo ツールですか？**

いいえ。EAS GraphQL API は**公式に文書化・バージョン管理されていません**。フィールド名は Expo 自身のオープンソースクライアント（[`eas-cli`](https://github.com/expo/eas-cli)、[`orbit`](https://github.com/expo/orbit)）から推測したものであり、予告なく変更される可能性があります。本プロジェクトは Expo による提供・承認を受けたものではありません。

**パーソナルアクセストークンの代わりにロボットトークンを使えますか？**

ロボットトークンは、それを発行したアカウントしか参照できません。所属するすべてのアカウントを一覧表示するには、パーソナルアクセストークンを使用してください。

**トークンがアカウントのアプリやビルドを読み取れない場合はどうなりますか？**

`--stats` はもはや請求スコープのフィールドを一切クエリしません — ビルド件数は各アプリのビルド履歴からクライアントサイドで算出されます。あるアカウントのアプリやビルドの取得が何らかの理由で失敗しても、そのアカウントの行は `-` 付きで出力され続け、理由は stderr に出力されます — 実行全体が失敗することはありません。

**なぜ `--members` の一部の行はプラン列で `-` と表示されるのですか？**

プランデータは請求スコープです。トークンにアカウントの請求・メンバーシップ権限がない場合、そのアカウントは1行に劣化し（`ORG` にはアカウント名が残ります — 失敗時点では個人か組織かこのCLIには判別できないため）、残りの列は `-` を表示したまま出力され、理由は stderr に出力されます。実行全体を失敗させることはありません。

**なぜ `--members` で `ORG` が `-` になる行があるのですか？**

EAS はサインアップ時に必ず個人アカウントを作成し、これは組織を持ちません — `Account.ownerUserActor` はこの個人アカウントのときだけ非 null になります（実 API で確認済み）。個人アカウントを表から除外すると、組織を持たない利用者は表が空になってしまうため、`--members` は個人アカウントも `ORG` を `-` にした1行として残し、`MEMBER`/`ROLE` にはその所有者を表示します。同じ人物が「組織のメンバー」と「個人アカウントの所有者」の2つの顔で2行に登場することがありますが、それぞれの `PLAN` 以降の列は別々の課金主体を指しています。

**なぜロボットメンバーは `MEMBER` に `(robot)` と表示されるのですか？**

ロボット（CI bot など）には人間メンバーが持つ `username` が無いため、代わりに `firstName` で識別し、`(robot)` を付けて人間の名前と混同しないようにしています。これは稀なケースのために `TYPE` 列を増やさないための工夫です。

**`SLUG` 列はどこに行きましたか？**

削除され、`APP` 列が Display name の代わりに slug を表示するようになりました。`SUBMIT`/`UPDATE` を追加するために表をこれ以上広げないための整理です。`--app` は変わらず slug と Display name の両方にマッチします。

**`BUILD` が `Finished`/`Errored`/`Canceled` 以外の値を表示した場合は？**

この3つが、実際の API でこれまでに確認できている EAS ビルドステータスのすべてです。まだ実行中・キュー中のビルド — あるいはこの非公式APIが今後導入する他のステータス — は、親しみやすいラベルの代わりに生の enum 値を小文字化して表示します。行を壊したり隠したりするよりも、そのまま見える方を優先しています。`SUBMIT` も同様のフォールバックで、確認済みの2つのステータス `Finished`/`In queue` を使います。

**なぜ `--local` は `BUILD`/`SUBMIT`/`UPDATE` の3列すべてに影響するのですか？**

3列とも同じ日付フォーマッタを使っているため、`--local` は1列だけでなく3列まとめてローカルの暦日にずれます — `--stats` の `PERIOD` と `--members` の `TRIAL END` は影響を受けず、UTCのままです。

**なぜ `BUILD MINUTES` は EAS のキュー待ち時間を含まないのですか？**

キュー待ちは EAS 側の混雑度と契約プランの同時実行数で決まるものであり、あなたのプロジェクト側の変更とは無関係です。これを混ぜると、月ごとの `BUILD MINUTES` の増減が自分の変更によるものなのか EAS の混雑によるものなのか判別できなくなります。`BUILD MINUTES` は `TOTAL` が数える FINISHED/ERRORED/CANCELED と同じビルド集合について `Build.metrics.buildDuration`（実ビルド時間）のみを合算します。時間メトリクスが取れなかった件数のビルドは合算から除外され、0分として扱われる代わりにフッターに件数として表示されます。

**`EXPO_TOKEN` がディスクに書き込まれたりログに出力されたりすることはありますか？**

ありません。`argv` から読み取られることも、ディスクに書き込まれることも、出力されることもありません。ポリシーの詳細と脆弱性を非公開で報告する方法については [SECURITY.md](../../.github/SECURITY.md)（英語のみ）を参照してください。

## 📄 ライセンス

[MIT](./LICENSE)

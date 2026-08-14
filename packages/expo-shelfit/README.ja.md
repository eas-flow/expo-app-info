# expo-shelfit

[English](./README.md) | 日本語

[![npm version](https://img.shields.io/npm/v/@my-shelfio/expo-shelfit.svg)](https://www.npmjs.com/package/@my-shelfio/expo-shelfit)
[![license](https://img.shields.io/npm/l/@my-shelfio/expo-shelfit.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@my-shelfio/expo-shelfit.svg)](https://nodejs.org)

> アカウント内のすべての Expo (EAS) アプリを、プラットフォームごとの最新ビルドバージョンとともに一覧表示 — **どのディレクトリからでも**実行できます。

> **非公式です。** Expo による提供・承認を受けたものではありません。作り上げたアプリを本棚に並べて眺める、という意味を込めた名前です。

```
$ npx @my-shelfio/expo-shelfit

┌─────────┬────────────┬────────────┬──────────┬─────────┬───────┬────────┬─────────┬──────────┬─────────────────────┐
│ ACCOUNT │ APP        │ SLUG       │ PLATFORM │ VERSION │ BUILD │ SDK    │ CLI     │ STATUS   │ BUILD DATE          │
├─────────┼────────────┼────────────┼──────────┼─────────┼───────┼────────┼─────────┼──────────┼─────────────────────┤
│ myorg   │ Storefront │ storefront │ ios      │ 3.2.2   │ 42    │ 54.0.0 │ 18.0.4  │ Errored  │ 2026/08/10-11:02:47 │
│ myorg   │ Storefront │ storefront │ android  │ 3.2.0   │ 38    │ 53.0.0 │ 17.0.0  │ Finished │ 2026/06/30-14:05:02 │
│ myorg   │ Field Ops  │ field-ops  │ ios      │ 1.4.0   │ 12    │ 52.0.0 │ 16.13.4 │ Finished │ 2026/05/28-18:40:11 │
│ myorg   │ Prototype  │ prototype  │ -        │ -       │ -     │ -      │ -       │ -        │ -                   │
└─────────┴────────────┴────────────┴──────────┴─────────┴───────┴────────┴─────────┴──────────┴─────────────────────┘
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

# ローカルタイムゾーン
npx @my-shelfio/expo-shelfit --local

# ビルド履歴
npx @my-shelfio/expo-shelfit --history 5

# 月別集計
npx @my-shelfio/expo-shelfit --stats
npx @my-shelfio/expo-shelfit --stats --group-by app --month 1

# サブスクリプションプラン
npx @my-shelfio/expo-shelfit --plan
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

#### 非推奨

`--usage` は `--stats` の非推奨エイリアスです。現在も動作し同じ表を出力しますが、stderr に非推奨の警告を出力し、次のメジャーバージョンで削除されます。

## 🚀 機能

- **どのディレクトリからでも、作ったアプリを一覧表示したい** — （デフォルト）アカウントに紐づく全ての Expo (EAS) アプリを、各ビルドの Expo SDK / eas-cli バージョンとともに一覧表示
- **これまでのビルド結果を確認したい** — `--history <N>` で最新の1件だけでなく、プラットフォームごとに直近 `N` 件のビルド試行を表示
- **ビルド結果と時間を月単位で把握したい** — `--stats` でUTC暦月ごとの成功/エラー/キャンセルのビルド数と合計ビルド時間（`BUILD MINUTES`、キュー待ちは含まない）を集計（`--group-by app` でアプリ単位、`--month <n>` でウィンドウを拡大）
- **Expoのサブスクリプションを確認したい** — `--plan` で現在のアカウントのサブスクリプション（プラン、プランID、ステータス、同時実行数、トライアル終了日）を確認

## 📚 ドキュメント

### 仕組み

`https://api.expo.dev/graphql` に対する3つの GraphQL クエリ:

1. `meActor { accounts }` — トークンが参照できるすべてのアカウント（テーブルの `ACCOUNT` 列にのみ使われる各アカウントの `displayName` を含む）
2. `account.byId(...).appsPaginated(first: 100)` — アカウントごとのアプリ、カーソルベースのページネーション
3. `app.byId(...).builds(offset: 0, limit: $limit, filter: { platform })` — プラットフォームごとの直近 `N` 件のビルド試行（ステータスを問わない、`--history` を指定しない限り `limit` は1）。`SDK`/`CLI` 列のための各ビルドの `sdkVersion`/`cliVersion` も含む。レスポンスはクライアント側で `createdAt` の降順にソートされます

`--stats` はステップ1〜2を再利用し、ステップ3の代わりに各アプリのビルドをページングしてクライアント側で集計します。`BUILD MINUTES` 列のために各ビルドの `metrics.buildDuration` も含みます（キュー待ちを意図的に除外する理由は FAQ を参照）。

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

**なぜ一部のアカウントは `--plan` の列で `-` と表示されるのですか？**

プランデータは請求スコープです。トークンにアカウントの請求権限がない場合、その行はプラン列に `-` を表示したまま出力され、理由は stderr に出力されます。実行全体を失敗させることはありません。

**`STATUS` が `Finished`/`Errored`/`Canceled` 以外の値を表示した場合は？**

この3つが、実際の API でこれまでに確認できている EAS ビルドステータスのすべてです。まだ実行中・キュー中のビルド — あるいはこの非公式APIが今後導入する他のステータス — は、親しみやすいラベルの代わりに生の enum 値を小文字化して表示します。行を壊したり隠したりするよりも、そのまま見える方を優先しています。

**なぜ `BUILD MINUTES` は EAS のキュー待ち時間を含まないのですか？**

キュー待ちは EAS 側の混雑度と契約プランの同時実行数で決まるものであり、あなたのプロジェクト側の変更とは無関係です。これを混ぜると、月ごとの `BUILD MINUTES` の増減が自分の変更によるものなのか EAS の混雑によるものなのか判別できなくなります。`BUILD MINUTES` は `TOTAL` が数える FINISHED/ERRORED/CANCELED と同じビルド集合について `Build.metrics.buildDuration`（実ビルド時間）のみを合算します。時間メトリクスが取れなかった件数のビルドは合算から除外され、0分として扱われる代わりにフッターに件数として表示されます。

**`EXPO_TOKEN` がディスクに書き込まれたりログに出力されたりすることはありますか？**

ありません。`argv` から読み取られることも、ディスクに書き込まれることも、出力されることもありません。ポリシーの詳細と脆弱性を非公開で報告する方法については [SECURITY.md](../../.github/SECURITY.md)（英語のみ）を参照してください。

## 📄 ライセンス

[MIT](./LICENSE)

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

## 🔑 認証 & 📦 インストール

まず [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) でトークンを作成します。

```bash
export EXPO_TOKEN=xxxxxxxx
```

```bash
# クイックスタート
npx @my-shelfio/expo-shelfit

# グローバルインストール
npm install -g @my-shelfio/expo-shelfit
expo-shelfit
```

Node.js **22以降**が必要です（この CLI はグローバルの `fetch` を使用します）。

**`EXPO_TOKEN`** 環境変数に設定したパーソナルアクセストークン — これが唯一サポートされる認証情報です。

- EAS GraphQL エンドポイント（`https://api.expo.dev/graphql`）へ HTTPS で送信する際の `Authorization` ヘッダーにのみ使用されます
- `argv` から読み取られることも、ディスクに書き込まれることも、出力されることもありません — シェル履歴・プロセス一覧・置き忘れた設定ファイル・CLI 自身の出力を経由して漏洩することがありません
- 未設定の場合、CLI は非ゼロのステータスで終了します

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

### 非推奨

`--usage` は `--stats` の非推奨エイリアス、`--plan` は `--members` の非推奨エイリアスです。どちらも現在は動作し同じ表を出力しますが、stderr に非推奨の警告を出力し、次のメジャーバージョンで削除されます。

## 🚀 機能

- **どのディレクトリからでも、出荷状態を一目で把握したい** — （デフォルト）アカウントに紐づく全ての Expo (EAS) アプリを、アプリ×プラットフォームごとに1行で、バージョン・Expo SDK/eas-cli バージョン・最新の **BUILD**（ビルド結果）・最新の **SUBMIT**（ストア提出結果）・最新の **UPDATE**（OTA配信）を一覧表示。expo.dev の Builds / Submissions / Updates タブを行き来する必要がなくなる
- **これまでのビルド結果を確認したい** — `--history <N>` で最新の1件だけでなく、プラットフォームごとに直近 `N` 件のビルド試行を表示。各行はその行のビルド自身の SUBMIT（ストア提出）と UPDATE（そのビルドのランタイムに配信された最新 OTA）を持ち、無ければ `-`
- **ビルド結果と時間を月単位で把握したい** — `--stats` でUTC暦月ごとの成功/エラー/キャンセルのビルド数と合計ビルド時間（`BUILD MINUTES`、キュー待ちは含まない）を集計（`--group-by app` でアプリ単位、`--month <n>` でウィンドウを拡大）
- **アカウント・メンバー・サブスクリプションを確認したい** — `--members` で組織メンバー1人につき1行（`ROLE` 付き）と、現在のサブスクリプション（プラン、プランID、ステータス、同時実行数、トライアル終了日）を表示。個人アカウントは `ORG` が `-` の1行になる

## 📚 さらに詳しく

- [CONTRIBUTING.md](./CONTRIBUTING.md)（英語のみ） — 開発環境のセットアップ、プロジェクト構成、リリースプロセス（および、そこから辿れる各表示モードの GraphQL クエリ）
- [SECURITY.md](../../.github/SECURITY.md)（英語のみ） — 脆弱性報告のポリシーと、非公開で問題を報告する方法

## ❓ FAQ

**これは公式の Expo ツールですか？**

いいえ。EAS GraphQL API は**公式に文書化・バージョン管理されていません**。フィールド名は Expo 自身のオープンソースクライアント（[`eas-cli`](https://github.com/expo/eas-cli)、[`orbit`](https://github.com/expo/orbit)）から推測したものであり、予告なく変更される可能性があります。

**パーソナルアクセストークンの代わりにロボットトークンを使えますか？**

ロボットトークンは、それを発行したアカウントしか参照できません。所属するすべてのアカウントを一覧表示するには、パーソナルアクセストークンを使用してください。

**一部のセルが `-` になるのはなぜですか？**

表示するものが無いか（ビルドが1件も無いアプリ、個人アカウントの `ORG` など）、CLI が読み取れなかったかのどちらかです。トークンに許可されていない取得（例えばプラン列は請求スコープです）があると、その行は `-` に劣化して理由が stderr に出力されます。実行全体が失敗することはありません。

**`--stats` の数値が EAS の請求と一致しないのはなぜですか？**

そもそも請求上の数値ではないためです。件数は各アプリのビルド履歴からクライアントサイドで UTC 暦月ごとに集計しており、EAS は独自のサイクルで請求します。また `BUILD MINUTES` は EAS のキュー待ち時間を含みません。キュー待ちは EAS 側の混雑度と同時実行数で決まるもので、プロジェクト側の変更とは無関係だからです。

## 📄 ライセンス

[MIT](./LICENSE)

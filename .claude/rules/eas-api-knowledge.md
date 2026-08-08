---
description: shelfit のレビュー・設計に必要な EAS GraphQL API とコードベースの前提知識。probe で確認済みの API の実挙動（filterParams 無効、billingPeriod の排他的境界など）を含む。
---

# EAS API・コードベース前提知識 <!-- omit in toc -->

設計レビュー時にこの知識を前提とする。レビュー観点そのものは [design-review.md](./design-review.md) を参照。

## アーキテクチャ（責務分担）

| ファイル         | 責務                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `bin/cli.mjs`    | エラーを exit code と表示メッセージに変換する唯一の場所                                     |
| `src/api.mjs`    | EAS GraphQL クライアント。失敗は必ず `ApiError` を throw。`console` / `process.exit` 禁止   |
| `src/cli.mjs`    | 引数パース（`parseArgs`）・`run()` / `runUsage()` のフロー。ユーザー起因の失敗は `CliError` |
| `src/format.mjs` | entries → 人間向け表示行への変換のみ（`--json`/`--csv` は issue #43 で削除済み）             |
| `src/render.mjs` | 人間向けテーブル描画のみ                                                                    |

- `createApiClient` はファクトリ（モジュール状態を持たない）。テストは `fetchImpl` をモックして分離クライアントを作る。
- 並列化は `mapWithConcurrency`（`CONCURRENCY = 8`）。新しい並列処理も同じパターンを使う。

## 認証・エントリポイント

- 認証は `EXPO_TOKEN` 環境変数のみ。argv・ディスクからは読まない（シェル履歴・プロセスリストへの漏洩防止）。この方針は変更しない。
- エンドポイントは `https://api.expo.dev/graphql`（`EXPO_API_URL` で上書き可、テスト用）。

## GraphQL API の実挙動（probe で確認済みの罠）

- **`metricsForServiceMetric` の `filterParams` は機能しない。** 何を渡しても無視され、常に合算値が返る（issue #15 で確認）。プラットフォーム別ビルド数は `usageMetrics.byBillingPeriod(...).planMetrics[].platformBreakdown` から取る。
- **`billingPeriod.end` は排他的境界**（次期間の開始瞬間、例: 7月期間の end は `2026-08-01T00:00:00Z`）。人間向け表示は `-1日` して inclusive に補正（`inclusiveEnd`）。
- **クエリ検証エラーは HTTP 400 で返る**が body に `errors[].message` がある。`gql()` は非2xxでも先に body を読み、`errors` を優先してメッセージ化する。
- **401/403** はトークン失効として専用メッセージの `ApiError`。
- **`gql()` にリトライ/バックオフは無い。** 429 も他のエラーと同じく即失敗する。
- **billing-scoped フィールド**（`subscription` / `billingPeriod` / `usageMetrics`）は billing 権限のないトークンだと該当アカウントのみ GraphQL エラー。CLI 側で捕捉して「-」表示＋stderr 警告に劣化させる（run 全体は落とさない）。
- **`builds(offset, limit, filter)` の並び順・limit 上限は明文化されていない。** 順序が必要なら client-side ソートで保証し、上限は probe で確認（issue #17 の方針）。
- ビルドのステータスは `FINISHED` のみ取得する方針（READMEの「VERSION/BUILDは意味のある値」の前提維持）。用語は「successful build」で統一。
- client-side でビルドを数えた値は、EAS 自身の請求/使用量メトリクスと一致するとは限らない（リトライの扱い等）。混在させる場合は注記必須（issue #18）。

## 出力の契約

- v1.0.0（issue #43）で `--json` / `--csv` を削除。出力は人間向けテーブルのみで、列・文言・色・間隔はどのリリースでも変更されうる（互換性の保証なし）。機械可読出力が要望として来た場合の再追加判断は design-review.md の観点1に従う（再追加は minor で可能）。
- 標準出力は結果のみ。進捗（TTY のみ）・警告は stderr。
- 日時は人間向けテーブルでは相対表記 or `YYYY-MM-DD`（UTC基準）。

## 検証・監視の仕組み

- **probe スクリプト**: `scripts/probe-usage.mjs`。スキーマの実挙動確認・ダッシュボード突き合わせに使う。新しいクエリ形状の検証もここに追加する。
- **api-canary**: `.github/workflows/api-canary.yml` が週次で本番 API に対してクエリ形状の互換性を監視。クエリを変えたら必ず追従させる。
- **バージョニング**: changesets（`.changeset/`）。リリース判断の根拠になるので major/minor/patch の判断は design-review.md 観点1に従う。

## 関連ドキュメント

- 過去の調査・設計の経緯: issue #15（filterParams）、#17（--history）、#18（--usage 暦月化）、#19（--plan）、#43（--json/--csv 削除）

# workers.dev 統合構成 Runbook（外部ドメインなし）

## 目的
`pages.dev` + `workers.dev` 分離構成をやめ、  
`https://kakeibo.zq1012noza.workers.dev` の単一Workerで
- API
- モバイル静的配信（`apps/mobile/dist`）

を同一オリジンで提供する。

## 前提
1. Cloudflareアカウントで Workers が利用可能
2. D1 `kakeibo` が利用可能
3. Google OAuth クライアント設定を編集できる

## 実装内容（コード）
1. Worker名を `kakeibo` に変更
2. Worker Assets に `../mobile/dist` を設定
3. fetchハンドラで API ルートはHonoへ、非APIルートはAssetsへ振り分け
4. SPAルートは `index.html` へフォールバック

## 事前設定（Google OAuth）
Authorized redirect URI に以下を追加:
- `https://kakeibo.zq1012noza.workers.dev/auth/google/callback`

旧URLを使っている場合は、切替確認後に削除する。

## デプロイ
```bash
./deploy.sh
```

`deploy.sh` が実行する内容:
1. D1 migration apply（remote）
2. モバイルビルド（`VITE_API_BASE_URL` は既定で `https://kakeibo.zq1012noza.workers.dev`）
3. 統合Workerデプロイ

## 動作確認
1. `https://kakeibo.zq1012noza.workers.dev/health` が `{"ok":true}` を返す
2. `https://kakeibo.zq1012noza.workers.dev/` でアプリUIが表示される
3. iOS SafariでGoogleログインできる
4. iOS ChromeでGoogleログインできる
5. `GET /auth/session` が `200` + `session.status=ready` を返す
6. `/bootstrap` と `/sync` が成功する

## 失敗時の確認ポイント
1. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` が Worker `kakeibo` 側に設定済みか
2. OAuth redirect URI が `kakeibo.zq1012noza.workers.dev` になっているか
3. `APP_ORIGIN` / `ALLOWED_ORIGINS` が `wrangler.jsonc` の `vars` と一致しているか

## 切戻し
1. 旧Workerがある場合、`VITE_API_BASE_URL` を旧URLにして再ビルド
2. OAuth redirect URI の優先を旧URLへ戻す
3. 旧Workerを再デプロイ

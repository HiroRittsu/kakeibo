# Kakeibo Web App

Cloudflare内で完結する、家族向けの家計簿Webアプリです。無料枠前提で設計します。

## 目的
- インフラはCloudflare内に収める（Workers、D1、必要ならDurable Objects）。
- Google OAuthで家族だけが使えるようにする。
- オンライン前提だが、オフライン耐性と手動同期を用意する。
- スマホ入力UIと、PCでの詳細確認（将来CSV I/O）を用意する。

## 技術構成（予定）
- フロントエンド: React + Vite（PWA想定）
- バックエンド: Cloudflare Workers + Hono
- データベース: Cloudflare D1（SQLite）
- 認証: Google OAuth + サーバーセッションCookie

## 主要要件
- 無料枠に収めるため低運用コストで進める。
- オフラインでも入力できる。
- 手動の「更新」ボタンで同期（ポーリング方式）。
- 競合検知は警告のみ（書き込みは通す、同一IDは最新更新で上書き）。
- 月替わり時に繰り越しUIを表示する。
- 月次判定のタイムゾーンは Asia/Tokyo。

## データモデル（最小）
- entries
  - id, family_id, amount, category_id, memo, occurred_at
  - created_at, updated_at
- monthly_balance
  - family_id, ym (YYYY-MM)
  - balance, is_closed, updated_at
- categories
  - id, family_id, name, type
- members
  - user_id, family_id, role

## データフロー（ツリー）
```
起動
├─ セッション確認
│  ├─ 有効
│  │  ├─ IndexedDBキャッシュ読込 -> 画面表示
│  │  └─ 初回同期: GET /entries（last_syncなしならフルフェッチ）
│  └─ 無効/なし
│     ├─ オンライン -> Google OAuth -> セッション -> キャッシュ読込 -> 初回同期
│     └─ オフライン -> オフラインモードUI -> ローカル編集のみ許可
│
新規登録（スマホ）
├─ IndexedDBに即保存（entries）
├─ outboxに追加
└─ 即送信トライ
   ├─ 成功 -> outbox削除 -> last_sync更新
   └─ 失敗 -> outbox保持（未同期表示）
│
編集
├─ IndexedDBを即更新
├─ outboxに追加（update）
└─ 即送信トライ（成功/失敗処理は同じ）
│
削除
├─ IndexedDBを即更新
├─ outboxに追加（delete）
└─ 即送信トライ（成功/失敗処理は同じ）
│
手動同期（更新ボタン）
├─ outboxを順次送信（POST/PATCH/DELETE）
├─ 競合判定（updated_at）
│  └─ 警告フラグのみ返却（同一IDは最新更新で上書き）
└─ 差分取得: GET /entries?since=last_sync
   └─ IndexedDBにマージ -> 画面更新
│
ポーリング（任意）
└─ GET /entries?since=last_sync（未設定ならフルフェッチ）-> マージ -> 画面更新
│
オフライン時
├─ すべてローカル保存 + outboxへ蓄積
└─ 再接続後、手動同期で再送
│
セッション期限切れ
├─ APIが401を返す
└─ ローカルは閲覧可（必要なら編集禁止）
   └─ 再ログイン後に同期再開
│
月替わり（繰り越し）
├─ 起動時に月変更を検知
├─ 前月のbalanceを算出
├─ 今月のbalanceを作成
└─ 繰り越し確認/調整UIを表示
│
過去月の編集
├─ 対象月のbalance再計算
└─ 以降の月のbalanceを再計算・反映
```

## 繰り越し仕様
- `monthly_balance` に月次の残高を保存する（balanceは1種、is_closedで締め判定）。
- 月替わりで繰り越しを作成し、確認/調整UIを表示する。
- 過去月の編集があれば、その月以降の残高を再計算する。

## セキュリティ（提案）
- Google OAuth + PKCE（パスワードを保持しない）。
- 家族アカウントのみ許可リスト。
- セッションCookieは HttpOnly / SameSite / Secure。
- APIの入力バリデーション（例: Zod）。
- レート制限と厳格なCORS。

## CSV（予定）
- PC画面でCSVエクスポート（将来はインポートも追加）。
- 期間指定でサーバー側にてCSV生成。

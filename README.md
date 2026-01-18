# Kakeibo Web App

Cloudflare内で完結する、家族向けの家計簿Webアプリです。無料枠前提で設計します。

## 目的
- インフラはCloudflare内に収める（Workers、D1、必要ならDurable Objects）。
- Google OAuthで家族だけが使えるようにする。
- オンライン前提だが、オフライン耐性と手動同期を用意する。
- スマホ用とPC用のUIを分けて実装する。
- スマホは入力中心、PCは詳細表示・設定・レポート・CSVを担当する。

## 技術構成（予定）
- フロントエンド（スマホ）: React + Vite（PWA想定）
- フロントエンド（PC）: React + Vite
- バックエンド: Cloudflare Workers + Hono
- データベース: Cloudflare D1（SQLite）
- 認証: Google OAuth + サーバーセッションCookie

## ディレクトリ構成（想定）
```
kakeibo/
├─ apps/
│  ├─ mobile/              # スマホUI（React + Vite）
│  ├─ pc/                  # PC UI（後で実装）
│  └─ api/                 # Workers + Hono
├─ packages/
│  └─ shared/              # 型定義/共通スキーマ/ APIクライアント
├─ docs/                   # 仕様や設計メモ
├─ .github/                # GitHub Actions
├─ README.md
└─ package.json            # workspaces
```

## 反映手順（ローカル/リモート）
### ローカル
```
npm run migrate:local --prefix apps/api
npm run dev --prefix apps/api
apps/api/node_modules/.bin/wrangler dev --test-scheduled --local --persist-to .wrangler/state
```
- 3行目は定期ルールの手動発火（起動直後に1回発火するので、ログ確認後に停止）

### リモート
```
npm run migrate:remote --prefix apps/api
npm run deploy --prefix apps/api
npm run build --prefix apps/mobile
apps/api/node_modules/.bin/wrangler pages deploy apps/mobile/dist --project-name kakeibo-mobile --commit-dirty=true
```
- Cronは `apps/api/wrangler.jsonc` の `triggers.crons` で設定（UTC基準、JSTは+9時間）

### 環境変数（API）
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` をWranglerのSecretで設定
- `APP_ORIGIN` にフロントのURLを設定（例: `https://kakeibo-mobile.pages.dev`）
- `ALLOWED_ORIGINS` にCORS許可するOriginをカンマ区切りで指定（例: `https://kakeibo-mobile.pages.dev,http://127.0.0.1:5173`）

### 環境変数（Mobile）
- `VITE_API_BASE_URL` にAPIのURLを設定（例: `https://api.zq1012noza.workers.dev`）

## 主要要件
- 無料枠に収めるため低運用コストで進める。
- オフラインでも入力できる。
- 手動の「更新」ボタンで同期（ポーリング方式）。
- 競合検知は警告のみ（書き込みは通す、同一IDは最新更新で上書き）。
- 認証はGoogle OAuth + サーバーセッションCookieで行う（SPA側にトークンは保持しない）。
- 事前にD1のホワイトリスト（メール）へ登録したアカウントのみログイン可能。
- 月替わり時に繰り越しUIを表示する。
- 定期的な収入・支出をルール登録できる。
- 明細カテゴリを追加/編集/並び替えできる。
- 明細カテゴリはPC側で統合（マージ）できる。削除は行わず、旧カテゴリは非表示にする。
- 支払い方法（クレジットカード、銀行口座、電子マネー）を管理できる。
- 週/月/年の集計と円グラフのレポートを表示できる。
- 履歴から過去明細を開き、入力画面で修正できる。
- 履歴の削除操作は提供せず、編集のみ行う。
- 共有編集ログを確認できる。
- 収入/支出は entry_type で判定し、amount は正数で保持する。
- 月次判定のタイムゾーンは Asia/Tokyo。
- スマホは入力/履歴/集計の3タブを提供し、PCは設定/レポート/CSV/監査ログを担当する。

## 画面構成
### スマホ
- 上部アイコンタブ: 入力（ホーム）、履歴、集計、残高
- 入力はカテゴリをタップして電卓入力画面へ遷移する。
- サイドメニュー: 明細カテゴリ設定、定期収入/支出、その他設定
- 個別ページ: 入力（電卓入力/編集）、カテゴリ設定、定期的な収入/支出、その他設定、残高

### PC
- 後で実装予定: 詳細表示・設定・レポート・CSV・監査ログ

## 認証/ホワイトリスト
- `/auth/google/start` → Google OAuth へリダイレクト。
- `/auth/google/callback` でユーザー情報を検証し、セッションを発行。
- `allowed_users` に登録済みのメールのみログイン可能（未登録は拒否）。
- `allowed_users.family_id` が未設定の場合は初回ログイン時に家族を作成し、オーナー権限で紐付ける。
- APIはセッションCookie必須（`SameSite=None; Secure`、ローカルは `Lax`）。
- `allowed_users` はD1に手動登録（メールは小文字）。
  - 例: `INSERT INTO allowed_users (email, role, created_at, updated_at) VALUES ('user@example.com', 'owner', datetime('now'), datetime('now'));`

## デザイン指針（スマホ）
- ダークグレーのヘッダーと、ライムグリーンのアイコンタブバーを採用する。
- 入力（ホーム）は「収支サマリー + 進捗バー + 収入/支出の切替 + カテゴリの円形グリッド」を基本構成とする。
- 入力（電卓）は「日付/時刻 + カテゴリ選択 + お店/場所 + メモ + 電卓キーパッド + 支払い方法 + 入力ボタン」を配置する。
- 入力（電卓）は収入/支出の切り替えを新規追加・編集の両方で行える。
- 支払い方法はタップごとに切り替える。
- 電卓で四則演算を使った場合は、`=` を押して計算結果を確定してから入力する。
- お店/場所とメモは保存時に `memo` へ統合して保持する（`"お店 / メモ"` の形式）。
- カテゴリの円形グリッドは固定SVGアイコンを使い、見た目を統一する。
- 履歴画面は月切替と、リスト/カレンダ/日記の切替UIを置く。リストは日付ごとに集計する。
- 集計画面はドーナツチャートとカテゴリ別の進捗バーで構成する。
- 集計画面はドーナツ/棒グラフを切り替えできる。
- 残高画面は口座種別ごとの残高リストと、設定誘導リンクを配置する。

## データモデル（概要）
- entries: 収入/支出の明細を保持する本体テーブル。
  - 主な項目: id, family_id, entry_type, amount, entry_category_id, payment_method_id
  - 付随項目: memo, occurred_at, occurred_on, recurring_rule_id, created_at, updated_at
  - `occurred_on` は日付単位（YYYY-MM-DD）で保持し、定期ルールの冪等生成に使う。
- monthly_balance: 月初の繰り越し残高を保持する。
  - 主な項目: family_id, ym (YYYY-MM), balance, is_closed, updated_at
- recurring_rules: 定期収入/支出のルールを保持する。
  - 主な項目: id, family_id, entry_type, amount, entry_category_id, payment_method_id
  - 付随項目: memo, frequency, day_of_month, holiday_adjustment, start_at, end_at, is_active
  - 付随項目: created_at, updated_at
- entry_categories: 明細の分類（家族単位で管理）。
  - 主な項目: id, family_id, name, type, icon_key, color, is_archived, merged_to_id
- payment_methods: 支払い方法（カード/銀行口座/電子マネー）。
  - 主な項目: id, family_id, name, type
- members: 家族のメンバー管理。
  - 主な項目: user_id, family_id, role
- families: 家族の基本情報。
  - 主な項目: id, name
- users: Google OAuth のユーザー。
  - 主な項目: id(google sub), email, name, avatar_url
- allowed_users: ログイン許可のホワイトリスト。
  - 主な項目: email, family_id, role
- sessions: サーバーセッション。
  - 主な項目: id, user_id, family_id, is_pending, expires_at
- oauth_states: OAuthの一時状態。
  - 主な項目: id, next_path, origin, expires_at
- audit_logs: 共有編集ログ（誰が何をしたか）。
  - 主な項目: id, family_id, actor_user_id, action, target_type, target_id
  - 付随項目: summary, created_at

## 収支区分（entry_type）
- `entry_type` は `income` / `expense` を想定する。
- `amount` は常に正数で保持し、収支の判定は `entry_type` で行う。

## 集計/レポート
- 週/月/年の集計とカテゴリ別の円グラフを表示する（スマホ側も対応）。
- 円グラフ/棒グラフ、支出/収入の切り替えを提供する。
- 集計は `entries` を基に算出し、必要に応じてサーバー側でキャッシュする。

## 定期ルール（生成仕様）
- 定期ルールはサーバー側でエントリを生成する（Cron Trigger など）。
- 生成された明細は手動入力と同じ `entries` 形式を持ち、編集ロジックを共通化する。
- 生成済みエントリは `recurring_rule_id` で追跡できるが、編集は通常の明細編集と同じ扱い。
- ルール変更時は過去のエントリを更新せず、次回発生日以降のみ新ルールを適用する。
- 休日調整は `holiday_adjustment` で持ち、週末の場合のみ前/次営業日に移動できる。
- 複数端末での重複生成を防ぐため、以下のいずれかで冪等化する。
  - 例: `UNIQUE(family_id, recurring_rule_id, occurred_on)` の制約
  - 生成前の存在確認 + トランザクションでの作成

## カテゴリ統合（PC側）
- PCの管理画面でカテゴリを「統合（マージ）」できる。
- 統合時は対象カテゴリの明細/定期ルールを新カテゴリへ付け替える。
- 旧カテゴリは `is_archived=1` で非表示とし、削除はしない。
- `merged_to_id` を保持し、古いカテゴリIDで同期された場合も新カテゴリへ寄せられるようにする。

## データフロー（ツリー）
```
起動
├─ セッション確認
│  ├─ 有効
│  │  ├─ IndexedDBキャッシュ読込（entries / monthlyBalances など） -> 画面表示
│  │  └─ 初回同期:
│  │     ├─ GET /entries（last_syncなしならフルフェッチ）
│  │     ├─ GET /entry-categories
│  │     ├─ GET /payment-methods
│  │     ├─ GET /recurring-rules
│  │     └─ GET /monthly-balances?from=YYYY-MM&to=YYYY-MM
│  └─ 無効/なし
│     ├─ オンライン -> Google OAuth（ホワイトリスト確認） -> セッション -> キャッシュ読込 -> 初回同期
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
├─ 履歴から明細を開き、入力画面で修正
├─ IndexedDBを即更新
├─ monthlyBalances をローカル再計算（対象月〜当月）
├─ outboxに追加（update）
└─ 即送信トライ（成功/失敗処理は同じ）
│
削除
├─ IndexedDBを即更新
├─ monthlyBalances をローカル再計算（対象月〜当月）
├─ outboxに追加（delete）
└─ 即送信トライ（成功/失敗処理は同じ）
│
明細カテゴリ管理
├─ 追加/編集/削除
├─ IndexedDBを即更新
├─ outboxに追加
└─ 即送信トライ（成功/失敗処理は同じ）
│
支払い方法管理
├─ 追加/編集/削除
├─ IndexedDBを即更新
├─ outboxに追加
└─ 即送信トライ（成功/失敗処理は同じ）
│
定期収入・支出（ルール）
├─ ルール登録/編集/停止
├─ IndexedDBを即更新
├─ outboxに追加
└─ 即送信トライ（成功/失敗処理は同じ）
│
手動同期（更新ボタン）
├─ outboxを順次送信（POST/PATCH/DELETE）
├─ 競合判定（updated_at）
│  └─ 警告フラグのみ返却（同一IDは最新更新で上書き）
├─ サーバー側で編集ログを記録
├─ 差分取得: GET /entries?since=last_sync
   └─ IndexedDBにマージ -> 画面更新
├─ GET /entry-categories
├─ GET /payment-methods
├─ GET /recurring-rules
└─ 月次残高取得: GET /monthly-balances?from=YYYY-MM&to=YYYY-MM
   └─ IndexedDBに保存（monthlyBalances）
│
ポーリング（任意）
└─ GET /entries?since=last_sync（未設定ならフルフェッチ）-> マージ -> 画面更新
│
レポート表示
└─ IndexedDB（entries + monthlyBalances）で集計/グラフ表示
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
├─ サーバーCronで前月のbalance再計算
├─ 今月のmonthly_balanceを作成
├─ 定期ルールから当月分をサーバー側で生成
└─ 次回同期でクライアントに反映
│
過去月の編集
├─ 対象月のbalance再計算
└─ 以降の月のbalanceを再計算・反映
```

## API別データフロー
- `GET /auth/session`
  - 目的: 既存セッションの確認
  - 入力: Cookie（`kakeibo_session`）
  - 出力: `session` / `null`
  - クライアント: ログイン画面 or 同期開始
- `GET /auth/google/start`
  - 目的: Google OAuth開始（state保存）
  - 入力: `next`, `origin`
  - 出力: Googleへ302リダイレクト
- `GET /auth/google/callback`
  - 目的: IDトークン検証、ホワイトリスト照合、セッション発行
  - 入力: `code`, `state`
  - 出力: Cookie発行 + アプリへ302（拒否時は `auth_error` 付与）
- `GET /entries`
  - 目的: 明細の同期（差分/全量）
  - 入力: `since`（任意）
  - 出力: `entries[]`
  - クライアント: IndexedDBへ保存、`last_sync`更新
- `POST /entries`
  - 目的: 新規明細の作成
  - 入力: 明細JSON
  - 出力: `entry`
  - クライアント: outbox送信 → IndexedDB反映
- `PATCH /entries/:id`
  - 目的: 明細の更新
  - 入力: 更新内容 + `if_updated_at`
  - 出力: `entry`
  - クライアント: outbox送信 → IndexedDB反映
- `DELETE /entries/:id`
  - 目的: 明細削除
  - 入力: なし
  - 出力: `ok`
  - クライアント: outbox送信 → IndexedDB反映
- `GET /entry-categories`
  - 目的: カテゴリ同期
  - 出力: `entry_categories[]`
  - クライアント: IndexedDBへ保存
- `POST /entry-categories` / `DELETE /entry-categories/:id`
  - 目的: カテゴリ作成/削除
  - クライアント: outbox送信 → IndexedDB反映
- `GET /payment-methods`
  - 目的: 支払い方法同期
  - 出力: `payment_methods[]`
  - クライアント: IndexedDBへ保存
- `POST /payment-methods` / `DELETE /payment-methods/:id`
  - 目的: 支払い方法作成/削除
  - クライアント: outbox送信 → IndexedDB反映
- `GET /recurring-rules`
  - 目的: 定期ルール同期
  - 出力: `recurring_rules[]`
  - クライアント: IndexedDBへ保存
- `POST /recurring-rules` / `PATCH /recurring-rules/:id` / `DELETE /recurring-rules/:id`
  - 目的: 定期ルール作成/更新/削除
  - クライアント: outbox送信 → IndexedDB反映
- `GET /monthly-balances?from=YYYY-MM&to=YYYY-MM`
  - 目的: 月次残高同期
  - 出力: `monthly_balances[]`
  - クライアント: IndexedDBへ保存（monthlyBalances）
- `GET /audit-logs`
  - 目的: 監査ログ取得（PC側予定）
  - 出力: `audit_logs[]`

## 繰り越し仕様
- `monthly_balance` に月次の残高を保存する（balanceは1種、is_closedで締め判定）。
- 繰り越しはサーバー側で再計算し、クライアントは取得して表示する。
- 月初のCronで「先月の再計算 + 当月の monthly_balance 作成」を行う。
- entries の作成/更新/削除時は、影響月から当月までを即時再計算する。
- 過去月の編集があれば、その月以降の残高を再計算する（is_closedは維持）。

## セキュリティ（提案）
- Google OAuth + PKCE（パスワードを保持しない）。
- 家族アカウントのみ許可リスト。
- セッションCookieは HttpOnly / SameSite / Secure。
- APIの入力バリデーション（例: Zod）。
- レート制限と厳格なCORS。

## CSV（予定）
- PC画面でCSVエクスポート（将来はインポートも追加）。
- 期間指定でサーバー側にてCSV生成。

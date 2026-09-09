# メモリ効率を重視した Tauri + React ブラウザタブ・アーキテクチャ案

## 1. 概要

本設計では、React でブラウザの外枠と論理タブを管理し、Tauri/Rust で外部 Web ページを表示する WebView のライフサイクルを管理する。

メモリ効率を確保するため、**論理タブと WebView を常時 1 対 1 にしない**。すべてのタブ情報は軽量なメタデータとして保持する一方、実際に生存させる WebView は少数に制限する。各タブを `active`、`warm`、`suspended` の 3 状態で管理し、LRU（Least Recently Used）戦略によって長時間使われていないタブの WebView を破棄する。

推奨構成は次のとおりである。

> **Tauri + React/Zustand + PageHost Adapter + Rust TabRuntimeManager + LRU サスペンド**

この構成により、タブを多数作成しても、メモリ使用量を「タブ総数」ではなく「同時に生存する WebView 数」におおむね依存させられる。

---

## 2. 要件

### 2.1 機能要件

- クライアント内で外部 Web ページを表示できる。
- 複数ページをタブとして追加、選択、閉じることができる。
- URL 入力、戻る、進む、再読み込みを提供できる。
- ページのタイトル、現在 URL、読み込み状態をタブ UI に反映できる。
- タブをグループに所属させられる。
- グループの作成、名称変更、並べ替え、折りたたみ、一括操作に拡張できる。
- アプリ終了後にタブ、グループ、選択状態を復元できる。
- `target="_blank"` や新規ウィンドウ要求を、新しいアプリ内タブとして扱える。

### 2.2 非機能要件

- タブ数が増えても WebView 数を固定上限以内に抑える。
- アクティブタブの操作感を優先し、直近タブは素早く再表示する。
- React のタブ UI と、Tauri 固有の WebView API を疎結合にする。
- 外部ページに Tauri のネイティブ権限を公開しない。
- OS ごとの WebView 差異を局所化し、将来 Electron 等へ移行可能にする。
- WebView の生成、破棄、イベント通知が競合しても状態を壊さない。

### 2.3 初期スコープ外

- Chrome と同等の完全なセッション復元
- WebView 内の任意の JavaScript ヒープやフォーム状態の永続化
- 拡張機能互換、Chrome プロファイル互換、完全な DevTools 統合
- OS 間での完全に同一なレンダリングおよびサイト互換性

---

## 3. 設計原則

1. **論理タブと表示ランタイムを分離する**  
   タブは常に存在できるが、対応する WebView は必要な間だけ存在する。

2. **React はブラウザの外枠に集中する**  
   タブバー、グループ、アドレスバー、状態表示、ユーザー操作を担当する。

3. **Rust は WebView の実体とライフサイクルを所有する**  
   作成、表示、非表示、破棄、遷移、上限管理を一元化する。

4. **ランタイム状態の最終的な正は Rust に置く**  
   React は表示用の状態をミラーするが、WebView が実在するかどうかは `TabRuntimeManager` が決定する。

5. **描画バックエンドを Adapter の背後に隠す**  
   React から Tauri API を直接呼び散らかさず、`PageHost` 経由に限定する。

6. **外部 Web ページを信頼しない**  
   Browser Shell とリモート WebView の権限境界を明確に分ける。

---

## 4. 推奨アーキテクチャ

```text
┌──────────────────────────────────────────────────────┐
│ React Browser Shell                                  │
│                                                      │
│ TabBar / TabGroup / AddressBar / Navigation Controls │
│                         │                            │
│                         ▼                            │
│ Zustand WorkspaceStore                               │
│ tabs / groups / tabOrder / activeTabId / UI state    │
└─────────────────────────┬────────────────────────────┘
                          │ PageHost API / events
                          ▼
┌──────────────────────────────────────────────────────┐
│ PageHost Adapter                                     │
│ create / close / activate / navigate / suspend       │
│ reload / back / forward / resize / event subscription│
└─────────────────────────┬────────────────────────────┘
                          │ Tauri command + event
                          ▼
┌──────────────────────────────────────────────────────┐
│ Rust TabRuntimeManager                               │
│                                                      │
│ Runtime registry       LRU index       Policy        │
│ HashMap<TabId, Runtime> lastActiveAt    maxLiveViews │
│                                                      │
│ active: WebView 表示                                 │
│ warm: WebView 非表示                                 │
│ suspended: WebView なし                              │
└─────────────────────────┬────────────────────────────┘
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
           Child WebView A   Child WebView B ...
```

### データフロー例：タブ切り替え

```text
ユーザーが Tab B を選択
  → Zustand が選択要求を発行
  → PageHost.activate(Tab B)
  → Rust が Tab B の WebView 有無を確認
      ├─ 存在する: show + focus
      └─ 存在しない: LRU 枠確保 → WebView 再生成 → URL 復元
  → 旧 active を warm に変更
  → Rust が確定状態をイベント通知
  → Zustand が active/warm/suspended 表示を更新
```

重要なのは、UI が先に「選択中」を表示する楽観的更新は可能でも、WebView の生成失敗や遷移拒否を考慮し、最終状態を Rust のイベントで確定することである。

---

## 5. React / Zustand の責務

React は WebView オブジェクトを保持せず、論理モデルと UI を担当する。

### 5.1 管理対象

- タブの ID、URL、タイトル、favicon 情報
- タブの表示順、固定状態、グループ所属
- アクティブタブ ID
- グループの名称、色、順序、折りたたみ状態
- 読み込み中、エラー、音声再生などの UI 用メタデータ
- セッション復元に必要な URL、スクロール位置、独自履歴
- Rust から通知されたランタイム状態の表示用ミラー

### 5.2 データモデル例

```ts
type TabId = string;
type TabGroupId = string;

type TabRuntimeState = "active" | "warm" | "suspended";

type BrowserTab = {
  id: TabId;
  groupId: TabGroupId | null;
  title: string;
  url: string;
  faviconUrl?: string;
  pinned: boolean;
  loading: boolean;
  runtimeState: TabRuntimeState;
  lastActiveAt: number;
  scrollPosition?: { x: number; y: number };
  restoreError?: string;
};

type TabGroup = {
  id: TabGroupId;
  title: string;
  color?: string;
  collapsed: boolean;
  order: number;
};

type WorkspaceState = {
  tabs: Record<TabId, BrowserTab>;
  groups: Record<TabGroupId, TabGroup>;
  tabOrder: TabId[];
  activeTabId: TabId | null;
};
```

### 5.3 Zustand の Action 例

```ts
type WorkspaceActions = {
  addTab(url: string, groupId?: TabGroupId): Promise<TabId>;
  closeTab(tabId: TabId): Promise<void>;
  activateTab(tabId: TabId): Promise<void>;
  moveTab(tabId: TabId, groupId: TabGroupId | null): void;
  reorderTabs(order: TabId[]): void;
  createGroup(title: string): TabGroupId;
  closeGroup(groupId: TabGroupId): Promise<void>;
  applyRuntimeEvent(event: PageHostEvent): void;
};
```

非同期処理は React コンポーネントに置かず、Action またはユースケース層に集約する。これにより、`Tab` コンポーネントは `onClick` と `onClose` を発火するだけの単純な UI にできる。

### 5.4 React 側に置かないもの

- Tauri の `Webview` インスタンス
- 生存 WebView の上限判定
- LRU 退避対象の最終決定
- WebView の show/hide/close の直接呼び出し
- 外部ページに対するネイティブ権限

---

## 6. PageHost Adapter

`PageHost` は React と描画バックエンドの契約である。Tauri 固有の command 名やイベント形式を UI から隠す。

```ts
interface PageHost {
  create(tabId: TabId, url: string): Promise<void>;
  close(tabId: TabId): Promise<void>;
  activate(tabId: TabId): Promise<void>;
  suspend(tabId: TabId): Promise<void>;

  navigate(tabId: TabId, url: string): Promise<void>;
  reload(tabId: TabId): Promise<void>;
  goBack(tabId: TabId): Promise<void>;
  goForward(tabId: TabId): Promise<void>;

  setContentBounds(bounds: PageBounds): Promise<void>;
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>;
  subscribe(listener: (event: PageHostEvent) => void): () => void;
}
```

イベントには、少なくとも以下を用意する。

```ts
type PageHostEvent =
  | { type: "runtime-changed"; tabId: TabId; state: TabRuntimeState }
  | { type: "url-changed"; tabId: TabId; url: string }
  | { type: "title-changed"; tabId: TabId; title: string }
  | { type: "load-started"; tabId: TabId }
  | { type: "load-finished"; tabId: TabId }
  | { type: "new-window-requested"; tabId: TabId; url: string }
  | { type: "page-crashed"; tabId: TabId; reason?: string }
  | { type: "operation-failed"; tabId: TabId; operation: string; message: string };
```

この Adapter により、将来 `TauriPageHost` を `ElectronPageHost` に差し替えても、React/Zustand のタブおよびグループ実装を大部分維持できる。

---

## 7. Rust `TabRuntimeManager`

Rust 側は WebView ランタイムの所有者であり、React から届く操作を直列化して実行する。

### 7.1 主な責務

- WebView の作成、表示、非表示、フォーカス、リサイズ、破棄
- タブ ID と WebView の対応管理
- `active`、`warm`、`suspended` の状態遷移
- `MAX_LIVE_WEBVIEWS` の厳守
- LRU 順序と最終利用時刻の更新
- URL、タイトル、ロード、新規ウィンドウ等のイベント中継
- 許可 URL、プロトコル、権限の検証
- Rust 側のスナップショットを React に提供
- 非同期イベントの競合および破棄済み WebView からの遅延イベントを無視

### 7.2 概念モデル

```rust
type TabId = String;

enum RuntimeState {
    Active,
    Warm,
    Suspended,
}

struct TabRuntime {
    state: RuntimeState,
    webview_label: Option<String>,
    current_url: String,
    last_active_at_ms: u64,
    generation: u64,
    pinned: bool,
}

struct TabRuntimeManager {
    tabs: std::collections::HashMap<TabId, TabRuntime>,
    active_tab_id: Option<TabId>,
    max_live_webviews: usize,
    warm_timeout_ms: u64,
}
```

`generation` は同一タブの WebView を再生成するたびに増やす。イベントに世代番号を関連付け、破棄済みの古い WebView から遅れて届いたイベントを無視する。

### 7.3 一貫性ルール

- `active` は同一ウィンドウ内で最大 1 件とする。
- `active` と `warm` の件数合計は `MAX_LIVE_WEBVIEWS` 以下とする。
- `suspended` は WebView を持たない。
- アクティブタブはサスペンド候補にしない。
- `pinned` は UI 上の固定とし、初期実装ではサスペンド免除にしない。免除すると固定タブ数だけで上限を使い切るためである。
- WebView の生成に失敗したタブは論理タブとして残し、エラー状態と再試行手段を UI に返す。

### 7.4 実装上の注意

タブ切り替え要求が短時間に連続した場合、古い要求の完了が新しい要求を上書きしないよう、操作シーケンス番号またはキャンセル可能なキューを用いる。最低限、`active_tab_id` を確定する直前に「現在も最新の要求か」を再確認する。

---

## 8. 3 つのランタイム状態

| 状態 | WebView | 表示 | 主な用途 | 復帰コスト |
|---|---:|---:|---|---|
| `active` | あり | 表示 | 現在操作中のタブ | なし |
| `warm` | あり | 非表示 | 直近利用したタブ | 小さい |
| `suspended` | なし | 非表示 | 長時間未使用のタブ | WebView 再生成と再読み込み |

### 8.1 `active`

- 選択中の唯一のタブ。
- WebView を表示し、フォーカスを与える。
- LRU の最終利用時刻を更新する。
- 切り替え先が確定した後、旧 active は通常 `warm` へ移る。

### 8.2 `warm`

- WebView を保持したまま非表示にする。
- DOM、JavaScript 状態、ページ内履歴を保ちやすく、再表示が速い。
- メモリを使用し続けるため、保持件数には必ず上限を設ける。
- 音声、動画、タイマー、バックグラウンド通信の扱いは別ポリシーで制御する。

### 8.3 `suspended`

- WebView を破棄し、論理タブのメタデータだけを保持する。
- URL、タイトル、最終利用時刻、必要に応じてスクロール位置や独自履歴を保存する。
- 復帰時に WebView を新規生成し、保存 URL を読み込む。
- ページ内部の JavaScript 状態、未送信フォーム、WebView 固有の戻る/進む履歴は原則として失われる。

### 8.4 状態遷移

```text
create / restore
      │
      ▼
   active ────────────────┐
      │ タブ切替          │ close
      ▼                   ▼
    warm ── LRU/timeout → suspended
      ▲                        │
      └────── activate ────────┘

どの状態からでも close → 論理タブとランタイム情報を削除
```

---

## 9. LRU サスペンド戦略と WebView 上限

### 9.1 基本ポリシー

`active` と `warm` の合計が上限を超える前に、`warm` のうち最も長く使われていないタブを `suspended` にする。

```text
MAX_LIVE_WEBVIEWS = 4

Tab A: active
Tab B: warm
Tab C: warm
Tab D: warm  ← LRU

Tab E を選択
  1. Tab D の復元メタデータを保存
  2. Tab D の WebView を破棄して suspended
  3. Tab E の WebView を生成
  4. Tab E を active、Tab A を warm にする
```

### 9.2 サスペンド判定

次のいずれかを満たす `warm` タブを候補とする。

- 新しい WebView の作成によって上限を超える。
- 最後の利用から一定時間が経過した。
- 将来、OS のメモリ圧迫通知を受けた。
- ユーザーが明示的に「タブを休止」した。

候補の中から、原則として `lastActiveAt` が最も古いものを選ぶ。音声再生中、ダウンロード中、フォーム編集中など、破棄による影響が大きいタブを保護する場合は、単純 LRU に保護フラグを加えたスコア方式に拡張する。

### 9.3 タイムアウトと上限の関係

- **上限超過時の退避は即時**に行う。
- タイムアウトは、上限未満でも不要な `warm` を減らすための補助ルールとする。
- 定期タイマーを高頻度で回さず、タブ切り替え時と低頻度の保守処理で評価する。

### 9.4 WebView Pool に関する判断

空の WebView を常設し、別タブに再割り当てする Pool は初期実装では採用しない。別 URL への再利用では、履歴、Cookie/ストレージ境界、JavaScript 状態、イベント購読、権限の残留を慎重に扱う必要があり、実装の複雑さが増すためである。

初期段階は **LRU 対象の WebView を破棄し、必要時に新規生成する**。計測によって生成コストが問題になった場合のみ、同一セッション・同一権限境界で安全に初期化できる Pool を検討する。

---

## 10. タブグループ管理

タブグループは React/Zustand の論理メタデータとして管理する。Rust/WebView 側はグループを意識しない。

```text
Workspace
├─ Group: 仕事
│  ├─ GitHub
│  ├─ Jira
│  └─ Slack
├─ Group: 調査
│  ├─ Search
│  └─ MDN
└─ Ungrouped
   └─ New Tab
```

グループ移動は `tabs[tabId].groupId` と表示順を変更するだけであり、通常は WebView の再生成を伴わない。

### 拡張可能な操作

- ドラッグ＆ドロップによる並べ替えとグループ間移動
- グループの折りたたみ、色、名称変更
- グループ単位の一括 close / reload / suspend
- グループ単位のセッション保存と復元

折りたたみは UI 状態であり、それだけを理由に即時サスペンドしない。ただし「グループを折りたたんだら非 active タブを一括休止する」という明示的な省メモリ設定は追加できる。

グループ一括 close は部分失敗を考慮し、対象 ID を固定した後で PageHost に順次または一括要求し、完了結果に基づいて Zustand を更新する。

---

## 11. セッション保存と復元

保存対象は論理状態を中心とする。

```ts
type PersistedTab = {
  id: TabId;
  groupId: TabGroupId | null;
  title: string;
  url: string;
  pinned: boolean;
  lastActiveAt: number;
  scrollPosition?: { x: number; y: number };
  navigationEntries?: string[];
  navigationIndex?: number;
};
```

アプリ起動時に全タブの WebView を一斉生成してはならない。推奨復元順は次のとおりである。

1. Zustand に全論理タブとグループを読み込む。
2. 前回の active タブだけを WebView として生成する。
3. UI のアイドル後、必要なら直近 1〜2 タブを warm として段階的に生成する。
4. 残りは `suspended` のまま維持する。

Cookie やログイン状態は WebView のデータディレクトリ／データストアの設計に依存する。タブごとに完全分離するのか、通常のブラウザ同様にプロファイル内で共有するのかを別途決定する。初期案では同一ワークスペース内で共有し、プライベートタブのみ別ストアまたは incognito 相当とする。

---

## 12. セキュリティ境界

外部ページを表示する WebView は信頼しない。Tauri API を利用できる Browser Shell と、リモート WebView を明確に分離する。

```text
┌──────────────────────────────┐
│ Local React Browser Shell    │
│ 限定された Tauri command 可 │
└──────────────┬───────────────┘
               │ 検証済み PageHost 操作
               ▼
┌──────────────────────────────┐
│ Rust command / policy layer  │
│ URL・tabId・権限を検証       │
└───────┬──────────────────────┘
        │ 制御のみ
        ▼
┌──────────────────────────────┐
│ Remote WebView               │
│ Tauri API / IPC 権限なし     │
└──────────────────────────────┘
```

### 必須方針

- Tauri Capability は Browser Shell の WebView を明示的に対象とし、リモート WebView を対象外にする。
- 外部ページに filesystem、shell、database、HTTP client、clipboard 等の権限を直接与えない。
- command 側で `tabId`、URL、スキーム、遷移先を再検証する。
- 原則として `https:` のみ許可し、`file:`、`javascript:`、`data:`、独自スキームは明示的な必要性がない限り拒否する。
- `on_navigation` と新規ウィンドウ要求を検査し、許可しない遷移を遮断する。
- 外部ブラウザ起動に渡す URL も allowlist/denylist とスキーム検証を行う。
- ダウンロード、カメラ、マイク、位置情報、通知等の権限要求は、Rust 側の一元的なユーザー許可フローを通す。
- React へ送るイベント payload は最小化し、外部ページ由来の文字列を信頼済み HTML として描画しない。
- Capability を重複付与すると権限境界が実質的に結合されるため、設定を監査する。

Tauri の公式 Capability ドキュメントでは、権限を window または webview 単位で付与・制限できる一方、複数 Capability に属する対象は権限が結合される点に注意が必要とされている。

---

## 13. Tauri と Electron の比較

| 観点 | Tauri + child WebView | Electron + WebContentsView |
|---|---|---|
| 基本ランタイム | OS のシステム WebView を利用 | Chromium と Node.js を同梱 |
| ベースラインのメモリ | 一般に抑えやすい | 一般に大きくなりやすい |
| タブ数増加への対策 | WebView 上限と LRU が必要 | WebContentsView 上限と LRU が必要 |
| レンダリング互換性 | OS により WebView エンジンが異なる | 対応 OS 間で Chromium 系に統一しやすい |
| 複数コンテンツ API | multi-webview は公式資料上 `unstable` feature の注意がある | `WebContentsView` は複数ページ配置向けの公式 API |
| ブラウザ機能の成熟度 | 必要機能を Tauri/Wry/OS 差に合わせて構築 | ナビゲーション、セッション、イベント制御が充実 |
| 配布サイズ | 小さくしやすい | 大きくなりやすい |
| セキュリティ方針 | Capability で remote WebView を権限対象外にする | Node integration 無効、context isolation と sandbox 有効が必須 |
| 適する用途 | 既存 React アプリに軽量な Web ページタブを追加 | ブラウジング自体が製品の中心で高い Chromium 互換性が必要 |

### 判断基準

次の条件では Tauri を第一候補とする。

- 既存 React アプリの移植が中心である。
- タブ付き Web ページ表示はアプリ機能の一部である。
- 常駐メモリと配布サイズを重視する。
- 対象 OS の WebView 互換性を受け入れ、実機検証できる。

次の条件では Electron も早期に評価する。

- 製品の中心が任意サイトのブラウジングである。
- Chrome 互換性が重要である。
- 複数ページ表示、セッション、ナビゲーション制御を深く作り込む。
- Tauri の multi-webview の安定性や OS 差が受け入れにくい。

ただし、どちらを選んでも WebView/WebContents を無制限に生存させればメモリは増える。**軽量化の主要因は Tauri の採用だけではなく、生存ビュー数を制限する設計である。**

---

## 14. 実装方針

### Phase 1: 最小構成

- React に TabBar、AddressBar、NavigationControls を実装する。
- Zustand に論理タブ、表示順、activeTabId を実装する。
- `PageHost` インターフェースと `TauriPageHost` を作る。
- Rust に `TabRuntimeManager` を作り、create / close / activate / navigate を実装する。
- active 1 件だけを表示し、非 active は一旦すべて suspended とする。
- URL とタイトルのイベント同期を実装する。

### Phase 2: warm と LRU

- 3 状態モデルを導入する。
- `MAX_LIVE_WEBVIEWS` と `WARM_TIMEOUT` を設定可能にする。
- タブ切り替え時の LRU 退避を実装する。
- generation または operation sequence による競合防止を導入する。
- WebView 数が常に上限以下であることをテストする。

### Phase 3: グループとセッション復元

- グループ作成、移動、折りたたみ、並べ替えを実装する。
- 論理ワークスペースを永続化する。
- 起動時は active のみ、残りは遅延復元する。
- スクロール位置と簡易ナビゲーション履歴を必要に応じて追加する。

### Phase 4: セキュリティと運用品質

- Capability 設定を webview 単位で監査する。
- URL、プロトコル、外部起動、ダウンロード、権限要求のポリシーを実装する。
- クラッシュ、ロード失敗、ハング、生成失敗からの再試行 UI を追加する。
- Windows、macOS、Linux の対象環境で代表サイトを互換性検証する。

### Phase 5: 計測による調整

- タブ数 1 / 10 / 50 / 100 のシナリオで常駐メモリを測定する。
- active ↔ warm と suspended → active の切り替え時間を測定する。
- 動画、重い SPA、ログイン済み業務アプリを含めて評価する。
- 実測値に基づき WebView 上限とタイムアウトを調整する。
- Tauri で必要な互換性や安定性を満たせない場合、同じ `PageHost` 契約で Electron の試作と比較する。

---

## 15. テスト方針

### 単体テスト

- active が常に最大 1 件である。
- live WebView 数が上限を超えない。
- LRU が最も古い warm タブを選ぶ。
- active は退避対象にならない。
- close 後の遅延イベントが Zustand を更新しない。
- WebView 生成失敗時に論理タブが失われない。

### 統合テスト

- タブの高速連打でも最終選択と表示 WebView が一致する。
- 100 タブ復元時に全 WebView が一斉生成されない。
- suspended タブが URL から復帰できる。
- `target="_blank"` が新規タブ要求に変換される。
- リモート WebView から Tauri command を呼べない。
- 不許可スキームへの遷移が拒否される。

### 性能受け入れ条件の例

- 100 論理タブでも live WebView は設定上限以下である。
- warm → active はユーザーが待ちを感じにくい時間で完了する。
- suspended → active の再生成中は、空白ではなく復元中 UI を表示する。
- 長時間操作後も破棄済み WebView やイベント購読が残留しない。

具体的なメモリ量や復帰時間の数値目標は、対象サイトと対象 OS のベースライン計測後に決める。

---

## 16. 推奨初期パラメータ

| パラメータ | 初期値 | 意図 |
|---|---:|---|
| `MAX_LIVE_WEBVIEWS` | 4 | active 1 + warm 3 を上限にする |
| `TARGET_WARM_WEBVIEWS` | 2〜3 | 直近タブの高速切り替えを維持する |
| `WARM_TIMEOUT` | 5 分 | 長時間未使用の warm を自動休止する |
| `SUSPEND_CHECK_INTERVAL` | 60 秒 | 高頻度ポーリングを避ける |
| 起動時の即時生成数 | 1 | 前回 active のみ生成する |
| 起動後の事前 warm | 最大 1〜2 | アイドル時に直近タブのみ段階生成する |
| 復元履歴 | URL + 任意の簡易履歴 | 完全なページ状態復元は初期スコープ外 |
| pinned のサスペンド免除 | しない | 固定タブによる上限占有を防ぐ |
| 許可する外部 URL | 原則 HTTPS | 危険なスキームを既定拒否する |

初期値は固定仕様ではない。特に `MAX_LIVE_WEBVIEWS` は、対象 OS、想定サイト、端末メモリ、切り替え速度の実測に基づいて調整する。低メモリ端末向けには 2〜3、高速切り替えを重視するデスクトップ向けには 4〜6 を候補とするが、無条件に増やさない。

---

## 17. 採用提案

初期実装は、次の構成で開始する。

```text
React Browser Shell
  + Zustand WorkspaceStore
  + PageHost Adapter
  + TauriPageHost
  + Rust TabRuntimeManager
  + active / warm / suspended
  + MAX_LIVE_WEBVIEWS = 4
  + LRU + 5分タイムアウト
```

この構成は、React でのタブ追加・削除・グループ管理の自由度を保ちながら、WebView の生存数を限定してメモリ消費を制御できる。さらに `PageHost` を境界にすることで、Tauri の multi-webview や OS ごとの互換性が将来の制約になった場合も、React/Zustand の設計を維持して Electron `WebContentsView` 等へ移行しやすい。

最初から完全なブラウザ復元を目指すのではなく、**URL と論理ワークスペースの確実な復元、厳格な WebView 上限、明確なセキュリティ境界**を優先し、実測に基づいて warm 件数や復元精度を段階的に高めるのが妥当である。

---

## 18. 参考資料

- [Tauri: Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri: Upgrade from Tauri 1.0（multiwebview の feature 状態を含む）](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [Tauri Rust API: WebviewBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html)
- [Electron: Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)
- [Electron: WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron: Security](https://www.electronjs.org/docs/latest/tutorial/security)

> 注: Tauri の multi-webview API、プラットフォーム別 WebView の挙動、Electron の API は更新される可能性がある。実装開始時に使用バージョンの公式ドキュメントと変更履歴を再確認すること。

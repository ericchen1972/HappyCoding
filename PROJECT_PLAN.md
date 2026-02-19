# HappyCoding 專案企劃書

## 1. 專案願景 (Project Vision)
HappyCoding 不做繁重的代碼合併工具，而是一個**極具人情味與社交能力的 AI 開發助理**。它專注於解決開發中的「決策障礙」與「溝通成本」，而非單純的語法錯誤。它是一個懂氣氛、懂上下文，甚至懂「撩妹」的虛擬隊友。

## 2. 核心哲學 (Core Philosophy)
1.  **Git 是唯一真理**: 所有的代碼版本控制、衝突解決、合併動作，依然由 Git 負責。Agent **絕對不**自動執行 `git push/pull` 或修改代碼。
2.  **邏輯與決策優先**: AI Coding 時代，語法錯誤已少見，難題在於「邏輯」與「決策」（如：選什麼框架？）。Agent 負責傳遞這些高層次的上下文。
3.  **無狀態傳輸**: WebSocket Server 不保留任何歷史資訊，僅作為即時訊息與上下文的搬運工。
4.  **零註冊，隨插即用**: 下載 extension，輸入專案名稱，一切就緒。

## 3. 主要功能 (Key Features)

### 3.1 零阻力加入體驗 (Zero-Friction Onboarding)
*   **無需註冊**: 使用者不需填寫 Email 或建立帳號。
*   **自動組隊**: 只需輸入 **專案名稱** (Project Name)，Extension 即自動透過 Git 歷史紀錄或 WebSocket 連線廣播，發掘參與同一專案的其他隊友。
*   **自動別名 (Auto-Alias)**:
    *   Agent 會根據 Git Username 自動生成一個有趣的別名 (例如：`GitMonkey` -> `CodeNinja`)。
    *   使用者也可以自行設定別名，甚至設定特殊的「稱謂」 (如：`大神`, `親愛的`).

### 3.2 智能變更通知 (Intelligent Change Notification)
*   **功能**: 當成員修改代碼時，Agent 負責「說人話」通知其他人。
*   **範例**:
    > Agent: Eric 已經改好 `xxx.php` 嘍！他主要調整了登入邏輯...
*   **邊界**: Agent 只負責通知，**由使用者自己決定**是否要拉取代碼。

### 3.3 上下文決策諮詢 (Contextual Consultation)
*   **場景**: 當用戶陷入選擇困難（例如：要用 Vue 還是 React？），需要特定隊友的建議。
*   **操作**: 用戶輸入 `問問 Judy 意見吧`。
*   **Agent 行為**:
    1.  Agent 整理當前的代碼上下文、用戶的糾結點。
    2.  將整理好的「懶人包」發送給 Judy。
    3.  Judy 收到的是一個結構清晰的問題描述，而非沒頭沒尾的求救。

### 3.4 雙模社交溝通 (Dual-Mode Communication)
這是本專案的靈魂，分為「直傳」與「代理」兩種模式。

#### A. 直傳模式 (Direct Mode)
*   **觸發**: 使用 `@` 符號。
*   **行為**: 忠實傳遞用戶的原始訊息。
*   **範例**:
    *   用戶輸入: `@judy: hey, 我終於改完了`
    *   Judy 看到: `Eric: hey, 我終於改完了`

#### B. 代理模式 (Agent Mode) - 嘴砲與交際重點
*   **觸發**: 使用自然語言指令，如 `跟 judy 說...` 或 `跟其他人說...`。
*   **行為**: Agent 根據預設的 **對象 Prompt (Persona)** 進行語氣轉換與潤飾。
*   **範例 (特定對象)**:
    *   設定: Judy 是暗戀對象，Prompt = "語氣油膩、深情、浮誇"。
    *   用戶輸入: `跟 judy 說我改完了`
    *   Judy 看到: `Agent: 親愛的 Judy, 我們家 Eric 為了妳三天沒睡，終於改完了呢 ❤️`
*   **範例 (廣播)**:
    *   設定: 全域 Prompt = "熱血動漫風"。
    *   用戶輸入: `跟其他人說～我這裡搞定了`
    *   隊員看到: `Agent: 各位夥伴！Eric 已經突破了極限，完成了他的任務！燃燒吧！`

### 3.5 虛擬 Git 協作 (Virtual Git Collaboration)
*   **功能**: 模擬 Git 流程的溝通，但不執行動作。
*   **範例**:
    *   用戶輸入: `@大家 沒問題我就丟上去嘍～`
    *   行為:這只是一則廣播訊息，提醒大家更新，Agent **不會** 真的執行 `git push`。

## 4. 技術架構 (Technical Architecture)
*   **WebSocket Server**:
    *   **Stateless**: 不存儲代碼、不存儲歷史訊息。
    *   **Role**: 純粹的訊息路由 (Router)。
*   **Client (IDE Plugin)**:
    *   **Auto Discovery**: 透過專案 ID (Project Name) 進行 P2P 或 Server-assisted 的隊友探測。
    *   **Prompt Manager**: 存儲針對不同隊友的 `Persona Prompt` (例如：對老闆要恭敬，對死黨要嘴砲)。
    *   **Context Analyzer**: 負責讀取當前編輯器狀態，生成摘要給隊友。

## 5. 使用者體驗目標 (UX Goals)
*   讓遠端協作不再只有冰冷的代碼。
*   透過 AI 的「潤飾」，讓溝通充滿樂趣（或惡搞）。
*   **零門檻**: 無需帳號密碼，下載 -> 輸入專案名 -> 開聊。
*   在不破壞現有 Git 工作流的前提下，增加資訊透明度。

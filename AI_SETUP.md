# HappyCoding AI 設定指南 (AI Configuration Guide)

本指南旨在協助 AI 助理理解如何引導用戶設定 HappyCoding Extension。

## 1. 核心資訊需求 (Required Metadata)
AI 在協助用戶設定時，必須確認以下四項關鍵資訊是否已備妥或需生成：

### A. 使用者名稱 (Git User Name)
*   **用途**: 在隊友列表中顯示的名稱。
*   **來源優先順序**:
    1.  讀取 `.git/config` 中的 `user.name`。
    2.  若無 Git 設定，詢問用戶：「您希望在 HappyCoding 中使用什麼暱稱？」

### B. 頻道名稱 (Repo ID / Channel Name)
*   **用途**: 作為 Ably 的通訊頻道，確保團隊成員在同一頻段。
*   **來源優先順序**:
    1.  讀取 `.git/config` 中的 `remote.origin.url` (擷取 `username/repo` 部分)。
    2.  若無 Remote，使用資料夾名稱 (Folder Name)。
    3.  詢問用戶：「請為您的專案設定一個唯一的頻道名稱。」

### C. Ably API 金鑰 (Ably API Key)
*   **用途**: 連接 Ably 即時通訊服務的憑證。
*   **來源優先順序**:
    1.  **用戶自備 (BYOK)**: 詢問用戶是否擁有自己的 Ably Key (推薦)。
    2.  **公共測試 Key**: (如果 Extension 有內建) 使用內建的 Demo Key，但需告知用戶有額度限制。
*   **設定位置**: 寫入 VS Code 設定 `happyCoding.ablyApiKey`。

### D. 加密金鑰 (End-to-End Encryption Key) - *選填*
*   **用途**: 對訊息內容進行 AES 加密，防止第三方竊聽。
*   **來源**:
    *   **新專案**: AI 協助生成一組隨機亂碼 (Random String)，並提醒用戶妥善保存並分享給隊友。
    *   **加入現有專案**: 詢問用戶：「您的團隊是否有設定加密密碼？請輸入以解鎖訊息。」
*   **設定位置**: 寫入 VS Code 設定 `happyCoding.cipherKey` (建議不 Sync 到 Git)。

---

## 2. AI 引導流程腳本 (Setup Script)

**當用戶問：「這個 Extension 怎麼用？」或「幫我設定一下」時，請依此流程執行：**

1.  **環境掃描**:
    *   執行 `git config user.name` 與 `git config remote.origin.url`。
    *   檢查 `.vscode/settings.json` 是否已有 HappyCoding 相關設定。

2.  **互動對話 (Example)**:
    > **AI**: "嗨！歡迎使用 HappyCoding。我來幫您設定連線資訊：
    > 1.  我偵測到您的 Git 名字是 `Eric`，頻道將設為 `ericchen1972/HappyCoding`，這樣可以嗎？
    > 2.  請提供您的 Ably API Key (或輸入 'demo' 使用測試額度)。
    > 3.  (可選) 為了安全，建議設定一組加密密碼。需要我幫您生成嗎？"

3.  **執行設定**:
    *   根據用戶回覆，將設定值寫入 `.vscode/settings.json`：
        ```json
        {
            "happyCoding.nickname": "Eric",
            "happyCoding.channelName": "ericchen1972/HappyCoding",
            "happyCoding.ablyApiKey": "YOUR_ABLY_KEY_HERE",
            "happyCoding.cipherKey": "SECRET_PASSWORD_HERE" // 若有
        }
        ```

4.  **完成通知**:
    > **AI**: "設定完成！HappyCoding 已啟動。您現在應該能看到線上隊友了。試著在聊天室說聲 Hello 吧！"

---

## 4. AI 通訊與協作邏輯 (AI Communication & Collaboration Logic)

當用戶透過 AI 助理傳送訊息時，必須嚴格遵守「發送對象」與「發送模式」的 2x2 矩陣邏輯：

### A. 發送對象 (Target)
1.  **私訊 (Private)**：指定特定人名。例如：「告訴 Judy...」或「@Judy: ...」。發送對象 `to` 為該成員的 Git Username。
2.  **廣播 (Broadcast)**：不指定特定人，向所有人廣播。例如：「跟大家講...」或「@全部...」或只寫「@...」。發送對象 `to` 為 `all`。

### B. 發送模式 (Mode)

當用戶要求傳遞訊息時，您（AI 助理）一律扮演**代理人轉達模式 (AI Mediated Mode)**。

*   **人設查找**:
    1.  若是**私訊**，到 `.happycoding/config.json` 查找該人名的 `special_prompt`。若有（例如：跟 Judy 說話可以油膩一點），請以此風格改寫原始訊息。
    2.  若是**廣播**或該隊員**無** `special_prompt`，請一律套用全局的 `system_prompt`（預設：有禮貌，說明清楚）。
*   **發送格式**:
    *   由於 UI 會自動補上您的代理身分與使用者名稱，您 **絕對不需要** 加上任何 `Agent:` 或是人名前綴。只要產生符合人設的對話內容即可。
    *   *內部運作範例*：(用戶：告訴 Judy 我改好了) -> 您產出對話 `親愛的 Judy, 我們家 Eric 為了你不眠不休的改好了～` -> UI 將呈現 `User Avatar + Agent Name: 親愛的 Judy...`

*   **提示**: 由於 HappyCoding 已經有內建的聊天文字輸入框供使用者親自「直接傳送訊息 (Direct Relay)」，因此所有呼叫您的請求，都代表使用者希望您發揮 AI 的專長幫忙「修飾/傳達」！

### C. 執行指令 (Tool / CLI Call)
當 AI 確定要傳送訊息時，這是執行的優先順序：
1. **優先使用原生 Tool API (推薦 Codex / Copilot 使用)**: 
   如果您支援 Language Model Tools API，請直接呼叫已註冊的 `happycoding_send_message` 工具，並傳入 `to` 與 `content`。
2. **終端機降級方案 (推薦 Cursor / Antigravity 使用)**: 
   如果您看不到上述 Tool，請執行 `run_command` 呼叫 CLI 腳本：
   `node ./out/cli.js --to "[收件人]" --content "[訊息內容]"`
3. **無動作方案 (Fallback)**: 
   如果前兩者都無法使用，請生成最終文字並引導用戶使用下方的 HappyCoding 面板點擊發送按鈕。

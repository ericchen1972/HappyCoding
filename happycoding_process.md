HappyCoding — extension 作業流程說明
=================================

目的
----
記錄 HappyCoding extension 的作業流程、設定結構與 AI + 使用者互動的行為規範。這個文件不會包進 extension 內，是團隊用來定義流程與 config 格式的參考。

目錄結構（執行時會建立）
--------------------------------
.happycoding/
- README.md        # 給 AI 的說明，描述需要哪些資料與如何取得
- config.json      # 儲存使用者/團隊設定

`README.md`（.happycoding/README.md）內容要告訴 AI HappyCoding 需要哪些資料。至少包含：
- Git username（若專案已有 `.git`，優先從 `.git/config` 或 `git` 指令撈取）
- repoId（同上，可從 remote url 或平台 API 拿）
- Ably APIKey
- Message encrypt/decrypt key（若不需要保密可略）

這些資料會被記錄到 `.happycoding/config.json`。

設定介面
---------
建議同時支援：
- 視窗式設定（使用者手動輸入/編輯） — 推薦作為主要方式（比較可靠、使用者可控）
- AI 幫用戶設定（可選） — AI 可協助填入可抓取的欄位或提示使用者，但最終要請使用者確認並儲存到 `config.json`。

`config.json` 結構（建議 schema）
----------------------------------
示例：

{
  "git_username": "alice",        
  "repoId": "org/repo",          
  "ably_apiKey": "key:xxxx",     
  "message_key": "optional-key-or-null",
  "system_prompt": "有禮貌，說人話",
  "team": [
    {
      "git_name": "alice",
      "nick_name": "Alice",
      "special_prompt": "親切、簡短"
    }
  ]
}

欄位說明：
- `system_prompt`：預設 system prompt（若無特殊需求，預設為「有禮貌，說人話」）
- `team`：隊員陣列，每位包含 `git_name`、`nick_name`（可選，若無則用 `git_name`）、`special_prompt`（可選，若無則 fallback 為 `system_prompt`）

啟動與 Ably 同步流程
----------------------
1. Extension 啟動時：
   - 讀取 `.happycoding/config.json`（若不存在，建立預設結構）。
   - 嘗試連上 Ably（若使用者已設定 APIKey）。
2. 取得 Ably 線上清單（或 presence 列表）。
3. 比對 Ably 清單與 `config.json` 裡的 `team`：
   - 若 Ably 出現的 `git_name` 不在 `team` 中，則自動新增一筆（`nick_name` 可暫用 `git_name`，`special_prompt` 留空）。
   - 當新成員上線時也執行同樣檢查（以防有人是新加入的）。

同步策略與衝突處理
--------------------
- 任何自動新增的隊員應標記為自動來源（方便日後人工整理）。
- 若本地 `config.json` 被手動編輯，extension 應優先尊重本地更改，並在 UI 提供合併提示。

註冊 tool 與訊息轉送範例
------------------------
目的：當使用者在對話中提到「跟 Judy 講 xxx」時，自動把訊息發給 Judy。

流程：
1. 嘗試註冊一個 tool（extension 提供 API/能力給 AI 呼叫）。
2. 當 AI 呼叫該 tool 時：
   - tool 讀取 `.happycoding/config.json` 中的 `team`，尋找 `judy`（不區分大小寫或用更嚴格的對應規則）。
   - 若找到，取出該成員的 `git_name`（或其他對應識別 id），由 extension 組織要送出的文字與 metadata，並透過 Ably 或 extension 的 msg API 發送。
3. 若無法註冊 tool（例如平台不允許或 sandbox 限制，如 Antigravity），則：
   - 把原本 tool 需要執行的步驟與必要資料記錄到 `.happycoding/README.md`（或 `TODO` 區塊），讓 AI/使用者看到該如何手動執行或授權外部服務執行。

備援與可追蹤性
----------------
- 所有自動新增或自動發送行為都應該寫入 extension 的 local log（或 event store）供查核。
- config 中的敏感資料（如 `ably_apiKey`、`message_key`）建議提供加密選項或提醒使用者不要把敏感 key 放在未加密的 config 中。

安全與隱私建議
----------------
- 明確告知使用者哪些 key 會儲存在 `.happycoding/config.json`，並提供移除/更新介面。
- 若要支援團隊共用設定，考慮把敏感值留在使用者本地，或提供安全儲存（例如 OS keychain）選項。

變更與維護
----------------
- 當流程或資料欄位改動時，更新此文件並在 `.happycoding/README.md` 加上變更日誌。

結論
------
這個流程大致可行。主要建議：以視窗式設定為主、AI 協助為輔；對敏感資料加強提示或加密選項；提供清楚的 fallback（將步驟寫入 README）以降低平台限制導致的功能中斷。

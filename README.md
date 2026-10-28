# 網站設計諮詢表

客戶填寫的靜態網站，使用 Google Apps Script 將答案寫入 Google 試算表。可直接部署到 Vercel，無需安裝套件或執行建置。

## 商家諮詢表更新

2026-10-28 更新為八項商家諮詢問題，沿用既有版面與背景素材。新增網站狀態、現有網址、素材授權、商家介紹及服務介紹，並保留聯絡資訊、風格與色調。素材授權須明確選擇，同意或不同意均可送出。

Google 接收端會保留原本九欄與既有客戶資料，在後方新增五欄。新版答案亦附於舊版備註欄，方便 Google 端尚未更新時接收；分欄保存仍需另行更新 Apps Script 部署，詳見 GOOGLE-SHEETS-SETUP.md。

## 原始程式保存

2026-10-14 打包時，現有 13 項本機測試通過。網站、圖片、Google 接收程式、測試及原有設定皆保持原樣，只新增 Vercel 部署設定及本說明。

- 原始快照：backups/source-snapshot-20261014.zip
- 逐檔 SHA-256：backups/source-snapshot-20261014.sha256.json
- ZIP SHA-256：45f4ee4cc5651f10fe0fc4878881298c3bc3597bde92aca80cca0e6cfeb35458

ZIP 內的 9 個檔案已逐一核對，與打包時的內容一致。包含原有 .openai/hosting.json 作為歷史紀錄，Vercel 不使用該設定。

## Vercel 部署

1. 在 Vercel 選 Add New Project，匯入這份 GitHub 儲存庫。
2. Root Directory 使用儲存庫根目錄，不要改成 dist。
3. Framework Preset 為 Other；建置及安裝命令留空，Output Directory 為 dist。根目錄 vercel.json 已設定這些項目。
4. 按 Deploy，完成後使用 Vercel 提供的正式網址。
5. 從無痕視窗確認客戶可以開啟正式網址。如要求登入，請在 Vercel 專案設定檢查正式環境的 Deployment Protection。

程式不需要環境變數。原有 Google 接收網址保存在 dist/config.js，已保持不變。

Vercel 僅發布 dist 內的網站檔案；ZIP 備份、測試及 Google 接收程式不會成為網站公開頁面。

## 驗證

```powershell
node --test integration.test.cjs
```

可以直接在瀏覽器開啟 dist/index.html 預覽。Google 接收程式需另外在 Apps Script 部署，詳見 GOOGLE-SHEETS-SETUP.md。

本機程式快照不代表 Google 帳號中的已部署程式副本；此備份未重新寫入試算表或修改 Google 部署。

官方設定說明：https://vercel.com/docs/project-configuration/vercel-json

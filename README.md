# TJF · Taiwan Juicy Freestyle — 花飛訓練平台 v2

FPV 飛友用的花飛訓練網站：教室（物理示範）、訓練菜單（進度紀錄）、自由練習。純靜態、不需登入、無建置步驟。

## 本機預覽
```
python3 -m http.server 8000
```
開啟 http://localhost:8000（不能直接點開 index.html，ES modules 與 `fetch` 需要 http）。

## 怎麼改關卡（v2）
文字全在 `data/lessons.json`，改完重新整理即生效：
- `guide`：基本練習指引（訓練菜單最上方）；`rules`／`weekly`：訓練規則、每週檢討；`free`：自由練習的說明
- `tiers[]`（基礎 `basic`／進階 `advanced`）→ `levels[]`：`id`、`order`（組內建議順序，不鎖關）、`title`、`demo`（對應 `js/demos.js` 的示範 id，沒有示範填 `null`）、`sim`／`real`、`tips`、`notes`、`watch`
- `variants[]`：`key`（對應示範的變體）、`kind`（`style` 飛法／`contrast` 對照）、`label`、`stages[]`（`label`、`note`）。每段的桿量比例由模擬即時算出，不寫在 json
- 加新動作（Power Loop、Matty Flip…）：在 `js/demos.js` 的 `LESSONS` 加一筆（`id`、`dur`、`variants`、`start`、`ctrl`、`stages`），再到 `lessons.json` 加對應關卡；其他程式不用改
- 舊版進度（v1）第一次讀到時自動轉成 v2，原文備份在 `fpv-trainer-progress-v1-backup`；舊匯出檔也能匯入

## 自由練習的畫面
大畫面預設是 FPV 主視角（中央準星＋左下高度／速度、右下油門），小畫面是第三人稱追尾；視角鈕可切成「第三人稱」，大小畫面對調，選擇存在設定（`freeView`）。教室示範維持第三人稱大畫面＋FPV 小畫面。
地面只是地板：停在地面時不判定觸地、姿態照常轉；只有「從空中接觸地面」且下降速度 > 2.5 m/s 或傾斜 > 60° 才算觸地（`Sim.groundHold`，只在自由練習開啟）。

## 用遙控器飛（自由練習）
1. 遙控器用 USB 接電腦，切到 **USB Joystick（HID）模式**（EdgeTX：開機選 USB Joystick）。
2. 用 Chrome／Edge 開「自由練習」，**先動一下搖桿或按個鍵**（瀏覽器的規定），面板會顯示「已連接：<裝置名稱>」。
3. 第一次必須按「校正遙控器」，照畫面七步做：搖桿放中間＋油門最低 → 油門推到最高 → Yaw 右 → Pitch 推前 → Roll 右 → 兩支搖桿各畫一圈 → 放回中間。
   - 畫面會即時顯示偵測到的軸；位移不足（<0.5）不能進下一步。
   - 每步請把其他搖桿放回原位，否則會提示「同一軸被指定給兩個通道」，要重做該步。
   - 可隨時取消，取消不會動已存的設定。校正結果存在瀏覽器，重新整理不用重做；換一支遙控器（裝置名稱不同）要重新校正。
4. 校正後遙控器優先；拔掉就自動退回鍵盤／觸控。觸控拖曳的那支搖桿以觸控為準。
5. 死區、Expo、Rate 倍率三個滑桿改了立即生效並存檔。死區與 Expo 處理搖桿值（維持 ±1）；Rate 倍率乘在送進物理的角速度上（1.5 倍 = 滿桿角速度 1.5 倍，通道條的 °/s 會跟著變），只在遙控器輸入時生效，不改 `core.js` 的常數、教室示範不受影響。
6. 自由練習從地面起飛：油門在最低時飛機停在地面，推油門離地；R 鍵或觸地後都回到地面。

預設假設 AETR 軸序（0=Roll、1=Pitch、2=油門、3=Yaw）**未在 TX15 MAX 實機驗證**，所以一定要先校正。
設定存在 `fpv-trainer-settings-v1`（進度另存 `fpv-trainer-progress-v1`，互不影響）。

## 測試
```
node --test
```

## 結構
- `js/core.js` 物理＋控制器（無 DOM）　`js/demos.js` 示範腳本　`js/view.js` 繪圖
- `js/progress.js` 進度儲存層，**唯一碰 localStorage 的檔案**（key：`fpv-trainer-progress-v1`，內容 version 2）。v2 加後端時只換這個檔。
- `js/app.js` 分頁、菜單、主迴圈

## 部署（GitHub Pages）
推到 GitHub，Settings → Pages → Deploy from a branch → `main` / `(root)`。無建置步驟。

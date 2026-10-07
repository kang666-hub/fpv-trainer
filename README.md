# 花飛訓練平台 v1

FPV 飛友用的花飛訓練網站：教室（物理示範）、訓練菜單（進度紀錄）、自由練習。純靜態、不需登入、無建置步驟。

## 本機預覽
```
python3 -m http.server 8000
```
開啟 http://localhost:8000（不能直接點開 index.html，ES modules 與 `fetch` 需要 http）。

## 怎麼改關卡
只改 `data/lessons.json`，重新整理即生效：
- `rules`／`weekly`：訓練規則、每週檢討清單
- `levels[]`：`id`、`order`、`title`、`demo`（對應 `js/demos.js` 的示範 id，沒有示範填 `null`）、`sim`／`real`（`do`、`pass`）、`tips`
- 加關卡：在 `levels` 加一筆，`order` 接續；「鎖關」依 `order` 順序判斷

## 測試
```
node --test
```

## 結構
- `js/core.js` 物理＋控制器（無 DOM）　`js/demos.js` 示範腳本　`js/view.js` 繪圖
- `js/progress.js` 進度儲存層，**唯一碰 localStorage 的檔案**（key：`fpv-trainer-progress-v1`）。v2 加後端時只換這個檔。
- `js/app.js` 分頁、菜單、主迴圈

## 部署（GitHub Pages）
推到 GitHub，Settings → Pages → Deploy from a branch → `main` / `(root)`。無建置步驟。

# 狗狗鮮食營養計算器 v2

11.5kg ACVIM B1-B2 心臟風險犬隻鮮食配方計算器。
資料源：Final.xlsx (TFDA + USDA + AAFCO 2016)

## 在線使用

https://yuyunu.github.io/dog-calc/

## 本地開發

直接打開 `index.html` 即可（不需 web server，data.js 已 inline 全部資料）。

## 重新產生資料

```bash
XLSX_PATH=path/to/Final.xlsx python3 build.py
```

會更新 `foods.json` + `standards.json` 從 xlsx 重抓。

## 檔案

- `index.html` — UI
- `styles.css` — 樣式（含暗色模式）
- `app.js` — 計算邏輯
- `data.js` — inline 資料（auto-generated）
- `foods.json` — 食材營養（71 筆）
- `standards.json` — AAFCO/NRC 標準 + 比例分析
- `build.py` — 從 xlsx 重產 JSON

## 功能

1. 狗狗基本資料（體重、活動係數）→ RER/DER 自動算
2. 食材選擇（分類、按一下加入再按刪除）
3. 乾物質基礎分析（含膳食纖維）
4. 達標儀表板（41 個營養素 vs AAFCO 標準）
5. 比例分析（11 個比例 + 過高/過低警告）
6. 食譜匯出 PDF（瀏覽器 print to PDF）
7. localStorage 自動儲存最新一筆食譜

## 免責聲明

僅供參考，實際鮮食配方建議諮詢獸醫師。

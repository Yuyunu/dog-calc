# dog-calc v2 — 規格文件

## 既有功能
1. 計算器：食材選擇、份量輸入、達標儀表板、比例分析、食譜匯出 PDF
2. 食材詳情 modal：點食譜列食材名顯示營養成分
3. 牛磺酸心臟保健分析（ACVIM B1-B2 風險）

## 新增功能 — 日誌頁面

### A. 食譜餵食日期紀錄
- 計算器頁 → 「📅 加入日誌」按鈕 → 跳 modal 設定食譜名 + 起迄日期
- 結束日期：今日 / 指定日期 / 開放（持續吃）
- 已存食譜可編輯結束日期延長（同食譜繼續吃）
- 切換新食譜：上一份自動結束（end_date = 今日 - 1）

### B. 月曆/日期日誌
- 月曆視圖（CSS grid 7×6）
- 月份切換 ← →
- 餵食日：背景淡色 highlight（每食譜一色）
- 事件日：右下角 emoji
- 點日期 → 開 day modal

### C. Day Modal
- 顯示：日期、星期、餵食食譜（含連結）、所有事件（emoji + 名稱 + 備註 + 時間）
- 「+ 新增事件」按鈕

### D. 事件按鈕（chip 樣式，分類）— 精簡版（2026-05-03）
**症狀**：🤮 嘔吐 / 💩 腹瀉 / 😶 食慾不佳
**醫療**：💉 預防針 / 🐛 吃除蟲藥
**日常**：✈️ 旅遊
**其他**：📝 其他（需自填名稱）

### E. 資料結構（localStorage `dog_calc_v2_diary`）
```js
{
  saved_recipes: [
    { id, name, ingredients: { name: portion }, created_at }
  ],
  feeding_log: [
    { id, recipe_id, start_date, end_date, color_index }
  ],
  events: [
    { id, date, type, emoji, name, note, weight_kg?, medication? }
  ]
}
```

### F. UI 整合
- Header 加 tab：📊 計算器 / 📔 日誌
- 切換用 page-calculator / page-diary section show/hide
- 計算器頁底部加「📅 加入日誌」按鈕（next to 匯出 PDF）
- 月曆/事件 chip 配色與計算器一致

### G. 互動規則
- 同一天可有多個事件
- 同一天只能對一個食譜（feeding period 不可重疊）
- 編輯食譜結束日期 → 後續餵食 period 自動 shift
- 事件 emoji 多個顯示 → 用串列，超過 3 個顯示「+N」

## 技術
- 純 CSS grid 月曆，不用 library
- 純 JS，no framework
- localStorage
- 保留 service worker network-first

## 2026-05-03 增強
- 「📅 加入日誌」可選擇現有食譜重用（不用每次新建）
- 「📆 區間填入」一鍵把同食譜套整段日期（重疊舊紀錄自動裁切）
- Day modal 食譜名稱 → 點擊自動帶入計算器並切回計算器 tab（缺名提示）
- 30 天統計區塊：事件次數降冪 + 食譜輪替天數百分比 bar
- 同 recipe_id 的所有 feeding period 共用同一個 color_index（不再亂跳色）
- 事件清單依使用者要求縮減成 7 項（嘔吐/腹瀉/食慾不佳/預防針/吃除蟲藥/旅遊/其他自訂）

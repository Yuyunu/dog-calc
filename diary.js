/* ============================================================
   diary.js — 日誌頁面 (月曆 + 食譜紀錄 + 事件)
   依賴: app.js (STATE, fmt, el, ...)
   ============================================================ */

'use strict';

const DIARY_LS_KEY = 'dog_calc_v2_diary';

const DIARY_STATE = {
  saved_recipes: [],   // {id, name, ingredients: {name: portion}, summary, created_at}
  feeding_log: [],     // {id, recipe_id, start_date, end_date, color_index}
  events: [],          // {id, date, type, emoji, name, note, weight_kg?, medication?}
  current_month: null  // {year, month}
};

// ============================================================
// Event types — 精簡版（依使用者需求；其他=自訂文字）
// ============================================================
const EVENT_TYPES = [
  // 症狀
  { type: 'vomit', emoji: '🤮', name: '嘔吐', cat: '症狀' },
  { type: 'diarrhea', emoji: '💩', name: '腹瀉', cat: '症狀' },
  { type: 'no_appetite', emoji: '😶', name: '食慾不佳', cat: '症狀' },
  // 醫療
  { type: 'vaccine', emoji: '💉', name: '預防針', cat: '醫療' },
  { type: 'deworm', emoji: '🐛', name: '吃除蟲藥', cat: '醫療' },
  // 日常
  { type: 'travel', emoji: '✈️', name: '旅遊', cat: '日常' },
  // 其他（自訂）
  { type: 'other', emoji: '📝', name: '其他（自訂）', cat: '其他', extra: 'custom_name' },
];

// ============================================================
// localStorage
// ============================================================
function loadDiary() {
  try {
    const raw = localStorage.getItem(DIARY_LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    DIARY_STATE.saved_recipes = data.saved_recipes || [];
    DIARY_STATE.feeding_log = data.feeding_log || [];
    DIARY_STATE.events = data.events || [];
  } catch (e) {
    console.warn('Diary load fail:', e);
  }
}

function saveDiary() {
  try {
    localStorage.setItem(DIARY_LS_KEY, JSON.stringify({
      saved_recipes: DIARY_STATE.saved_recipes,
      feeding_log: DIARY_STATE.feeding_log,
      events: DIARY_STATE.events
    }));
  } catch (e) {
    console.warn('Diary save fail:', e);
  }
}

// ============================================================
// Date helpers
// ============================================================
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function dateToStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function strToDate(s) {
  return new Date(s + 'T00:00:00');
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

// ============================================================
// 月曆 render
// ============================================================
function renderCalendar() {
  if (!DIARY_STATE.current_month) {
    const t = new Date();
    DIARY_STATE.current_month = { year: t.getFullYear(), month: t.getMonth() };
  }
  const { year, month } = DIARY_STATE.current_month;
  document.getElementById('cal-month-title').textContent = `${year} 年 ${month+1} 月`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month+1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Lead-in (previous month tail)
  const prevMonthLast = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    const cell = el('div', { class: 'cal-day other-month' }, [
      el('span', { class: 'cal-day-num' }, String(prevMonthLast - i))
    ]);
    grid.appendChild(cell);
  }

  // Current month
  const today = todayStr();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = dateToStr(new Date(year, month, d));
    const isToday = dateStr === today;
    const feeding = getFeedingForDate(dateStr);
    const eventsList = DIARY_STATE.events.filter(e => e.date === dateStr);

    const children = [
      el('span', { class: 'cal-day-num' }, String(d))
    ];
    if (feeding) {
      children.unshift(el('div', { class: 'cal-day-feed feed-color-' + (feeding.color_index % 8) }));
    }
    if (eventsList.length > 0) {
      const emojis = eventsList.slice(0, 3).map(e => e.emoji).join('');
      const more = eventsList.length > 3 ? `+${eventsList.length - 3}` : '';
      children.push(el('div', { class: 'cal-day-events' }, emojis + more));
    }
    const cell = el('div', {
      class: 'cal-day' + (isToday ? ' today' : ''),
      'data-date': dateStr,
      onclick: () => openDayDetail(dateStr)
    }, children);
    grid.appendChild(cell);
  }
}

// ============================================================
// 取某天的餵食食譜
// ============================================================
function getFeedingForDate(dateStr) {
  const d = strToDate(dateStr).getTime();
  for (const f of DIARY_STATE.feeding_log) {
    const start = strToDate(f.start_date).getTime();
    const end = f.end_date ? strToDate(f.end_date).getTime() : Infinity;
    if (d >= start && d <= end) return f;
  }
  return null;
}

function getRecipeById(id) {
  return DIARY_STATE.saved_recipes.find(r => r.id === id);
}

// ============================================================
// 食譜歷史 list
// ============================================================
function renderRecipeHistory() {
  const wrap = document.getElementById('recipe-history');
  wrap.innerHTML = '';
  if (DIARY_STATE.feeding_log.length === 0) {
    wrap.appendChild(el('p', { class: 'empty-state' }, '尚未加入任何食譜紀錄。先在計算器頁建好配方，再點「📅 加入日誌」'));
    return;
  }
  // sort 最新在前
  const sorted = [...DIARY_STATE.feeding_log].sort((a,b) =>
    strToDate(b.start_date) - strToDate(a.start_date));
  for (const f of sorted) {
    const recipe = getRecipeById(f.recipe_id);
    if (!recipe) continue;
    const periodText = f.end_date
      ? `${f.start_date} ~ ${f.end_date}`
      : `${f.start_date} ~ 持續中`;

    const item = el('div', { class: 'recipe-history-item' }, [
      el('div', { class: 'feed-color-strip feed-color-' + (f.color_index % 8) }),
      el('div', { class: 'rh-info' }, [
        el('div', { class: 'rh-name' }, recipe.name),
        el('div', { class: 'rh-period' }, periodText)
      ]),
      el('div', { class: 'rh-actions' }, [
        el('button', {
          class: 'btn btn-secondary btn-mini',
          type: 'button',
          onclick: () => editFeedingPeriod(f.id)
        }, '編輯'),
        el('button', {
          class: 'btn btn-danger btn-mini',
          type: 'button',
          onclick: () => deleteFeeding(f.id)
        }, '刪除')
      ])
    ]);
    wrap.appendChild(item);
  }
}

function editFeedingPeriod(id) {
  const f = DIARY_STATE.feeding_log.find(x => x.id === id);
  if (!f) return;
  const newEnd = prompt(
    `編輯結束日期（YYYY-MM-DD）\n空白 = 持續中\n目前: ${f.end_date || '持續中'}`,
    f.end_date || ''
  );
  if (newEnd === null) return;
  f.end_date = newEnd.trim() || null;
  saveDiary();
  renderCalendar();
  renderRecipeHistory();
  renderDiaryStats();
}

function deleteFeeding(id) {
  if (!confirm('確定刪除此食譜紀錄？（食譜本身不會刪除）')) return;
  DIARY_STATE.feeding_log = DIARY_STATE.feeding_log.filter(f => f.id !== id);
  saveDiary();
  renderCalendar();
  renderRecipeHistory();
  renderDiaryStats();
}

// ============================================================
// 加食譜進日誌 modal
// ============================================================
function openSaveToDiaryModal() {
  const hasCalcRecipe = Object.keys(STATE.recipe).length > 0;
  const hasSavedRecipes = DIARY_STATE.saved_recipes.length > 0;

  if (!hasCalcRecipe && !hasSavedRecipes) {
    alert('請先在計算器加入食材');
    return;
  }

  const modal = document.getElementById('diary-add-modal');
  const t = todayStr();

  // Populate "use existing recipe" dropdown
  const existingWrap = document.getElementById('diary-existing-wrap');
  const existingSel = document.getElementById('diary-existing-recipe');
  existingSel.innerHTML = '';
  if (hasCalcRecipe) {
    existingSel.appendChild(el('option', { value: '' }, '— 用目前計算器配方新建 —'));
  } else {
    existingSel.appendChild(el('option', { value: '' }, '— 請選一份既有食譜 —'));
  }
  for (const r of DIARY_STATE.saved_recipes) {
    existingSel.appendChild(el('option', { value: r.id }, r.name));
  }
  existingWrap.hidden = !hasSavedRecipes;

  // Default name
  if (hasCalcRecipe) {
    document.getElementById('diary-recipe-name').value = `配方 ${t}`;
    // Auto-summary from current calculator
    const lines = Object.values(STATE.recipe)
      .filter(item => item.portion && item.portion > 0)
      .map(item => `• ${item.food.name} ${item.portion} ${item.food.unit}`);
    document.getElementById('diary-recipe-summary').value = lines.join('\n');
  } else {
    document.getElementById('diary-recipe-name').value = '';
    document.getElementById('diary-recipe-summary').value = '';
  }

  document.getElementById('diary-start-date').value = t;
  document.getElementById('diary-end-date').value = t;
  document.getElementById('diary-end-date').disabled = true;
  document.querySelector('input[name="end-mode"][value="today"]').checked = true;

  // 切換「現有食譜 vs 新建」時自動填名稱與摘要
  existingSel.onchange = () => {
    const id = existingSel.value;
    if (!id) {
      // 還原成新建模式
      if (hasCalcRecipe) {
        document.getElementById('diary-recipe-name').value = `配方 ${t}`;
        const lines = Object.values(STATE.recipe)
          .filter(item => item.portion && item.portion > 0)
          .map(item => `• ${item.food.name} ${item.portion} ${item.food.unit}`);
        document.getElementById('diary-recipe-summary').value = lines.join('\n');
      } else {
        document.getElementById('diary-recipe-name').value = '';
        document.getElementById('diary-recipe-summary').value = '';
      }
      document.getElementById('diary-recipe-name').disabled = false;
      document.getElementById('diary-recipe-summary').disabled = false;
      return;
    }
    const r = getRecipeById(id);
    if (r) {
      document.getElementById('diary-recipe-name').value = r.name;
      document.getElementById('diary-recipe-summary').value = r.summary || '';
      document.getElementById('diary-recipe-name').disabled = true;
      document.getElementById('diary-recipe-summary').disabled = true;
    }
  };
  document.getElementById('diary-recipe-name').disabled = false;
  document.getElementById('diary-recipe-summary').disabled = false;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDiaryAddModal() {
  document.getElementById('diary-add-modal').hidden = true;
  document.body.style.overflow = '';
}

function saveRecipeToDiary() {
  const startDate = document.getElementById('diary-start-date').value || todayStr();
  const endMode = document.querySelector('input[name="end-mode"]:checked').value;
  let endDate = null;
  if (endMode === 'today') endDate = todayStr();
  else if (endMode === 'custom') endDate = document.getElementById('diary-end-date').value || todayStr();
  // open → null

  // 是否用既有食譜
  const existingId = document.getElementById('diary-existing-recipe').value;
  let recipe;
  if (existingId) {
    recipe = getRecipeById(existingId);
    if (!recipe) {
      alert('找不到所選食譜');
      return;
    }
  } else {
    // 新建：必須有計算器配方
    if (Object.keys(STATE.recipe).length === 0) {
      alert('請先在計算器加入食材，或選一份既有食譜');
      return;
    }
    const name = document.getElementById('diary-recipe-name').value.trim() || '未命名食譜';
    const ingredients = {};
    for (const item of Object.values(STATE.recipe)) {
      if (item.portion && item.portion > 0) ingredients[item.food.name] = item.portion;
    }
    const summary = document.getElementById('diary-recipe-summary').value.trim();
    recipe = {
      id: genId(),
      name,
      ingredients,
      summary,
      created_at: todayStr()
    };
    DIARY_STATE.saved_recipes.push(recipe);
  }

  // 自動結束前一份持續中食譜（若有；同食譜不用切）
  for (const f of DIARY_STATE.feeding_log) {
    if (!f.end_date && f.recipe_id !== recipe.id) {
      const prev = strToDate(startDate);
      prev.setDate(prev.getDate() - 1);
      f.end_date = dateToStr(prev);
    }
  }

  // 用同食譜的固定 color_index（避免不同 period 顏色亂跳）
  const existingFeed = DIARY_STATE.feeding_log.find(f => f.recipe_id === recipe.id);
  const colorIdx = existingFeed ? existingFeed.color_index : DIARY_STATE.feeding_log.length;

  DIARY_STATE.feeding_log.push({
    id: genId(),
    recipe_id: recipe.id,
    start_date: startDate,
    end_date: endDate,
    color_index: colorIdx
  });
  saveDiary();
  closeDiaryAddModal();
  // 切到日誌 tab 顯示
  switchTab('diary');
}

// ============================================================
// 區間填入 modal
// ============================================================
function openRangeFillModal() {
  if (DIARY_STATE.saved_recipes.length === 0) {
    alert('還沒有任何食譜，請先用「📅 加入日誌」建一筆');
    return;
  }
  const sel = document.getElementById('range-recipe');
  sel.innerHTML = '';
  for (const r of DIARY_STATE.saved_recipes) {
    sel.appendChild(el('option', { value: r.id }, r.name));
  }
  const t = todayStr();
  document.getElementById('range-start').value = t;
  document.getElementById('range-end').value = t;
  document.getElementById('range-fill-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeRangeFillModal() {
  document.getElementById('range-fill-modal').hidden = true;
  document.body.style.overflow = '';
}

function applyRangeFill() {
  const recipeId = document.getElementById('range-recipe').value;
  const startDate = document.getElementById('range-start').value;
  const endDate = document.getElementById('range-end').value;
  if (!recipeId || !startDate || !endDate) {
    alert('請填齊食譜與日期');
    return;
  }
  if (strToDate(endDate) < strToDate(startDate)) {
    alert('結束日期不可早於起始日期');
    return;
  }
  const recipe = getRecipeById(recipeId);
  if (!recipe) {
    alert('找不到食譜');
    return;
  }

  // 移除/裁切跟此 range 重疊的舊 feeding_log
  const sStart = strToDate(startDate).getTime();
  const sEnd = strToDate(endDate).getTime();
  const newLog = [];
  for (const f of DIARY_STATE.feeding_log) {
    const fStart = strToDate(f.start_date).getTime();
    const fEnd = f.end_date ? strToDate(f.end_date).getTime() : Infinity;
    // 完全在 range 內 → 丟掉
    if (fStart >= sStart && fEnd <= sEnd) continue;
    // 完全不重疊 → 保留
    if (fEnd < sStart || fStart > sEnd) {
      newLog.push(f);
      continue;
    }
    // 跨左邊界（fStart < sStart <= fEnd）→ 把 end 切到 sStart - 1
    if (fStart < sStart && fEnd >= sStart) {
      const cutEnd = strToDate(startDate);
      cutEnd.setDate(cutEnd.getDate() - 1);
      newLog.push({ ...f, end_date: dateToStr(cutEnd) });
    }
    // 跨右邊界（fStart <= sEnd < fEnd）→ 把 start 移到 sEnd + 1
    if (fStart <= sEnd && fEnd > sEnd) {
      const cutStart = strToDate(endDate);
      cutStart.setDate(cutStart.getDate() + 1);
      // 若這段同時跨左也跨右（包覆 range），splice 成左右兩段
      if (fStart < sStart && fEnd > sEnd) {
        newLog.push({ ...f, id: genId(), start_date: dateToStr(cutStart) });
      } else {
        newLog.push({ ...f, start_date: dateToStr(cutStart) });
      }
    }
  }
  DIARY_STATE.feeding_log = newLog;

  // 給此 recipe 一致的 color_index
  const existingFeed = DIARY_STATE.feeding_log.find(f => f.recipe_id === recipe.id);
  const colorIdx = existingFeed ? existingFeed.color_index : DIARY_STATE.feeding_log.length;

  DIARY_STATE.feeding_log.push({
    id: genId(),
    recipe_id: recipe.id,
    start_date: startDate,
    end_date: endDate,
    color_index: colorIdx
  });
  saveDiary();
  closeRangeFillModal();
  renderCalendar();
  renderRecipeHistory();
  renderDiaryStats();
}

// ============================================================
// 食譜帶入計算器（從日誌跳回計算器自動填）
// ============================================================
function loadRecipeIntoCalculator(recipeId) {
  const recipe = getRecipeById(recipeId);
  if (!recipe) return;
  // 清空目前 recipe
  STATE.recipe = {};
  // 依照儲存的食材逐個比對 STATE.foods
  let missing = [];
  for (const [foodName, portion] of Object.entries(recipe.ingredients || {})) {
    const food = STATE.foods.find(f => f.name === foodName);
    if (food) {
      STATE.recipe[food.name] = { food, portion: portion || 0 };
    } else {
      missing.push(foodName);
    }
  }
  saveState();
  closeDayDetail();
  switchTab('calculator');
  rerender();
  if (missing.length > 0) {
    setTimeout(() => alert(`已帶入「${recipe.name}」。\n但有 ${missing.length} 個食材在資料庫中找不到（可能名稱已變）：\n${missing.join('、')}`), 100);
  }
}

// ============================================================
// Day detail modal
// ============================================================
let CURRENT_DAY = null;

function openDayDetail(dateStr) {
  if (dateStr) CURRENT_DAY = dateStr;
  const date = strToDate(CURRENT_DAY);
  const wd = ['週日','週一','週二','週三','週四','週五','週六'][date.getDay()];
  document.getElementById('day-detail-title').textContent = CURRENT_DAY;
  document.getElementById('day-detail-weekday').textContent = wd;

  // 餵食 section
  const feedDiv = document.getElementById('day-detail-feeding');
  feedDiv.innerHTML = '';
  const feeding = getFeedingForDate(CURRENT_DAY);
  if (feeding) {
    const recipe = getRecipeById(feeding.recipe_id);
    feedDiv.appendChild(el('h4', {}, '🍽️ 餵食食譜'));
    const nameNode = recipe
      ? el('button', {
          type: 'button',
          class: 'feed-name feed-name-link',
          title: '點擊帶入計算器',
          onclick: () => loadRecipeIntoCalculator(recipe.id)
        }, [recipe.name, el('span', { class: 'feed-name-arrow' }, '→📊')])
      : el('div', { class: 'feed-name' }, '(未知)');
    feedDiv.appendChild(el('div', { class: 'day-feeding' }, [
      nameNode,
      el('div', { class: 'feed-period' },
        `${feeding.start_date} ~ ${feeding.end_date || '持續中'}`),
      recipe && recipe.summary ? el('div', { style: 'margin-top:6px;font-size:11px;color:#666;white-space:pre-wrap;' }, recipe.summary) : null
    ]));
  } else {
    feedDiv.appendChild(el('h4', {}, '🍽️ 餵食食譜'));
    feedDiv.appendChild(el('p', { class: 'empty-state' }, '當天無餵食紀錄'));
  }

  // 事件 section
  const evDiv = document.getElementById('day-detail-events');
  evDiv.innerHTML = '';
  evDiv.appendChild(el('h4', {}, '📌 當天事件'));
  const eventsList = DIARY_STATE.events.filter(e => e.date === CURRENT_DAY);
  if (eventsList.length === 0) {
    evDiv.appendChild(el('p', { class: 'empty-state' }, '當天無事件'));
  } else {
    const list = el('div', { class: 'day-events' });
    for (const ev of eventsList) {
      const extra = [];
      if (ev.weight_kg) extra.push(`體重 ${ev.weight_kg} kg`);
      if (ev.medication) extra.push(ev.medication);
      const noteText = [ev.note, ...extra].filter(Boolean).join(' · ');
      list.appendChild(el('div', { class: 'day-event-item' }, [
        el('span', { class: 'ev-emoji' }, ev.emoji),
        el('div', { class: 'ev-info' }, [
          el('div', { class: 'ev-name' }, ev.name),
          noteText ? el('div', { class: 'ev-note' }, noteText) : null
        ]),
        el('button', {
          class: 'ev-delete',
          type: 'button',
          title: '刪除',
          onclick: () => { deleteEvent(ev.id); openDayDetail(); }
        }, '✕')
      ]));
    }
    evDiv.appendChild(list);
  }

  document.getElementById('day-detail-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDayDetail() {
  document.getElementById('day-detail-modal').hidden = true;
  document.body.style.overflow = '';
}

// ============================================================
// Event picker
// ============================================================
let CURRENT_EVENT = null;

function openEventPicker() {
  document.getElementById('event-picker-date').textContent = CURRENT_DAY;
  document.getElementById('event-detail-form').hidden = true;
  CURRENT_EVENT = null;

  const grid = document.getElementById('event-picker-grid');
  grid.innerHTML = '';

  // Group by category
  const cats = {};
  for (const ev of EVENT_TYPES) {
    if (!cats[ev.cat]) cats[ev.cat] = [];
    cats[ev.cat].push(ev);
  }

  for (const cat of ['症狀', '醫療', '日常', '其他']) {
    if (!cats[cat] || cats[cat].length === 0) continue;
    const wrap = el('div', { class: 'event-cat' }, [
      el('div', { class: 'event-cat-title' }, cat),
      el('div', { class: 'event-chips' },
        cats[cat].map(ev => el('button', {
          class: 'event-chip',
          type: 'button',
          onclick: () => selectEventType(ev)
        }, [
          el('span', { class: 'ec-emoji' }, ev.emoji),
          ev.name
        ]))
      )
    ]);
    grid.appendChild(wrap);
  }

  document.getElementById('event-picker-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeEventPicker() {
  document.getElementById('event-picker-modal').hidden = true;
  document.body.style.overflow = '';
}

function selectEventType(ev) {
  CURRENT_EVENT = ev;
  document.getElementById('event-detail-name').textContent = `${ev.emoji} ${ev.name}`;
  document.getElementById('event-detail-form').hidden = false;
  document.getElementById('event-note').value = '';
  document.getElementById('event-extra-weight').hidden = ev.extra !== 'weight';
  document.getElementById('event-extra-medication').hidden = ev.extra !== 'medication';
  const customWrap = document.getElementById('event-extra-custom');
  if (customWrap) customWrap.hidden = ev.extra !== 'custom_name';
  document.getElementById('event-weight').value = '';
  document.getElementById('event-medication').value = '';
  const customInput = document.getElementById('event-custom-name');
  if (customInput) customInput.value = '';
  // 「其他」事件先 focus 名稱輸入
  if (ev.extra === 'custom_name' && customInput) {
    customInput.focus();
  } else {
    document.getElementById('event-note').focus();
  }
}

function saveEvent() {
  if (!CURRENT_EVENT) return;
  const note = document.getElementById('event-note').value.trim();
  const weight = parseFloat(document.getElementById('event-weight').value) || null;
  const med = document.getElementById('event-medication').value.trim() || null;
  const customInput = document.getElementById('event-custom-name');
  const customName = customInput ? customInput.value.trim() : '';

  // 「其他」事件需要使用者填名稱
  let displayName = CURRENT_EVENT.name;
  if (CURRENT_EVENT.extra === 'custom_name') {
    if (!customName) {
      alert('請填寫事件名稱');
      if (customInput) customInput.focus();
      return;
    }
    displayName = customName;
  }

  DIARY_STATE.events.push({
    id: genId(),
    date: CURRENT_DAY,
    type: CURRENT_EVENT.type,
    emoji: CURRENT_EVENT.emoji,
    name: displayName,
    note,
    weight_kg: weight,
    medication: med
  });
  saveDiary();
  closeEventPicker();
  renderCalendar();
  renderDiaryStats();
  openDayDetail();
}

function deleteEvent(eventId) {
  if (!confirm('刪除此事件？')) return;
  DIARY_STATE.events = DIARY_STATE.events.filter(e => e.id !== eventId);
  saveDiary();
  renderCalendar();
  renderDiaryStats();
}

// ============================================================
// 統計：最近 30 天事件次數 + 食譜輪替分布
// ============================================================
function renderDiaryStats() {
  const evWrap = document.getElementById('stats-events');
  const recWrap = document.getElementById('stats-recipes');
  if (!evWrap || !recWrap) return;

  // === 30 天事件統計 ===
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = dateToStr(cutoff);

  const recentEvents = DIARY_STATE.events.filter(e => e.date >= cutoffStr);
  const evCount = {};
  for (const ev of recentEvents) {
    const key = ev.type + '|' + ev.emoji + '|' + ev.name;
    evCount[key] = (evCount[key] || 0) + 1;
  }

  evWrap.innerHTML = '';
  if (Object.keys(evCount).length === 0) {
    evWrap.appendChild(el('p', { class: 'empty-state' }, '最近 30 天無事件紀錄'));
  } else {
    // sort 次數多在前
    const sorted = Object.entries(evCount).sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted) {
      const [type, emoji, name] = key.split('|');
      evWrap.appendChild(el('div', { class: 'event-stat' }, [
        el('span', {}, emoji + ' ' + name),
        el('span', { class: 'es-count' }, String(count))
      ]));
    }
  }

  // === 食譜輪替分布（最近 30 天天數） ===
  const recipeDays = {}; // recipe_id → days
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = dateToStr(d);
    const f = getFeedingForDate(ds);
    if (f) {
      recipeDays[f.recipe_id] = (recipeDays[f.recipe_id] || 0) + 1;
    }
  }

  recWrap.innerHTML = '';
  if (Object.keys(recipeDays).length === 0) {
    recWrap.appendChild(el('p', { class: 'empty-state' }, '最近 30 天尚未紀錄食譜'));
  } else {
    const totalDays = Object.values(recipeDays).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(recipeDays).sort((a, b) => b[1] - a[1]);
    for (const [rid, days] of sorted) {
      const r = getRecipeById(rid);
      if (!r) continue;
      const f = DIARY_STATE.feeding_log.find(x => x.recipe_id === rid);
      const colorIdx = f ? (f.color_index % 8) : 0;
      const pct = totalDays > 0 ? (days / totalDays * 100).toFixed(0) : 0;
      const row = el('div', { class: 'recipe-stat-row' }, [
        el('div', { class: 'rs-bar-wrap' }, [
          el('div', {
            class: 'rs-bar feed-color-' + colorIdx,
            style: `width: ${pct}%`
          })
        ]),
        el('div', { class: 'rs-info' }, [
          el('span', { class: 'rs-name' }, r.name),
          el('span', { class: 'rs-days' }, `${days} 天 (${pct}%)`)
        ])
      ]);
      recWrap.appendChild(row);
    }
  }
}

// ============================================================
// Tab switching
// ============================================================
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  document.getElementById('page-calculator').hidden = (name !== 'calculator');
  document.getElementById('page-diary').hidden = (name !== 'diary');
  const genPage = document.getElementById('page-generator');
  if (genPage) genPage.hidden = (name !== 'generator');
  if (name === 'diary') {
    renderCalendar();
    renderRecipeHistory();
    renderDiaryStats();
  }
  if (name === 'generator' && window.GeneratorUI && window.GeneratorUI.onShow) {
    window.GeneratorUI.onShow();
  }
}

// ============================================================
// Init
// ============================================================
function initDiary() {
  loadDiary();

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.page));
  });

  // Calendar nav
  document.getElementById('cal-prev').addEventListener('click', () => {
    const m = DIARY_STATE.current_month;
    m.month -= 1;
    if (m.month < 0) { m.month = 11; m.year -= 1; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    const m = DIARY_STATE.current_month;
    m.month += 1;
    if (m.month > 11) { m.month = 0; m.year += 1; }
    renderCalendar();
  });

  // Save to diary button
  document.getElementById('btn-save-to-diary').addEventListener('click', openSaveToDiaryModal);
  document.getElementById('diary-save-btn').addEventListener('click', saveRecipeToDiary);

  // Range fill
  const rangeBtn = document.getElementById('btn-range-fill');
  if (rangeBtn) rangeBtn.addEventListener('click', openRangeFillModal);
  const rangeSaveBtn = document.getElementById('range-fill-save');
  if (rangeSaveBtn) rangeSaveBtn.addEventListener('click', applyRangeFill);

  // End-mode radio
  document.querySelectorAll('input[name="end-mode"]').forEach(r => {
    r.addEventListener('change', e => {
      const customInput = document.getElementById('diary-end-date');
      customInput.disabled = (e.target.value !== 'custom');
      if (e.target.value === 'today') customInput.value = todayStr();
    });
  });

  // Modal close handlers
  document.querySelectorAll('[data-close]').forEach(el => {
    const which = el.dataset.close;
    el.addEventListener('click', () => {
      if (which === 'add') closeDiaryAddModal();
      else if (which === 'day') closeDayDetail();
      else if (which === 'picker') closeEventPicker();
      else if (which === 'range') closeRangeFillModal();
    });
  });

  // Day modal: add event button
  document.getElementById('day-add-event-btn').addEventListener('click', openEventPicker);

  // Event picker: cancel/save
  document.getElementById('event-cancel-btn').addEventListener('click', () => {
    document.getElementById('event-detail-form').hidden = true;
    CURRENT_EVENT = null;
  });
  document.getElementById('event-save-btn').addEventListener('click', saveEvent);

  // Esc key close all modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDiaryAddModal();
      closeDayDetail();
      closeEventPicker();
      closeRangeFillModal();
    }
  });
}

// Init after DOM ready (called from app.js init or here)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDiary);
} else {
  initDiary();
}

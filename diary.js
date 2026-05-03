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
// Event types
// ============================================================
const EVENT_TYPES = [
  // 症狀
  { type: 'vomit', emoji: '🤮', name: '嘔吐', cat: '症狀' },
  { type: 'diarrhea', emoji: '💩', name: '腹瀉', cat: '症狀' },
  { type: 'no_appetite', emoji: '😶', name: '食慾不佳', cat: '症狀' },
  { type: 'cough', emoji: '🤧', name: '咳嗽/呼吸異常', cat: '症狀' },
  { type: 'fever', emoji: '🌡️', name: '發燒', cat: '症狀' },
  { type: 'blood', emoji: '🩸', name: '血便/尿異常', cat: '症狀' },
  { type: 'collapse', emoji: '😵', name: '跌倒/暈倒', cat: '症狀' },
  { type: 'allergy', emoji: '🌸', name: '過敏', cat: '症狀' },
  { type: 'abnormal', emoji: '🧐', name: '異常行為', cat: '症狀' },
  { type: 'thirst', emoji: '💧', name: '大量喝水', cat: '症狀' },
  { type: 'injury', emoji: '🩹', name: '受傷', cat: '症狀' },
  // 醫療
  { type: 'vaccine', emoji: '💉', name: '預防針', cat: '醫療' },
  { type: 'heartworm', emoji: '🐛', name: '心絲蟲藥', cat: '醫療' },
  { type: 'flea_tick', emoji: '🦗', name: '體外驅蟲', cat: '醫療' },
  { type: 'vet', emoji: '🏥', name: '看獸醫', cat: '醫療' },
  { type: 'medication', emoji: '💊', name: '服藥', cat: '醫療', extra: 'medication' },
  { type: 'cardiac_check', emoji: '❤️', name: '心臟檢查', cat: '醫療' },
  { type: 'dental', emoji: '🦷', name: '牙科/洗牙', cat: '醫療' },
  // 日常
  { type: 'weigh', emoji: '⚖️', name: '量體重', cat: '日常', extra: 'weight' },
  { type: 'bath', emoji: '🚿', name: '洗澡/美容', cat: '日常' },
  { type: 'recipe_change', emoji: '🦴', name: '換食譜', cat: '日常' },
  { type: 'travel', emoji: '✈️', name: '旅遊', cat: '日常' },
  { type: 'high_activity', emoji: '🎾', name: '運動量大', cat: '日常' },
  { type: 'low_activity', emoji: '🛌', name: '運動量低', cat: '日常' },
  { type: 'social', emoji: '🐕', name: '與其他狗互動', cat: '日常' },
  { type: 'heat', emoji: '🌺', name: '發情/月經', cat: '日常' },
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
}

function deleteFeeding(id) {
  if (!confirm('確定刪除此食譜紀錄？（食譜本身不會刪除）')) return;
  DIARY_STATE.feeding_log = DIARY_STATE.feeding_log.filter(f => f.id !== id);
  saveDiary();
  renderCalendar();
  renderRecipeHistory();
}

// ============================================================
// 加食譜進日誌 modal
// ============================================================
function openSaveToDiaryModal() {
  if (Object.keys(STATE.recipe).length === 0) {
    alert('請先在計算器加入食材');
    return;
  }
  const modal = document.getElementById('diary-add-modal');
  const t = todayStr();
  document.getElementById('diary-recipe-name').value = `配方 ${t}`;
  document.getElementById('diary-start-date').value = t;
  document.getElementById('diary-end-date').value = t;
  document.getElementById('diary-end-date').disabled = true;
  document.querySelector('input[name="end-mode"][value="today"]').checked = true;

  // Auto-summary
  const lines = Object.values(STATE.recipe)
    .filter(item => item.portion && item.portion > 0)
    .map(item => `• ${item.food.name} ${item.portion} ${item.food.unit}`);
  document.getElementById('diary-recipe-summary').value = lines.join('\n');

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDiaryAddModal() {
  document.getElementById('diary-add-modal').hidden = true;
  document.body.style.overflow = '';
}

function saveRecipeToDiary() {
  const name = document.getElementById('diary-recipe-name').value.trim() || '未命名食譜';
  const startDate = document.getElementById('diary-start-date').value || todayStr();
  const endMode = document.querySelector('input[name="end-mode"]:checked').value;
  let endDate = null;
  if (endMode === 'today') endDate = todayStr();
  else if (endMode === 'custom') endDate = document.getElementById('diary-end-date').value || todayStr();
  // open → null

  // 自動結束前一份持續中食譜（若有）
  for (const f of DIARY_STATE.feeding_log) {
    if (!f.end_date) {
      // 比 startDate 前一天設為結束
      const prev = strToDate(startDate);
      prev.setDate(prev.getDate() - 1);
      f.end_date = dateToStr(prev);
    }
  }

  const ingredients = {};
  for (const item of Object.values(STATE.recipe)) {
    if (item.portion && item.portion > 0) ingredients[item.food.name] = item.portion;
  }
  const summary = document.getElementById('diary-recipe-summary').value.trim();

  const recipe = {
    id: genId(),
    name,
    ingredients,
    summary,
    created_at: todayStr()
  };
  DIARY_STATE.saved_recipes.push(recipe);

  const colorIdx = DIARY_STATE.feeding_log.length;
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
  renderCalendar();
  renderRecipeHistory();
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
    feedDiv.appendChild(el('div', { class: 'day-feeding' }, [
      el('div', { class: 'feed-name' }, recipe ? recipe.name : '(未知)'),
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

  for (const cat of ['症狀', '醫療', '日常']) {
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
  document.getElementById('event-weight').value = '';
  document.getElementById('event-medication').value = '';
  document.getElementById('event-note').focus();
}

function saveEvent() {
  if (!CURRENT_EVENT) return;
  const note = document.getElementById('event-note').value.trim();
  const weight = parseFloat(document.getElementById('event-weight').value) || null;
  const med = document.getElementById('event-medication').value.trim() || null;

  DIARY_STATE.events.push({
    id: genId(),
    date: CURRENT_DAY,
    type: CURRENT_EVENT.type,
    emoji: CURRENT_EVENT.emoji,
    name: CURRENT_EVENT.name,
    note,
    weight_kg: weight,
    medication: med
  });
  saveDiary();
  closeEventPicker();
  renderCalendar();
  openDayDetail();
}

function deleteEvent(eventId) {
  if (!confirm('刪除此事件？')) return;
  DIARY_STATE.events = DIARY_STATE.events.filter(e => e.id !== eventId);
  saveDiary();
  renderCalendar();
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
  if (name === 'diary') {
    renderCalendar();
    renderRecipeHistory();
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
    }
  });
}

// Init after DOM ready (called from app.js init or here)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDiary);
} else {
  initDiary();
}

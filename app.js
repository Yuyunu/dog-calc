/* ============================================================
   狗狗鮮食營養計算器 v2 — app.js
   計算邏輯 + UI 互動 + 達標儀表板 + 比例分析 + localStorage
   ============================================================ */

'use strict';

// ============================================================
// State
// ============================================================
const STATE = {
  foods: [],              // 載入自 foods.json
  standards: null,        // 載入自 standards.json
  recipe: {},             // { foodName: { food, portion } }
  weight: 11.5,
  activity: 1.2
};

const LS_KEY = 'dog_calc_v2_state';

// ============================================================
// Utility
// ============================================================
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function fmt(n, dec = 2) {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) < 0.0001 && n !== 0) return n.toExponential(2);
  return n.toFixed(dec);
}

function fmtPct(p) {
  if (p == null || !isFinite(p)) return '—';
  return (p * 100).toFixed(1) + '%';
}

// ============================================================
// Data loading
// ============================================================
async function loadData() {
  // 優先用 data.js 預載入 (inline、file:// 本機可用)
  if (window.DOG_CALC_FOODS && window.DOG_CALC_STANDARDS) {
    STATE.foods = window.DOG_CALC_FOODS;
    STATE.standards = window.DOG_CALC_STANDARDS;
    return;
  }
  // Fallback: fetch JSON (僅 http/https 可用，本機 file:// 會失敗)
  try {
    const [foodsRes, stdRes] = await Promise.all([
      fetch('foods.json'),
      fetch('standards.json')
    ]);
    if (!foodsRes.ok || !stdRes.ok) {
      throw new Error('Failed to load data files');
    }
    STATE.foods = await foodsRes.json();
    STATE.standards = await stdRes.json();
  } catch (e) {
    throw new Error(
      '無法載入食材資料。本機開啟請確認 data.js 存在，' +
      '或用 http server 開啟（如 `python3 -m http.server`）。' +
      '原始錯誤：' + e.message
    );
  }
}

// ============================================================
// Group foods by category for picker
// ============================================================
function groupFoods() {
  // Define category display order (合併所有 補充品* 為「補充品」)
  const ORDER = [
    '補充品', '飼料',
    '油脂', '油脂類', '調味', '種子',
    '肉類', '牛肉', '豬肉', '雞肉', '海鮮',
    '蛋類',
    '穀物', '澱粉類', '根莖類',
    '蔬菜', '蔬菜類', '蔬果',
    '水果', '水果類'
  ];
  const groups = {};
  for (const food of STATE.foods) {
    let cat = food.category || '其他';
    // 補充品(顆) / 補充品(包) / 補充品(匙) 全部合併到「補充品」
    if (cat.startsWith('補充品')) cat = '補充品';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(food);
  }
  return Object.keys(groups).sort((a, b) => {
    const ai = ORDER.indexOf(a);
    const bi = ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }).map(cat => ({ category: cat, foods: groups[cat] }));
}

// ============================================================
// Render: 活動係數 dropdown
// ============================================================
function renderActivityOptions() {
  const sel = document.getElementById('activity');
  sel.innerHTML = '';
  for (const opt of STATE.standards.activity_options) {
    const o = el('option', { value: opt.value }, opt.label);
    if (opt.value === STATE.activity) o.selected = true;
    sel.appendChild(o);
  }
}

// ============================================================
// Render: 食材選擇 chip 按鈕
// ============================================================
function renderIngredientPicker() {
  const wrap = document.getElementById('ingredient-picker');
  wrap.innerHTML = '';
  const groups = groupFoods();

  for (const { category, foods } of groups) {
    const groupEl = el('div', { class: 'picker-group' }, [
      el('div', { class: 'picker-group-title' }, category),
      el('div', { class: 'picker-chips' },
        foods.map(food => {
          const isActive = !!STATE.recipe[food.name];
          return el('button', {
            type: 'button',
            class: 'chip' + (isActive ? ' active' : ''),
            'data-name': food.name,
            onclick: () => toggleFood(food)
          }, [
            el('span', { class: 'chip-icon' }, isActive ? '✓' : '⊕'),
            food.name
          ]);
        })
      )
    ]);
    wrap.appendChild(groupEl);
  }
}

// ============================================================
// Render: 已加入食材 list
// ============================================================
function renderRecipeList() {
  const wrap = document.getElementById('recipe-list');
  const summary = document.getElementById('recipe-summary');
  wrap.innerHTML = '';

  const items = Object.values(STATE.recipe);
  if (items.length === 0) {
    wrap.appendChild(el('p', { class: 'empty-state' }, '尚未加入任何食材'));
    summary.hidden = true;
    return;
  }

  for (const item of items) {
    const row = el('div', { class: 'recipe-row' }, [
      el('span', { class: 'recipe-name' }, item.food.name),
      el('input', {
        type: 'number',
        class: 'recipe-portion',
        value: item.portion == null ? '' : item.portion,
        step: '0.1',
        min: '0',
        placeholder: '0',
        inputmode: 'decimal',
        'data-name': item.food.name,
        onchange: e => updatePortion(item.food.name, e.target.value),
        oninput: e => updatePortion(item.food.name, e.target.value)
      }),
      el('span', { class: 'recipe-unit' }, item.food.unit),
      el('button', {
        type: 'button',
        class: 'recipe-remove',
        title: '移除',
        onclick: () => removeFood(item.food.name)
      }, '✕')
    ]);
    wrap.appendChild(row);
  }
  summary.hidden = false;
}

// ============================================================
// Calculate recipe totals
// ============================================================
function calcTotals() {
  const totals = {};
  let totalGrams = 0;

  for (const item of Object.values(STATE.recipe)) {
    // null / 空字串 / 0 視為無貢獻
    const portion = (item.portion == null || item.portion === '') ? 0 : Number(item.portion);
    if (!isFinite(portion) || portion <= 0) continue;
    const grams = portion * item.food.gramsPerUnit;
    totalGrams += grams;
    for (const k in item.food) {
      const v = item.food[k];
      if (typeof v !== 'number' || k === 'row' || k === 'gramsPerUnit') continue;
      totals[k] = (totals[k] || 0) + v * grams;
    }
  }
  totals._totalGrams = totalGrams;
  return totals;
}

// ============================================================
// Render: recipe summary (top of dashboard)
// ============================================================
function renderRecipeSummary(totals) {
  document.getElementById('sum-grams').textContent = fmt(totals._totalGrams || 0, 1);
  document.getElementById('sum-kcal').textContent = fmt(totals.kcal || 0, 1);
  document.getElementById('sum-water').textContent = fmt(totals.water_g || 0, 1);
}

function renderDMAnalysis(totals) {
  const section = document.getElementById('dm-section');
  if (Object.keys(STATE.recipe).length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const total = totals._totalGrams || 0;
  const water = totals.water_g || 0;
  const dry = total - water;

  const protein = totals.protein || 0;
  const fat = totals.fat || 0;
  const carb = totals.carb || 0;
  const fiber = totals.fiber || 0;

  // 數量帶單位 g
  document.getElementById('dm-total').textContent = fmt(total, 2) + ' g';
  document.getElementById('dm-water').textContent = fmt(water, 2) + ' g';
  document.getElementById('dm-dry').textContent = fmt(dry, 2) + ' g';
  document.getElementById('dm-protein').textContent = fmt(protein, 2) + ' g';
  document.getElementById('dm-fat').textContent = fmt(fat, 2) + ' g';
  document.getElementById('dm-carb').textContent = fmt(carb, 2) + ' g';
  document.getElementById('dm-fiber').textContent = fmt(fiber, 2) + ' g';

  // 簡短說明 (取代計算式)
  document.getElementById('dm-dry-formula').textContent = '扣除水分後的實際營養乾重';

  const renderPctRow = (id, desc, value) => {
    const pctEl = document.getElementById(id + '-pct');
    const formulaEl = document.getElementById(id + '-formula');
    if (dry > 0) {
      pctEl.textContent = fmtPct(value / dry);
      formulaEl.textContent = desc;
    } else {
      pctEl.textContent = '—';
      formulaEl.textContent = '';
    }
  };
  renderPctRow('dm-protein', '蛋白質在乾物質中的比例', protein);
  renderPctRow('dm-fat', '脂肪在乾物質中的比例', fat);
  renderPctRow('dm-carb', '碳水化合物在乾物質中的比例', carb);
  renderPctRow('dm-fiber', '膳食纖維在乾物質中的比例', fiber);
}

// ============================================================
// RER / DER
// ============================================================
function calcEnergy() {
  const w = STATE.weight;
  const a = STATE.activity;
  const rer = 70 * Math.pow(w, 0.75);
  const der = rer * a;
  return { rer, der };
}

function renderEnergy() {
  const { rer, der } = calcEnergy();
  document.getElementById('rer').textContent = fmt(rer, 1);
  document.getElementById('der').textContent = fmt(der, 1);
}

// ============================================================
// Achievement (達標儀表板)
// ============================================================
function calcAchievement(totals) {
  const { der } = calcEnergy();
  const results = [];

  // 熱量 special row (compares to DER directly)
  results.push({
    key: 'kcal',
    name: '熱量',
    unit: 'kcal',
    provided: totals.kcal || 0,
    dailyMin: der,
    dailyRec: der,
    dailyMax: der * 1.1,
    pct: der > 0 ? (totals.kcal || 0) / der : null,
    status: null  // computed below
  });

  for (const std of STATE.standards.nutrients) {
    let provided = totals[std.key];

    // Special composite keys
    if (std.key === 'met_cys_g') provided = (totals.met_g || 0) + (totals.cys_g || 0);
    else if (std.key === 'phe_tyr_g') provided = (totals.phe_g || 0) + (totals.tyr_g || 0);
    else if (std.key === 'epa_dha') provided = totals.omega3_g || 0;  // approximate
    else if (std.key === 'cl_g') continue;  // 氯 我們沒收集
    else if (std.key === 'vitk_mg') continue;

    if (provided == null) provided = 0;

    const dailyMin = std.aafco_min_per_1000kcal != null
      ? std.aafco_min_per_1000kcal * der / 1000
      : null;
    const dailyRec = std.nrc_per_1000kcal != null
      ? std.nrc_per_1000kcal * der / 1000
      : null;
    const dailyMax = std.aafco_max_per_1000kcal != null
      ? std.aafco_max_per_1000kcal * der / 1000
      : null;

    const pct = dailyMin && dailyMin > 0 ? provided / dailyMin : null;
    results.push({
      key: std.key,
      name: std.name,
      unit: std.unit,
      provided,
      dailyMin,
      dailyRec,
      dailyMax,
      pct,
      status: null
    });
  }

  // Determine status
  for (const r of results) {
    if (r.pct == null) {
      r.status = 'ref';
    } else if (r.dailyMax && r.provided > r.dailyMax) {
      r.status = 'bad';
    } else if (r.pct < 0.8) {
      r.status = 'warn';
    } else {
      r.status = 'ok';
    }
  }

  return results;
}

function renderDashboard(achievement) {
  const wrap = document.getElementById('dashboard');
  const summary = document.getElementById('dashboard-summary');
  wrap.innerHTML = '';

  if (Object.keys(STATE.recipe).length === 0) {
    wrap.appendChild(el('p', { class: 'empty-state' }, '加入食材後自動計算'));
    summary.hidden = true;
    return;
  }

  let cntOk = 0, cntWarn = 0, cntBad = 0;
  for (const r of achievement) {
    const barWidth = r.pct != null
      ? Math.min(100, Math.max(2, r.pct * 100))
      : 0;
    const row = el('div', {
      class: 'dash-row status-' + r.status
    }, [
      el('div', { class: 'dash-name' }, [
        r.name,
        el('span', { class: 'dash-unit' }, ' (' + (r.unit || '') + ')')
      ]),
      el('div', { class: 'dash-bar-wrap' },
        el('div', { class: 'dash-bar', style: `width: ${barWidth}%` })
      ),
      el('div', { class: 'dash-pct' }, fmtPct(r.pct))
    ]);
    wrap.appendChild(row);

    if (r.status === 'ok') cntOk++;
    else if (r.status === 'warn') cntWarn++;
    else if (r.status === 'bad') cntBad++;
  }

  document.getElementById('cnt-ok').textContent = cntOk;
  document.getElementById('cnt-warn').textContent = cntWarn;
  document.getElementById('cnt-bad').textContent = cntBad;
  summary.hidden = false;
}

// ============================================================
// 比例分析
// ============================================================
function calcRatios(totals) {
  const results = [];
  for (const r of STATE.standards.ratios) {
    const num = totals[r.numerator] || 0;
    const den = totals[r.denominator] || 0;
    let value;
    if (den === 0) {
      value = null;
    } else if (r.scale) {
      value = num / den * r.scale;
    } else {
      value = num / den;
    }
    // status: 'ok' / 'warn-low' / 'warn-high' / 'ref'
    let status = 'ref';
    let warning = '';
    if (value != null) {
      const hasMin = r.ideal_min != null;
      const hasMax = r.ideal_max != null;
      if (hasMin && value < r.ideal_min) {
        status = 'warn-low';
        warning = r.low_warn || '低於建議範圍';
      } else if (hasMax && value > r.ideal_max) {
        status = 'warn-high';
        warning = r.high_warn || '高於建議範圍';
      } else if (hasMin || hasMax) {
        status = 'ok';
      }
    }
    results.push({ ...r, value, status, warning });
  }
  return results;
}

function renderRatios(ratios) {
  const wrap = document.getElementById('ratios');
  wrap.innerHTML = '';

  if (Object.keys(STATE.recipe).length === 0) {
    wrap.appendChild(el('p', { class: 'empty-state' }, '加入食材後自動計算'));
    return;
  }

  for (const r of ratios) {
    const idealLabel = r.ideal_label
      ? r.ideal_label
      : (r.ideal_min != null && r.ideal_max != null
          ? `${r.ideal_min}~${r.ideal_max}`
          : (r.ideal_min != null ? `≥${r.ideal_min}` : ''));

    const statusClass = r.status === 'warn-low' || r.status === 'warn-high'
      ? 'warn'
      : r.status;

    const children = [
      el('div', { class: 'ratio-row-main' }, [
        el('div', { class: 'ratio-name' }, [
          r.name,
          idealLabel ? el('span', { class: 'ratio-ideal' }, ' (' + idealLabel + ')') : null
        ]),
        el('div', { class: 'ratio-value ' + statusClass }, fmt(r.value, 2))
      ])
    ];

    // 警告說明 (只在不達標時顯示)
    if (r.warning && (r.status === 'warn-low' || r.status === 'warn-high')) {
      children.push(
        el('div', { class: 'ratio-warning' }, [
          el('span', { class: 'ratio-warning-icon' },
            r.status === 'warn-low' ? '↓' : '↑'),
          ' ',
          r.warning
        ])
      );
    }

    const row = el('div', { class: 'ratio-row status-' + statusClass }, children);
    wrap.appendChild(row);
  }
}

// ============================================================
// State actions
// ============================================================
function toggleFood(food) {
  if (STATE.recipe[food.name]) {
    delete STATE.recipe[food.name];
  } else {
    // portion 預設 null (空白)，使用者輸入後才有值
    STATE.recipe[food.name] = { food, portion: null };
  }
  saveState();
  rerender();
}

function updatePortion(name, value) {
  if (!STATE.recipe[name]) return;
  // 空字串 → null (顯示空白); 有效數字 → 該數字; 無效 → null
  if (value === '' || value == null) {
    STATE.recipe[name].portion = null;
  } else {
    const n = parseFloat(value);
    STATE.recipe[name].portion = (isFinite(n) && n >= 0) ? n : null;
  }
  saveState();
  recalcOnly();
}

function removeFood(name) {
  delete STATE.recipe[name];
  saveState();
  rerender();
}

function clearAll() {
  if (Object.keys(STATE.recipe).length === 0) return;
  if (!confirm('確定要清除全部食材嗎？')) return;
  STATE.recipe = {};
  saveState();
  rerender();
}

// ============================================================
// Recalc / Render
// ============================================================
function rerender() {
  renderIngredientPicker();
  renderRecipeList();
  recalcOnly();
}

function recalcOnly() {
  renderEnergy();
  const totals = calcTotals();
  renderRecipeSummary(totals);
  renderDMAnalysis(totals);
  const ach = calcAchievement(totals);
  renderDashboard(ach);
  const ratios = calcRatios(totals);
  renderRatios(ratios);
}

// ============================================================
// localStorage
// ============================================================
function saveState() {
  try {
    const data = {
      weight: STATE.weight,
      activity: STATE.activity,
      recipe: Object.fromEntries(
        Object.entries(STATE.recipe).map(([name, item]) => [name, { portion: item.portion }])
      )
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.weight) STATE.weight = data.weight;
    if (data.activity) STATE.activity = data.activity;
    if (data.recipe) {
      for (const [name, item] of Object.entries(data.recipe)) {
        const food = STATE.foods.find(f => f.name === name);
        if (food) {
          STATE.recipe[name] = { food, portion: item.portion || 0 };
        }
      }
    }
  } catch (e) {
    console.warn('localStorage load failed:', e);
  }
}

// ============================================================
// Export PDF — 用瀏覽器原生 print to PDF
// ============================================================
function exportPDF() {
  if (Object.keys(STATE.recipe).length === 0) {
    alert('請先加入食材再匯出');
    return;
  }
  // Populate print-only metadata
  const now = new Date();
  const dateStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');
  const { rer, der } = calcEnergy();
  const activityLabel = STATE.standards.activity_options.find(
    o => Math.abs(o.value - STATE.activity) < 0.001
  );
  document.getElementById('print-date').textContent = dateStr;
  document.getElementById('print-weight').textContent = STATE.weight;
  document.getElementById('print-activity').textContent =
    (activityLabel ? activityLabel.label : STATE.activity);
  document.getElementById('print-rer').textContent = fmt(rer, 1);
  document.getElementById('print-der').textContent = fmt(der, 1);

  // Trigger browser print → user picks "Save as PDF"
  setTimeout(() => window.print(), 100);
}

// ============================================================
// Init
// ============================================================
async function init() {
  try {
    await loadData();
    loadState();

    // Initial state
    document.getElementById('weight').value = STATE.weight;
    renderActivityOptions();

    // Bind inputs
    document.getElementById('weight').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) {
        STATE.weight = v;
        saveState();
        recalcOnly();
      }
    });
    document.getElementById('activity').addEventListener('change', e => {
      STATE.activity = parseFloat(e.target.value);
      saveState();
      recalcOnly();
    });
    document.getElementById('btn-clear-all').addEventListener('click', clearAll);
    document.getElementById('btn-export').addEventListener('click', exportPDF);

    // 重新整理按鈕 — 強制抓最新版本 (bypass cache)
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        // 跳轉到 URL 加 timestamp，強制 cache miss
        const url = window.location.origin + window.location.pathname + '?_v=' + Date.now();
        window.location.href = url;
      });
    }

    rerender();
  } catch (e) {
    console.error('Init failed:', e);
    document.querySelector('.container').innerHTML =
      '<div class="card"><p style="color:#c00">載入資料失敗：' + e.message + '</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);

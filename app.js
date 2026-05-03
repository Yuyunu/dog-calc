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
// 讓其他 script (如 generator.js) 能透過 window.STATE 拿到
window.STATE = STATE;

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
// 分類 → CSS 顏色 var
const CAT_COLOR = {
  '補充品': 'var(--cat-supplement)',
  '補充品(顆)': 'var(--cat-supplement-cap)',
  '補充品(包)': 'var(--cat-supplement-pkt)',
  '補充品(匙)': 'var(--cat-supplement)',
  '飼料': 'var(--cat-feed)',
  '肉類': 'var(--cat-meat)',
  '海鮮': 'var(--cat-seafood)',
  '蛋類': 'var(--cat-egg)',
  '穀物': 'var(--cat-grain)',
  '澱粉類': 'var(--cat-grain)',
  '根莖類': 'var(--cat-grain)',
  '蔬菜': 'var(--cat-veg)',
  '蔬菜類': 'var(--cat-veg)',
  '蔬果': 'var(--cat-veg)',
  '水果': 'var(--cat-fruit)',
  '水果類': 'var(--cat-fruit)',
  '油脂': 'var(--cat-oil)',
  '油脂類': 'var(--cat-oil)',
  '調味': 'var(--cat-condiment)',
  '種子': 'var(--cat-seed)',
};

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
          // 用食材自己的 category 對映顏色 (補充品(顆)/補充品(包) 各自獨立色)
          const color = CAT_COLOR[food.category] || 'var(--cat-default)';
          return el('button', {
            type: 'button',
            class: 'chip' + (isActive ? ' active' : ''),
            style: `--cat-color: ${color}`,
            'data-name': food.name,
            onclick: () => toggleFood(food)
          }, [
            el('span', { class: 'chip-icon' }, isActive ? '✓' : '+'),
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
      el('button', {
        type: 'button',
        class: 'recipe-name recipe-name-link',
        title: '查看營養成分詳情',
        onclick: () => showFoodDetail(item.food)
      }, [
        item.food.name,
        el('span', { class: 'recipe-name-info' }, 'ⓘ')
      ]),
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

    // === 牛磺酸特殊處理 (依體重 mg/kg 判斷, 不用 per_1000kcal) ===
    if (std.is_taurine) {
      const taurine_mg = (provided || 0) * 1000;  // food data is g, display mg
      const w = STATE.weight || 11.5;
      const cardiacMin = (std.cardiac_min_per_kg || 50) * w;
      const cardiacMax = (std.cardiac_max_per_kg || 100) * w;
      const adultMin = 8.7 * w;  // ≈100 mg total for 11.5kg
      const per_kg = w > 0 ? taurine_mg / w : 0;
      let status, statusLabel;
      if (per_kg < 8.7) {
        status = 'warn'; statusLabel = '不足';
      } else if (per_kg < 50) {
        status = 'warn'; statusLabel = '一般成犬足夠 / 心臟風險不足';
      } else if (per_kg <= 100) {
        status = 'ok'; statusLabel = '心臟預防範圍';
      } else if (per_kg <= 200) {
        status = 'ok'; statusLabel = '治療範圍';
      } else {
        status = 'warn'; statusLabel = '過量';
      }
      results.push({
        key: std.key,
        name: std.name,
        unit: std.unit || 'mg',
        provided: taurine_mg,
        dailyMin: cardiacMin,
        dailyRec: (cardiacMin + cardiacMax) / 2,
        dailyMax: cardiacMax,
        pct: cardiacMin > 0 ? taurine_mg / cardiacMin : null,
        status,
        statusLabel,
        note: std.note,
        is_taurine: true
      });
      continue;
    }
    // === end 牛磺酸 ===


    // AAFCO 沒給最低值時，用 NRC 建議值替代 (例如 EPA+DHA AAFCO 沒設、NRC 0.13g)
    const aafcoMin = std.aafco_min_per_1000kcal;
    const nrcRec = std.nrc_per_1000kcal;
    const minPer1000 = (aafcoMin != null && aafcoMin > 0) ? aafcoMin
                      : (nrcRec != null && nrcRec > 0 ? nrcRec : null);
    const dailyMin = minPer1000 != null ? minPer1000 * der / 1000 : null;
    const dailyRec = nrcRec != null ? nrcRec * der / 1000 : null;
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
    if (r.is_taurine) continue;     // 牛磺酸 status 已上方依 mg/kg 規則設定, 不覆蓋
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

// 營養素 key → section (用於分組顯示)
const NUTRIENT_SECTION = {
  kcal: 'macro', protein: 'macro', fat: 'macro', carb: 'macro',
  fiber: 'macro', omega6_g: 'macro', omega3_g: 'macro', epa_dha: 'macro',
  ca_mg: 'mineral', p_mg: 'mineral', k_mg: 'mineral', na_mg: 'mineral',
  cl_g: 'mineral', mg_mg: 'mineral', fe_mg: 'mineral', cu_mg: 'mineral',
  zn_mg: 'mineral', mn_mg: 'mineral', iodine_ug: 'mineral', se_ug: 'mineral',
  vita_iu: 'vitamin', vitd_iu: 'vitamin', vite_iu: 'vitamin', vitk_mg: 'vitamin',
  b1_mg: 'vitamin', b2_mg: 'vitamin', b3_mg: 'vitamin', b5_mg: 'vitamin',
  b6_mg: 'vitamin', b9_ug: 'vitamin', b12_ug: 'vitamin', choline_mg: 'vitamin',
  arg_g: 'aa', his_g: 'aa', ile_g: 'aa', leu_g: 'aa', lys_g: 'aa',
  met_g: 'aa', cys_g: 'aa', phe_g: 'aa', tyr_g: 'aa', thr_g: 'aa',
  trp_g: 'aa', val_g: 'aa', met_cys_g: 'aa', phe_tyr_g: 'aa',
  taurine_g: 'other',
};
const SECTION_LABELS = {
  macro: '巨量營養素',
  mineral: '礦物質',
  vitamin: '維生素',
  aa: '必需胺基酸',
  other: '參考用 / 心臟保健',
};

function renderDashboard(achievement) {
  const wrap = document.getElementById('dashboard');
  const summary = document.getElementById('dashboard-summary');
  wrap.innerHTML = '';

  if (Object.keys(STATE.recipe).length === 0) {
    wrap.appendChild(el('p', { class: 'empty-state' }, '加入食材後自動計算'));
    summary.hidden = true;
    return;
  }

  // 依 section 分組
  const sectionOrder = ['macro', 'mineral', 'vitamin', 'aa', 'other'];
  const grouped = { macro: [], mineral: [], vitamin: [], aa: [], other: [] };
  for (const r of achievement) {
    const sec = NUTRIENT_SECTION[r.key] || 'other';
    grouped[sec].push(r);
  }

  let cntOk = 0, cntWarn = 0, cntBad = 0;
  for (const sec of sectionOrder) {
    const items = grouped[sec];
    if (items.length === 0) continue;
    // Section header
    wrap.appendChild(el('div', { class: 'dash-section-header ' + sec }, SECTION_LABELS[sec]));
    for (const r of items) {
    const barWidth = r.pct != null
      ? Math.min(100, Math.max(2, r.pct * 100))
      : 0;

    // 建議區間 + 實際值
    const fmtVal = (v) => {
      if (v == null || !isFinite(v)) return '—';
      if (Math.abs(v) >= 100) return v.toFixed(0);
      if (Math.abs(v) >= 10) return v.toFixed(1);
      if (Math.abs(v) >= 0.1) return v.toFixed(2);
      return v.toFixed(3);
    };
    let rangeText = '';
    if (r.is_taurine) {
      // 牛磺酸特殊顯示: 心臟預防區間 (mg/kg)
      rangeText = `心臟預防 ${fmtVal(r.dailyMin)} ~ ${fmtVal(r.dailyMax)} (50-100 mg/kg)`;
    } else if (r.dailyMin != null && r.dailyMax != null) {
      rangeText = `建議 ${fmtVal(r.dailyMin)} ~ ${fmtVal(r.dailyMax)}`;
    } else if (r.dailyMin != null) {
      rangeText = `最低 ${fmtVal(r.dailyMin)}`;
    } else {
      rangeText = '參考用';
    }
    const providedText = `實際 ${fmtVal(r.provided)} ${r.unit || ''}`;

    const row = el('div', {
      class: 'dash-row status-' + r.status
    }, [
      el('div', { class: 'dash-row-main' }, [
        el('div', { class: 'dash-name' }, [
          r.name,
          el('span', { class: 'dash-unit' }, ' (' + (r.unit || '') + ')')
        ]),
        el('div', { class: 'dash-bar-wrap' },
          el('div', { class: 'dash-bar', style: `width: ${barWidth}%` })
        ),
        el('div', { class: 'dash-pct' }, fmtPct(r.pct))
      ]),
      el('div', { class: 'dash-detail' },
        r.is_taurine
          ? `${providedText} · ${rangeText}`
          + (r.statusLabel ? ` · ${r.statusLabel}` : '')
          : `${providedText} / ${rangeText}`
      )
    ]);
    wrap.appendChild(row);

    if (r.status === 'ok') cntOk++;
    else if (r.status === 'warn') cntWarn++;
    else if (r.status === 'bad') cntBad++;
  } // end items loop
  } // end sec loop

  document.getElementById('cnt-ok').textContent = cntOk;
  document.getElementById('cnt-warn').textContent = cntWarn;
  document.getElementById('cnt-bad').textContent = cntBad;
  summary.hidden = false;
}

// ============================================================
// 比例分析
// ============================================================
// 處理 composite keys (例如 met_cys_g = met_g + cys_g)
function getTotal(totals, key) {
  if (key === 'met_cys_g') return (totals.met_g || 0) + (totals.cys_g || 0);
  if (key === 'phe_tyr_g') return (totals.phe_g || 0) + (totals.tyr_g || 0);
  return totals[key] || 0;
}

function calcRatios(totals) {
  const results = [];
  for (const r of STATE.standards.ratios) {
    const num = getTotal(totals, r.numerator);
    const den = getTotal(totals, r.denominator);
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
// 食材詳情 Modal
// ============================================================
// 每筆食材按需求顯示不同基準: 1g / 1顆 / 1包 / 100g
const PER_1G_FOODS = new Set([
  'V-Integra', 'Canine Complete', 'Hypo Canine Complete',
  '黑芝麻粉', '鹽', '汪喵星球牛磺酸',
]);

function getDisplayBasis(food) {
  // OhPet 魚油 (顆) / Skin-5 / Pro-6 (包)
  if (food.unit === '顆' || food.unit === '包' || food.unit === '匙') {
    return {
      mult: food.gramsPerUnit || 1,
      basisLabel: `per 1 ${food.unit} (${food.gramsPerUnit}g)`,
      unitSuffix: '/' + food.unit,
    };
  }
  // 補充品粉類 / 種子 / 調味
  if (PER_1G_FOODS.has(food.name)) {
    return { mult: 1, basisLabel: 'per 1g', unitSuffix: '/g' };
  }
  // 其他食材
  return { mult: 100, basisLabel: 'per 100g', unitSuffix: '/100g' };
}

const DETAIL_SECTIONS = [
  {
    id: 'macro', label: '巨量營養素',
    fields: [
      { key: 'kcal', name: '熱量', unit: 'kcal' },
      { key: 'protein', name: '蛋白質', unit: 'g' },
      { key: 'fat', name: '脂肪', unit: 'g' },
      { key: 'carb', name: '碳水化合物', unit: 'g' },
      { key: 'fiber', name: '膳食纖維', unit: 'g' },
      { key: 'water_g', name: '水分', unit: 'g' },
    ]
  },
  {
    id: 'mineral', label: '礦物質',
    fields: [
      { key: 'ca_mg', name: '鈣 (Ca)', unit: 'mg' },
      { key: 'p_mg', name: '磷 (P)', unit: 'mg' },
      { key: 'k_mg', name: '鉀 (K)', unit: 'mg' },
      { key: 'na_mg', name: '鈉 (Na)', unit: 'mg' },
      { key: 'mg_mg', name: '鎂 (Mg)', unit: 'mg' },
      { key: 'fe_mg', name: '鐵 (Fe)', unit: 'mg' },
      { key: 'zn_mg', name: '鋅 (Zn)', unit: 'mg' },
      { key: 'cu_mg', name: '銅 (Cu)', unit: 'mg' },
      { key: 'mn_mg', name: '錳 (Mn)', unit: 'mg' },
      { key: 'iodine_ug', name: '碘 (I)', unit: 'μg' },
      { key: 'se_ug', name: '硒 (Se)', unit: 'μg' },
    ]
  },
  {
    id: 'vitamin', label: '維生素',
    fields: [
      { key: 'vita_iu', name: '維生素 A', unit: 'IU' },
      { key: 'vita_rae_ug', name: '維生素 A (RAE)', unit: 'μg' },
      { key: 'vitd_iu', name: '維生素 D', unit: 'IU' },
      { key: 'vite_mg', name: '維生素 E', unit: 'mg' },
      { key: 'vite_iu', name: '維生素 E', unit: 'IU' },
      { key: 'b1_mg', name: '維生素 B1 (硫胺素)', unit: 'mg' },
      { key: 'b2_mg', name: '維生素 B2 (核黃素)', unit: 'mg' },
      { key: 'b3_mg', name: '維生素 B3 (菸鹼酸)', unit: 'mg' },
      { key: 'b5_mg', name: '維生素 B5 (泛酸)', unit: 'mg' },
      { key: 'b6_mg', name: '維生素 B6 (吡哆醇)', unit: 'mg' },
      { key: 'b9_ug', name: '維生素 B9 (葉酸)', unit: 'μg' },
      { key: 'b12_ug', name: '維生素 B12', unit: 'μg' },
      { key: 'choline_mg', name: '膽鹼', unit: 'mg' },
    ]
  },
  {
    id: 'fa', label: 'Omega 脂肪酸',
    fields: [
      { key: 'omega6_g', name: 'Omega-6', unit: 'g' },
      { key: 'omega3_g', name: 'Omega-3', unit: 'g' },
    ]
  },
  {
    id: 'aa', label: '必需胺基酸',
    fields: [
      { key: 'arg_g', name: '精胺酸 (Arg)', unit: 'g' },
      { key: 'his_g', name: '組胺酸 (His)', unit: 'g' },
      { key: 'ile_g', name: '異白胺酸 (Ile)', unit: 'g' },
      { key: 'leu_g', name: '白胺酸 (Leu)', unit: 'g' },
      { key: 'lys_g', name: '離胺酸 (Lys)', unit: 'g' },
      { key: 'met_g', name: '甲硫胺酸 (Met)', unit: 'g' },
      { key: 'cys_g', name: '半胱胺酸 (Cys)', unit: 'g' },
      { key: 'phe_g', name: '苯丙胺酸 (Phe)', unit: 'g' },
      { key: 'tyr_g', name: '酪胺酸 (Tyr)', unit: 'g' },
      { key: 'thr_g', name: '蘇胺酸 (Thr)', unit: 'g' },
      { key: 'trp_g', name: '色胺酸 (Trp)', unit: 'g' },
      { key: 'val_g', name: '纈胺酸 (Val)', unit: 'g' },
    ]
  },
  {
    id: 'other', label: '其他 / 心臟保健',
    fields: [
      { key: 'taurine_g', name: '牛磺酸 (Taurine)', unit: 'g' },
    ]
  }
];

function fmtDetailValue(v) {
  if (v == null || !isFinite(v)) return '0';
  if (v === 0) return '0';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  if (Math.abs(v) >= 0.1) return v.toFixed(3);
  if (Math.abs(v) >= 0.001) return v.toFixed(4);
  return v.toFixed(5);
}

function showFoodDetail(food) {
  const modal = document.getElementById('food-modal');
  const title = document.getElementById('food-modal-title');
  const meta = document.getElementById('food-modal-meta');
  const body = document.getElementById('food-modal-body');

  title.textContent = food.name;
  const metaParts = [];
  if (food.en) metaParts.push(food.en);
  if (food.category) metaParts.push(food.category);
  if (food.unit) metaParts.push(`輸入單位: ${food.unit} (× ${food.gramsPerUnit} g)`);
  meta.textContent = metaParts.join(' · ');

  body.innerHTML = '';

  // 取得本食材的顯示基準 (每 1g / 1顆 / 1包 / 100g)
  const basis = getDisplayBasis(food);

  for (const sec of DETAIL_SECTIONS) {
    const rows = sec.fields.map(f => {
      const vPerG = food[f.key];
      const v = (vPerG || 0) * basis.mult;  // per 1g × multiplier
      const isZero = !v || v === 0;
      return el('tr', { class: isZero ? 'zero' : '' }, [
        el('td', { class: 'detail-name' }, f.name),
        el('td', { class: 'detail-value' }, fmtDetailValue(v)),
        el('td', { class: 'detail-unit' }, f.unit + basis.unitSuffix),
      ]);
    });
    const section = el('div', { class: 'detail-section ' + sec.id }, [
      el('div', { class: 'detail-section-title' }, `${sec.label} (${basis.basisLabel})`),
      el('table', { class: 'detail-table' },
        el('tbody', {}, rows)
      )
    ]);
    body.appendChild(section);
  }

  // 來源 / 備註
  if (food.source || food.notes) {
    const noteEl = el('div', { class: 'detail-source-note' });
    if (food.source) {
      noteEl.appendChild(el('div', {}, [
        el('span', { class: 'src-label' }, '資料來源：'),
        food.source
      ]));
    }
    if (food.notes) {
      noteEl.appendChild(el('div', { style: 'margin-top: 4px;' }, [
        el('span', { class: 'src-label' }, '備註：'),
        food.notes
      ]));
    }
    body.appendChild(noteEl);
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function hideFoodDetail() {
  document.getElementById('food-modal').hidden = true;
  document.body.style.overflow = '';
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

    // 食材詳情 modal close handlers
    document.getElementById('food-modal-close').addEventListener('click', hideFoodDetail);
    document.getElementById('food-modal-backdrop').addEventListener('click', hideFoodDetail);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideFoodDetail();
    });

    // 重新整理按鈕 — 強制抓最新版本 (清 cache + reload)
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        refreshBtn.disabled = true;
        refreshBtn.textContent = '...';
        try {
          // 清 service worker cache (如有)
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
        } catch (err) {
          console.warn('cache 清除失敗:', err);
        }
        // 強制重新載入 (附 timestamp 確保 cache miss)
        const ts = Date.now();
        const u = new URL(window.location.href);
        u.searchParams.set('_v', ts);
        window.location.replace(u.toString());
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

// Service Worker 註冊（network-first，避免舊版被 cache）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err =>
    console.warn('SW register failed:', err));
}

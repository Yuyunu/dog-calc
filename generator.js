/* ============================================================
   generator.js — 食譜生成 page UI 整合
   依賴: app.js (STATE, el, fmt), recipe-generator.js, diary.js
   ============================================================ */

'use strict';

(function () {

  const GEN_LS_KEY = 'dog_calc_v2_gen_state';

  const GEN = {
    days: 7,
    targetKcal: null,        // null = 跟 DER 走
    mode: 'closed',          // 'closed' | 'open'
    maxAuto: 5,
    selections: {},          // { foodName: { mode: 'lock'|'min'|'max'|'free', grams: number|null } }
    lastVariants: null
  };

  // ============================================================
  // localStorage
  // ============================================================
  function saveGen() {
    try {
      localStorage.setItem(GEN_LS_KEY, JSON.stringify({
        days: GEN.days,
        targetKcal: GEN.targetKcal,
        mode: GEN.mode,
        maxAuto: GEN.maxAuto,
        selections: GEN.selections
      }));
    } catch (e) { console.warn('gen save fail', e); }
  }
  function loadGen() {
    try {
      const raw = localStorage.getItem(GEN_LS_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.days != null) GEN.days = d.days;
      if (d.targetKcal !== undefined) GEN.targetKcal = d.targetKcal;
      if (d.mode) GEN.mode = d.mode;
      if (d.maxAuto != null) GEN.maxAuto = d.maxAuto;
      if (d.selections) GEN.selections = d.selections;
    } catch (e) { console.warn('gen load fail', e); }
  }

  // ============================================================
  // Util
  // ============================================================
  function fmtN(n, dec) {
    if (n == null || !isFinite(n)) return '—';
    if (dec == null) {
      if (Math.abs(n) >= 100) return n.toFixed(0);
      if (Math.abs(n) >= 10) return n.toFixed(1);
      return n.toFixed(2);
    }
    return n.toFixed(dec);
  }
  function fmtPctVal(p) {
    if (p == null || !isFinite(p)) return '—';
    return (p * 100).toFixed(0) + '%';
  }

  // ============================================================
  // 食材分類顏色 (跟計算器相同)
  // ============================================================
  const CAT_COLOR = {
    '補充品': 'var(--cat-supplement)',
    '補充品(顆)': 'var(--cat-supplement-cap)',
    '補充品(包)': 'var(--cat-supplement-pkt)',
    '補充品(匙)': 'var(--cat-supplement)',
    '飼料': 'var(--cat-feed)',
    '肉類': 'var(--cat-meat)', '牛肉': 'var(--cat-meat)',
    '豬肉': 'var(--cat-meat)', '雞肉': 'var(--cat-meat)',
    '海鮮': 'var(--cat-seafood)',
    '蛋類': 'var(--cat-egg)',
    '穀物': 'var(--cat-grain)', '澱粉類': 'var(--cat-grain)',
    '根莖類': 'var(--cat-grain)',
    '蔬菜': 'var(--cat-veg)', '蔬菜類': 'var(--cat-veg)', '蔬果': 'var(--cat-veg)',
    '水果': 'var(--cat-fruit)', '水果類': 'var(--cat-fruit)',
    '油脂': 'var(--cat-oil)', '油脂類': 'var(--cat-oil)',
    '調味': 'var(--cat-condiment)',
    '種子': 'var(--cat-seed)',
  };

  function groupFoodsForGen() {
    if (!STATE || !STATE.foods) return [];
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
  // Render: 食材 picker (跟計算器相同的 chip 樣式)
  // ============================================================
  function renderPicker() {
    const wrap = document.getElementById('gen-ingredient-picker');
    if (!wrap) return;
    wrap.innerHTML = '';
    const groups = groupFoodsForGen();
    for (const { category, foods } of groups) {
      const groupEl = el('div', { class: 'picker-group' }, [
        el('div', { class: 'picker-group-title' }, category),
        el('div', { class: 'picker-chips' },
          foods.map(food => {
            const isActive = !!GEN.selections[food.name];
            const color = CAT_COLOR[food.category] || 'var(--cat-default)';
            return el('button', {
              type: 'button',
              class: 'chip' + (isActive ? ' active' : ''),
              style: `--cat-color: ${color}`,
              onclick: () => toggleGenFood(food.name)
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

  function toggleGenFood(name) {
    if (GEN.selections[name]) {
      delete GEN.selections[name];
    } else {
      GEN.selections[name] = { mode: 'free', grams: null };
    }
    saveGen();
    renderPicker();
    renderSelectedList();
  }

  // ============================================================
  // Render: 已選食材 list (鎖定模式 + 克數)
  // ============================================================
  function renderSelectedList() {
    const wrap = document.getElementById('gen-selected-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    const names = Object.keys(GEN.selections);
    if (names.length === 0) {
      wrap.appendChild(el('p', { class: 'empty-state' }, '尚未選擇任何食材'));
      return;
    }
    for (const name of names) {
      const food = STATE.foods.find(f => f.name === name);
      if (!food) continue;
      const sel = GEN.selections[name];
      const row = el('div', { class: 'gen-sel-row' }, [
        el('div', { class: 'gen-sel-name' }, [
          el('span', {}, name),
          el('span', { class: 'gen-sel-name-cat' }, food.category || '')
        ]),
        el('div', { class: 'gen-sel-controls' }, [
          el('input', {
            type: 'number',
            placeholder: 'g',
            min: '0',
            step: '0.1',
            inputmode: 'decimal',
            value: sel.grams == null ? '' : sel.grams,
            oninput: e => {
              const v = e.target.value;
              if (v === '' || v == null) {
                sel.grams = null;
              } else {
                const n = parseFloat(v);
                sel.grams = isFinite(n) && n >= 0 ? n : null;
              }
              saveGen();
            }
          }),
          el('select', {
            onchange: e => { sel.mode = e.target.value; saveGen(); }
          }, [
            ['free', '自由調整'],
            ['lock', '鎖定份量'],
            ['min', '最少這個量'],
            ['max', '最多這個量'],
          ].map(([v, label]) => {
            const o = el('option', { value: v }, label);
            if (sel.mode === v) o.selected = true;
            return o;
          })),
          el('button', {
            class: 'gen-sel-remove',
            type: 'button',
            title: '移除',
            onclick: () => toggleGenFood(name)
          }, '✕'),
        ])
      ]);
      wrap.appendChild(row);
    }
  }

  // ============================================================
  // Render: kcal hint
  // ============================================================
  function renderKcalHint() {
    const w = STATE.weight, a = STATE.activity;
    const der = 70 * Math.pow(w, 0.75) * a;
    const target = (GEN.targetKcal != null && GEN.targetKcal > 0)
      ? GEN.targetKcal : der;
    const total = target * GEN.days;
    const hint = document.getElementById('gen-kcal-hint');
    if (!hint) return;
    hint.textContent = `DER = ${der.toFixed(0)} kcal/天 · ` +
      `目標 ${target.toFixed(0)} kcal/天 × ${GEN.days} 天 = 總 ${total.toFixed(0)} kcal`;
  }

  // ============================================================
  // Generate handler
  // ============================================================
  function handleGenerate() {
    const sels = Object.entries(GEN.selections).map(([name, s]) => ({
      foodName: name, mode: s.mode, grams: s.grams
    }));
    if (sels.length === 0) {
      alert('請至少勾選 1 樣食材');
      return;
    }
    const w = STATE.weight, a = STATE.activity;
    const der = 70 * Math.pow(w, 0.75) * a;
    const targetKcal = (GEN.targetKcal != null && GEN.targetKcal > 0)
      ? GEN.targetKcal : der;

    const out = window.RecipeGenerator.generate({
      foods: STATE.foods,
      standards: STATE.standards,
      weight: w,
      activity: a,
      targetKcal: targetKcal,
      selections: sels,
      mode: GEN.mode,
      maxAuto: GEN.maxAuto,
      numVariants: GEN.mode === 'open' ? 3 : 2
    });

    if (out.error) {
      alert(out.error);
      return;
    }
    GEN.lastVariants = out.variants;
    renderResults(out.variants, targetKcal);
  }

  // ============================================================
  // Render: 結果 (1-3 variants)
  // ============================================================
  function renderResults(variants, targetKcal) {
    const wrap = document.getElementById('gen-results');
    wrap.innerHTML = '';
    if (!variants || variants.length === 0) {
      wrap.appendChild(el('p', { class: 'empty-state' }, '無可用結果'));
      return;
    }
    variants.forEach((v, i) => {
      wrap.appendChild(renderVariant(v, i, targetKcal));
    });
    // 卷軸到結果區
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function renderVariant(v, idx, targetKcal) {
    // foods
    const foodsRows = v.foods.map(item => {
      const tagText = item.source === 'locked' ? '🔒鎖定'
        : item.source === 'auto' ? '✨自動補' : '勾選';
      const tagClass = item.source === 'locked' ? 'locked'
        : item.source === 'auto' ? 'auto' : 'user';
      const portionText = item.food.unit && item.food.unit !== 'g'
        ? `${item.portion.toFixed(1)} ${item.food.unit}`
        : '';
      return el('div', { class: 'gen-food-row' }, [
        el('div', { class: 'gen-food-name' }, [
          el('span', { class: 'gen-food-tag ' + tagClass }, tagText),
          item.food.name
        ]),
        el('div', { class: 'gen-food-grams' }, fmtN(item.grams, 1) + ' g'),
        el('div', { class: 'gen-food-portion' }, portionText)
      ]);
    });

    // mini dashboard — 只列關鍵營養
    const KEY_NUTRIENTS = [
      'kcal', 'protein', 'fat', 'omega6_g', 'omega3_g',
      'ca_mg', 'p_mg', 'k_mg', 'na_mg', 'fe_mg', 'zn_mg',
      'vita_iu', 'vitd_iu', 'vite_iu',
      'b1_mg', 'b12_ug', 'taurine_g'
    ];
    const dashRows = v.achievement
      .filter(a => KEY_NUTRIENTS.includes(a.key))
      .map(a => {
        const barW = a.pct != null ? Math.min(100, Math.max(2, a.pct * 100)) : 0;
        return el('div', { class: 'gen-mini-dash-row' }, [
          el('span', { class: 'gen-mini-dash-name' }, a.name),
          el('div', { class: 'gen-mini-dash-bar-wrap' },
            el('div', { class: 'gen-mini-dash-bar ' + a.status, style: `width:${barW}%` })
          ),
          el('span', { class: 'gen-mini-dash-pct' }, fmtPctVal(a.pct))
        ]);
      });

    // 總計
    const totalGrams = v.totals._totalGrams || 0;
    const totalsLine = el('div', { class: 'gen-variant-totals' }, [
      el('span', {}, `每日 ${totalGrams.toFixed(0)} g`),
      el('span', {}, `· ${v.kcal.toFixed(0)} kcal`),
      el('span', {}, `· 共 ${(totalGrams * GEN.days).toFixed(0)} g (${GEN.days} 天)`),
    ]);

    // 警示
    const children = [
      el('div', { class: 'gen-variant-header' }, [
        el('h3', { class: 'gen-variant-title' }, v.label),
        el('span', { class: 'gen-variant-meta' }, `${v.foods.length} 樣食材`)
      ]),
      el('div', { class: 'gen-variant-foods' }, foodsRows),
      totalsLine
    ];

    if (v.unmet && v.unmet.length > 0) {
      const list = v.unmet.slice(0, 6).map(u =>
        `${u.name} ${(u.pct * 100).toFixed(0)}%`
      ).join('、');
      children.push(el('div', { class: 'gen-variant-warn' }, [
        el('b', {}, '⚠️ 不足 (<80%)：'),
        ' ' + list
      ]));
    }
    if (v.overMax && v.overMax.length > 0) {
      const list = v.overMax.slice(0, 4).map(u => u.name).join('、');
      children.push(el('div', { class: 'gen-variant-bad' }, [
        el('b', {}, '🔴 超標：'),
        ' ' + list
      ]));
    }

    children.push(el('div', { class: 'gen-mini-dash' }, dashRows));

    children.push(el('div', { class: 'gen-variant-actions' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => adoptVariant(v)
      }, '✓ 採用此食譜'),
      el('button', {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: () => openSaveModal(v)
      }, '💾 儲存到食譜庫')
    ]));

    return el('div', { class: 'gen-variant' }, children);
  }

  // ============================================================
  // 採用食譜 → 帶入計算器
  // ============================================================
  function adoptVariant(v) {
    if (!confirm('將此食譜帶入「📊 計算器」分頁？\n會覆蓋目前計算器的食材清單。')) return;
    STATE.recipe = {};
    for (const item of v.foods) {
      STATE.recipe[item.food.name] = {
        food: item.food,
        portion: Math.round((item.portion || 0) * 10) / 10
      };
    }
    if (typeof saveState === 'function') saveState();
    if (typeof switchTab === 'function') switchTab('calculator');
    if (typeof rerender === 'function') rerender();
  }

  // ============================================================
  // 儲存到食譜庫 modal
  // ============================================================
  let CURRENT_VARIANT = null;
  function openSaveModal(v) {
    CURRENT_VARIANT = v;
    const lines = v.foods.map(item => {
      const portionText = item.food.unit && item.food.unit !== 'g'
        ? `${item.portion.toFixed(1)} ${item.food.unit}`
        : `${item.grams.toFixed(0)} g`;
      const tag = item.source === 'auto' ? ' ✨' : '';
      return `• ${item.food.name} ${portionText}${tag}`;
    });
    const today = new Date();
    const ds = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    document.getElementById('gen-save-name').value = `生成配方 ${ds} · ${v.label}`;
    document.getElementById('gen-save-summary').value =
      `[食譜生成・${v.label}] · ${v.kcal.toFixed(0)} kcal/天 · ${GEN.days} 天份\n` +
      lines.join('\n');
    document.getElementById('gen-save-modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSaveModal() {
    document.getElementById('gen-save-modal').hidden = true;
    document.body.style.overflow = '';
    CURRENT_VARIANT = null;
  }
  function confirmSave() {
    if (!CURRENT_VARIANT) return;
    const name = document.getElementById('gen-save-name').value.trim() || '未命名生成食譜';
    const summary = document.getElementById('gen-save-summary').value.trim();
    const ingredients = {};
    for (const item of CURRENT_VARIANT.foods) {
      const portion = Math.round((item.portion || 0) * 10) / 10;
      if (portion > 0) ingredients[item.food.name] = portion;
    }
    if (!window.DIARY_STATE) {
      // diary not loaded — fallback: write LS directly under same key
      try {
        const raw = localStorage.getItem('dog_calc_v2_diary');
        const data = raw ? JSON.parse(raw) : { saved_recipes: [], feeding_log: [], events: [] };
        data.saved_recipes = data.saved_recipes || [];
        data.saved_recipes.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name, ingredients, summary,
          created_at: new Date().toISOString().slice(0, 10),
          source: 'generator'
        });
        localStorage.setItem('dog_calc_v2_diary', JSON.stringify(data));
      } catch (e) { alert('儲存失敗：' + e.message); return; }
    } else {
      window.DIARY_STATE.saved_recipes.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name, ingredients, summary,
        created_at: new Date().toISOString().slice(0, 10),
        source: 'generator'
      });
      if (typeof saveDiary === 'function') saveDiary();
    }
    closeSaveModal();
    alert('✓ 已儲存到食譜庫');
  }

  // ============================================================
  // 清除全部
  // ============================================================
  function clearAllSelections() {
    if (Object.keys(GEN.selections).length === 0) return;
    if (!confirm('清除所有已選食材？')) return;
    GEN.selections = {};
    saveGen();
    renderPicker();
    renderSelectedList();
  }

  // ============================================================
  // Init
  // ============================================================
  function initGenerator() {
    // STATE 是 app.js 的 top-level const,在 browser 不會自動掛到 window 上
    // 用 typeof check 避免 ReferenceError, 直接讀取 lexical-scope 的 STATE
    if (typeof STATE === 'undefined' || !STATE.foods || STATE.foods.length === 0 || !STATE.standards) {
      // 等 app.js 載完資料
      setTimeout(initGenerator, 200);
      return;
    }
    loadGen();

    // 基本參數
    const daysInput = document.getElementById('gen-days');
    daysInput.value = GEN.days;
    daysInput.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (isFinite(v) && v >= 1 && v <= 30) {
        GEN.days = v;
        saveGen();
        renderKcalHint();
      }
    });

    const kcalInput = document.getElementById('gen-target-kcal');
    if (GEN.targetKcal != null) kcalInput.value = GEN.targetKcal;
    kcalInput.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      GEN.targetKcal = isFinite(v) && v > 0 ? v : null;
      saveGen();
      renderKcalHint();
    });

    // 模式 radio
    document.querySelectorAll('input[name="gen-mode"]').forEach(r => {
      r.checked = (r.value === GEN.mode);
      r.addEventListener('change', e => {
        GEN.mode = e.target.value;
        document.getElementById('gen-maxauto-wrap').hidden = (GEN.mode !== 'open');
        saveGen();
      });
    });
    document.getElementById('gen-maxauto-wrap').hidden = (GEN.mode !== 'open');

    // 自動補上限 slider
    const slider = document.getElementById('gen-maxauto');
    const sliderVal = document.getElementById('gen-maxauto-val');
    slider.value = GEN.maxAuto;
    sliderVal.textContent = GEN.maxAuto;
    slider.addEventListener('input', e => {
      GEN.maxAuto = parseInt(e.target.value, 10) || 5;
      sliderVal.textContent = GEN.maxAuto;
      saveGen();
    });

    // 生成
    document.getElementById('gen-generate-btn').addEventListener('click', handleGenerate);

    // 清除
    document.getElementById('gen-clear-all').addEventListener('click', clearAllSelections);

    // Save modal
    document.getElementById('gen-save-confirm').addEventListener('click', confirmSave);
    document.querySelectorAll('[data-close="gensave"]').forEach(el => {
      el.addEventListener('click', closeSaveModal);
    });

    // 初次 render
    renderPicker();
    renderSelectedList();
    renderKcalHint();
  }

  function onShow() {
    // 切到 tab 時重整 hint (可能體重/活動係數有變)
    renderKcalHint();
    // 確保 picker / list 是最新 (例如另一頁清空了 selections — 不會, 但保險)
    renderPicker();
    renderSelectedList();
  }

  window.GeneratorUI = { onShow };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGenerator);
  } else {
    initGenerator();
  }

})();

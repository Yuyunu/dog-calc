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
    maxAuto: 5,              // legacy global cap (保留以防舊 LS, 新邏輯用 maxAutoByCat)
    maxAutoByCat: {          // 開放模式各類自動補上限
      meat: 2, veg: 2, fruit: 1, egg: 1, grain: 1, oil: 1, supp: 3
    },
    minAutoByCat: {          // 各類至少補幾樣 (強制) — 0 = 不強制
      meat: 0, veg: 0, fruit: 0, egg: 0, grain: 0, oil: 0, supp: 0
    },
    selections: {},          // { foodName: { mode: 'lock'|'min'|'max'|'free', grams: number|null } }
    exclusions: {},          // { foodName: true } — 排除的食材, 演算法絕不會選
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
        maxAutoByCat: GEN.maxAutoByCat,
        minAutoByCat: GEN.minAutoByCat,
        selections: GEN.selections,
        exclusions: GEN.exclusions
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
      if (d.maxAutoByCat) Object.assign(GEN.maxAutoByCat, d.maxAutoByCat);
      if (d.minAutoByCat) Object.assign(GEN.minAutoByCat, d.minAutoByCat);
      if (d.selections) GEN.selections = d.selections;
      if (d.exclusions) GEN.exclusions = d.exclusions;
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
            const isExcluded = !!GEN.exclusions[food.name];
            const color = CAT_COLOR[food.category] || 'var(--cat-default)';
            let cls = 'chip';
            let icon = '+';
            if (isActive) { cls += ' active'; icon = '✓'; }
            else if (isExcluded) { cls += ' excluded'; icon = '✗'; }
            return el('button', {
              type: 'button',
              class: cls,
              style: `--cat-color: ${color}`,
              onclick: () => toggleGenFood(food.name)
            }, [
              el('span', { class: 'chip-icon' }, icon),
              food.name
            ]);
          })
        )
      ]);
      wrap.appendChild(groupEl);
    }
  }

  // 3-state 循環: 未選(+) → 選用(✓) → 排除(✗) → 未選(+)
  function toggleGenFood(name) {
    if (GEN.exclusions[name]) {
      // ✗ → +
      delete GEN.exclusions[name];
    } else if (GEN.selections[name]) {
      // ✓ → ✗
      delete GEN.selections[name];
      GEN.exclusions[name] = true;
    } else {
      // + → ✓
      GEN.selections[name] = { mode: 'free', portion: null };
    }
    saveGen();
    renderPicker();
    renderSelectedList();
  }

  // 從舊 LS 格式 (s.grams) 轉到新格式 (s.portion in native unit)
  function migrateSelections() {
    for (const [name, sel] of Object.entries(GEN.selections)) {
      if (sel.grams != null && sel.portion == null) {
        const food = STATE.foods.find(f => f.name === name);
        const gpu = (food && food.gramsPerUnit) || 1;
        sel.portion = sel.grams / gpu;
      }
      delete sel.grams;
    }
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
      const unit = food.unit || 'g';
      const gpu = food.gramsPerUnit || 1;
      const stepStr = (unit === '顆' || unit === '包' || unit === '匙') ? '0.5' : '0.1';
      // 一行: [食材名] [input+unit] [模式] [✕]
      // 中文 1 字 ≈ 2 byte, 英文 1 字 = 1 byte. 用粗略寬度判斷:
      // 中文 > 5 字 或 英文/混合 > 8 字 → long
      const isLong = name.length > 7 ||
        (/[A-Za-z]/.test(name) && name.length > 6);
      const row = el('div', { class: 'gen-sel-row' }, [
        el('span', { class: 'gen-sel-name' + (isLong ? ' long' : '') }, name),
        el('div', { class: 'gen-sel-input-wrap' }, [
          el('input', {
            type: 'number',
            placeholder: `${GEN.days}天總量`,
            min: '0',
            step: stepStr,
            inputmode: 'decimal',
            value: sel.portion == null ? '' : sel.portion,
            oninput: e => {
              const v = e.target.value;
              if (v === '' || v == null) {
                sel.portion = null;
              } else {
                const n = parseFloat(v);
                sel.portion = isFinite(n) && n >= 0 ? n : null;
              }
              saveGen();
            }
          }),
          el('span', { class: 'gen-sel-unit' }, unit),
        ]),
        el('select', {
          class: 'gen-sel-mode',
          onchange: e => { sel.mode = e.target.value; saveGen(); }
        }, [
          ['free', '自由'],
          ['lock', '鎖定'],
          ['min', '最少'],
          ['max', '最多'],
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
      ]);
      wrap.appendChild(row);
    }
  }

  // ============================================================
  // Render: kcal hint + 總量 hint
  // ============================================================
  function renderKcalHint() {
    const w = STATE.weight, a = STATE.activity;
    const der = 70 * Math.pow(w, 0.75) * a;
    const target = (GEN.targetKcal != null && GEN.targetKcal > 0)
      ? GEN.targetKcal : der;
    const total = target * GEN.days;
    const hint = document.getElementById('gen-kcal-hint');
    if (hint) {
      hint.textContent = `DER = ${der.toFixed(0)} kcal/天 · ` +
        `目標 ${target.toFixed(0)} kcal/天 × ${GEN.days} 天 = 總 ${total.toFixed(0)} kcal`;
    }
    // 總量提示 (跟天數聯動)
    const totalHint = document.getElementById('gen-total-hint');
    if (totalHint) {
      totalHint.innerHTML = `⚠️ 以下克數為 <b>${GEN.days} 天總量</b>（每日量 = 總量 ÷ 天數）`;
    }
    // 已選食材的 placeholder 也聯動 (跟 unit 連動)
    document.querySelectorAll('.gen-sel-row input[type="number"]').forEach(inp => {
      inp.placeholder = `${GEN.days}天總量`;
    });
  }

  // ============================================================
  // Generate handler
  // ============================================================
  function handleGenerate() {
    const days = Math.max(1, GEN.days || 1);
    // 使用者輸入 = N 天總量 (in food's native unit, e.g. 5 顆 / 300 g)
    // 轉換: portion × gramsPerUnit = 總克數 → / days = 每日克數
    const sels = Object.entries(GEN.selections).map(([name, s]) => {
      const food = STATE.foods.find(f => f.name === name);
      const gpu = (food && food.gramsPerUnit) || 1;
      const dailyG = (s.portion != null && isFinite(s.portion))
        ? (s.portion * gpu) / days
        : null;
      return { foodName: name, mode: s.mode, grams: dailyG };
    });
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
      targetKcal: targetKcal,    // 每日 kcal
      selections: sels,           // 每日量
      exclusions: Object.keys(GEN.exclusions),  // 排除食材名稱列表
      mode: GEN.mode,
      maxAutoByCat: GEN.maxAutoByCat,  // 各類自動補上限
      minAutoByCat: GEN.minAutoByCat,  // 各類強制最少
      maxAuto: GEN.maxAuto,            // legacy fallback
      numVariants: GEN.mode === 'open' ? 3 : 2
    });

    if (out.error) {
      alert(out.error);
      return;
    }
    GEN.lastVariants = out.variants;
    renderResults(out.variants, targetKcal, days);
  }

  // ============================================================
  // 全營養儀表板分組 (跟計算器頁同樣 5 大分區)
  // ============================================================
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
    macro: '巨量營養素', mineral: '礦物質', vitamin: '維生素',
    aa: '必需胺基酸', other: '參考用 / 心臟保健'
  };

  function fmtNutVal(v) {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    if (Math.abs(v) >= 0.1) return v.toFixed(2);
    return v.toFixed(3);
  }

  // ============================================================
  // DM (乾物質) 分析 — 跟計算器頁同樣
  // ============================================================
  function renderDMSection(totals) {
    const total = totals._totalGrams || 0;
    const water = totals.water_g || 0;
    const dry = Math.max(0, total - water);
    const protein = totals.protein || 0;
    const fat = totals.fat || 0;
    const carb = totals.carb || 0;
    const fiber = totals.fiber || 0;

    const fmtG = v => fmtNutVal(v) + ' g';
    const fmtPctDM = v => dry > 0 ? (v / dry * 100).toFixed(1) + '%' : '—';

    const rows = [
      el('div', { class: 'dm-row dm-header' }, [
        el('span', {}, '項目'), el('span', {}, '總量'), el('span', {}, '佔乾物比')
      ]),
      el('div', { class: 'dm-row dm-meta' }, [
        el('span', { class: 'dm-name' }, '總食物重量'),
        el('span', { class: 'dm-amount' }, fmtG(total)),
        el('span', {}, '')
      ]),
      el('div', { class: 'dm-row dm-meta' }, [
        el('span', { class: 'dm-name' }, '總水分'),
        el('span', { class: 'dm-amount' }, fmtG(water)),
        el('span', {}, '')
      ]),
      el('div', { class: 'dm-row dm-meta dm-em' }, [
        el('span', { class: 'dm-name' }, '乾物質重量'),
        el('span', { class: 'dm-amount' }, fmtG(dry)),
        el('span', {}, '')
      ]),
      el('div', { class: 'dm-row' }, [
        el('span', { class: 'dm-name' }, '蛋白質'),
        el('span', { class: 'dm-amount' }, fmtG(protein)),
        el('span', { class: 'dm-pct' }, fmtPctDM(protein))
      ]),
      el('div', { class: 'dm-row' }, [
        el('span', { class: 'dm-name' }, '脂肪'),
        el('span', { class: 'dm-amount' }, fmtG(fat)),
        el('span', { class: 'dm-pct' }, fmtPctDM(fat))
      ]),
      el('div', { class: 'dm-row' }, [
        el('span', { class: 'dm-name' }, '碳水化合物'),
        el('span', { class: 'dm-amount' }, fmtG(carb)),
        el('span', { class: 'dm-pct' }, fmtPctDM(carb))
      ]),
      el('div', { class: 'dm-row' }, [
        el('span', { class: 'dm-name' }, '膳食纖維'),
        el('span', { class: 'dm-amount' }, fmtG(fiber)),
        el('span', { class: 'dm-pct' }, fmtPctDM(fiber))
      ]),
    ];

    return el('div', { class: 'gen-full-section' }, [
      el('div', { class: 'gen-full-section-title' }, '乾物質基礎分析'),
      el('p', { class: 'hint', style: 'margin: 0 0 6px 0; font-size: 11px;' }, '乾物質 = 總食物 − 水分'),
      el('div', { class: 'dm-grid' }, rows)
    ]);
  }

  // ============================================================
  // 比例分析 — 跟計算器頁同樣
  // ============================================================
  function getTotalRatio(totals, key) {
    if (key === 'met_cys_g') return (totals.met_g || 0) + (totals.cys_g || 0);
    if (key === 'phe_tyr_g') return (totals.phe_g || 0) + (totals.tyr_g || 0);
    return totals[key] || 0;
  }

  function calcRatiosLocal(totals) {
    const results = [];
    for (const r of STATE.standards.ratios) {
      const num = getTotalRatio(totals, r.numerator);
      const den = getTotalRatio(totals, r.denominator);
      let value;
      if (den === 0) value = null;
      else if (r.scale) value = num / den * r.scale;
      else value = num / den;
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
      results.push(Object.assign({}, r, { value, status, warning }));
    }
    return results;
  }

  function renderRatiosSection(totals) {
    const ratios = calcRatiosLocal(totals);
    const wrap = el('div', { class: 'ratios' });
    for (const r of ratios) {
      const idealLabel = r.ideal_label
        ? r.ideal_label
        : (r.ideal_min != null && r.ideal_max != null
            ? `${r.ideal_min}~${r.ideal_max}`
            : (r.ideal_min != null ? `≥${r.ideal_min}` : ''));
      const statusClass = r.status === 'warn-low' || r.status === 'warn-high'
        ? 'warn' : r.status;

      const children = [
        el('div', { class: 'ratio-row-main' }, [
          el('div', { class: 'ratio-name' }, [
            r.name,
            idealLabel ? el('span', { class: 'ratio-ideal' }, ' (' + idealLabel + ')') : null
          ]),
          el('div', { class: 'ratio-value ' + statusClass },
            r.value == null ? '—' : fmtNutVal(r.value))
        ])
      ];
      if (r.warning && (r.status === 'warn-low' || r.status === 'warn-high')) {
        children.push(el('div', { class: 'ratio-warning' }, [
          el('span', { class: 'ratio-warning-icon' },
            r.status === 'warn-low' ? '↓' : '↑'),
          ' ',
          r.warning
        ]));
      }
      wrap.appendChild(el('div', { class: 'ratio-row status-' + statusClass }, children));
    }
    return el('div', { class: 'gen-full-section' }, [
      el('div', { class: 'gen-full-section-title' }, '比例分析'),
      wrap
    ]);
  }

  function renderFullDash(achievement) {
    const sectionOrder = ['macro', 'mineral', 'vitamin', 'aa', 'other'];
    const grouped = { macro: [], mineral: [], vitamin: [], aa: [], other: [] };
    for (const r of achievement) {
      const sec = NUTRIENT_SECTION[r.key] || 'other';
      grouped[sec].push(r);
    }
    const wrap = el('div', { class: 'dashboard gen-full-dash' });
    for (const sec of sectionOrder) {
      const items = grouped[sec];
      if (!items || items.length === 0) continue;
      wrap.appendChild(el('div', { class: 'dash-section-header ' + sec }, SECTION_LABELS[sec]));
      for (const r of items) {
        const barWidth = r.pct != null ? Math.min(100, Math.max(2, r.pct * 100)) : 0;
        let rangeText = '';
        if (r.is_taurine) {
          rangeText = `心臟預防 ${fmtNutVal(r.dailyMin)} ~ ${fmtNutVal(r.dailyMax)} (50-100 mg/kg)`;
        } else if (r.dailyMin != null && r.dailyMax != null) {
          rangeText = `建議 ${fmtNutVal(r.dailyMin)} ~ ${fmtNutVal(r.dailyMax)}`;
        } else if (r.dailyMin != null) {
          rangeText = `最低 ${fmtNutVal(r.dailyMin)}`;
        } else {
          rangeText = '參考用';
        }
        const providedText = `實際 ${fmtNutVal(r.provided)} ${r.unit || ''}`;
        wrap.appendChild(el('div', { class: 'dash-row status-' + r.status }, [
          el('div', { class: 'dash-row-main' }, [
            el('div', { class: 'dash-name' }, [
              r.name,
              el('span', { class: 'dash-unit' }, ' (' + (r.unit || '') + ')')
            ]),
            el('div', { class: 'dash-bar-wrap' },
              el('div', { class: 'dash-bar', style: `width: ${barWidth}%` })
            ),
            el('div', { class: 'dash-pct' }, fmtPctVal(r.pct))
          ]),
          el('div', { class: 'dash-detail' },
            r.is_taurine ? `${providedText} · ${rangeText}` : `${providedText} / ${rangeText}`
          )
        ]));
      }
    }
    return wrap;
  }

  // ============================================================
  // Render: 結果 (1-3 variants)
  // ============================================================
  function renderResults(variants, targetKcal, days) {
    const wrap = document.getElementById('gen-results');
    wrap.innerHTML = '';
    if (!variants || variants.length === 0) {
      wrap.appendChild(el('p', { class: 'empty-state' }, '無可用結果'));
      return;
    }
    variants.forEach((v, i) => {
      wrap.appendChild(renderVariant(v, i, targetKcal, days));
    });
    // 卷軸到結果區
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function renderVariant(v, idx, targetKcal, days) {
    days = days || 1;
    // foods — 同時顯示「每日」和「N 天總量」
    const foodsRows = v.foods.map(item => {
      const tagText = item.source === 'locked' ? '🔒鎖定'
        : item.source === 'auto' ? '✨自動補' : '勾選';
      const tagClass = item.source === 'locked' ? 'locked'
        : item.source === 'auto' ? 'auto' : 'user';
      const dailyG = item.grams || 0;
      const totalG = dailyG * days;
      // 顯示順序: 每日量 (主) · 總量 (次)
      let portionDetail;
      if (item.food.unit && item.food.unit !== 'g') {
        const dailyP = item.portion;
        const totalP = dailyP * days;
        portionDetail = `每日 ${dailyP.toFixed(1)} ${item.food.unit} (${dailyG.toFixed(1)}g) · 總量 ${totalP.toFixed(1)} ${item.food.unit} (${totalG.toFixed(1)}g)`;
      } else {
        portionDetail = `每日 ${dailyG.toFixed(1)}g · 總量 ${totalG.toFixed(1)}g`;
      }
      return el('div', { class: 'gen-food-row' }, [
        el('div', { class: 'gen-food-name' }, [
          el('span', { class: 'gen-food-tag ' + tagClass }, tagText),
          item.food.name
        ]),
        el('div', { class: 'gen-food-grams' }, fmtN(dailyG, 1) + ' g/天'),
        el('div', { class: 'gen-food-portion' }, `總 ${fmtN(totalG, 0)}g`)
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
      el('span', {}, `· ${v.kcal.toFixed(0)} kcal/天`),
      el('span', {}, `· ${days} 天共 ${(totalGrams * days).toFixed(0)} g`),
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

    // 完整營養分析 (折疊) — 跟計算器頁同樣分區/呈現
    // 包含: 達標儀表板 + 乾物質% + 比例分析
    const fullDashDetails = document.createElement('details');
    fullDashDetails.className = 'gen-full-dash-wrap';
    const summary = document.createElement('summary');
    summary.innerHTML = '📋 <b>完整營養分析</b>（達標儀表板 + 乾物質% + 比例分析，點開展開）';
    fullDashDetails.appendChild(summary);

    const fullBody = document.createElement('div');
    fullBody.className = 'gen-full-body';
    // 1. 達標儀表板
    fullBody.appendChild(el('div', { class: 'gen-full-section' }, [
      el('div', { class: 'gen-full-section-title' }, '達標儀表板'),
      renderFullDash(v.achievement)
    ]));
    // 2. 乾物質基礎分析
    fullBody.appendChild(renderDMSection(v.totals));
    // 3. 比例分析
    fullBody.appendChild(renderRatiosSection(v.totals));
    fullDashDetails.appendChild(fullBody);
    children.push(fullDashDetails);

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
    if (!confirm('將此食譜的「每日量」帶入「📊 計算器」分頁？\n（計算器顯示每日營養達標，會覆蓋目前清單）')) return;
    STATE.recipe = {};
    for (const item of v.foods) {
      // 計算器 = 每日量 (跟生成 algo 內部一致)
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
    const days = GEN.days || 1;
    const lines = v.foods.map(item => {
      const dailyG = item.grams || 0;
      const totalG = dailyG * days;
      let line;
      if (item.food.unit && item.food.unit !== 'g') {
        const dailyP = item.portion;
        const totalP = dailyP * days;
        line = `• ${item.food.name} 每日 ${dailyP.toFixed(1)} ${item.food.unit} (${dailyG.toFixed(1)}g) · 總 ${totalP.toFixed(1)} ${item.food.unit} (${totalG.toFixed(0)}g)`;
      } else {
        line = `• ${item.food.name} 每日 ${dailyG.toFixed(1)}g · 總 ${totalG.toFixed(0)}g`;
      }
      if (item.source === 'auto') line += ' ✨';
      return line;
    });
    const today = new Date();
    const ds = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    document.getElementById('gen-save-name').value = `生成配方 ${ds} · ${v.label}`;
    document.getElementById('gen-save-summary').value =
      `[食譜生成・${v.label}] · ${v.kcal.toFixed(0)} kcal/天 · ${days} 天份\n` +
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
    const days = GEN.days || 1;
    // 食譜庫存「每日量」 (跟日誌頁原本格式相容)
    // 額外 metadata 存 days_designed_for + total_grams_designed (未來日曆 / 總量計算用)
    const ingredients = {};
    for (const item of CURRENT_VARIANT.foods) {
      const portion = Math.round((item.portion || 0) * 10) / 10;
      if (portion > 0) ingredients[item.food.name] = portion;
    }
    const totalGramsDaily = CURRENT_VARIANT.totals._totalGrams || 0;
    const recipeObj = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name, ingredients, summary,
      created_at: new Date().toISOString().slice(0, 10),
      source: 'generator',
      days_designed_for: days,
      total_grams_per_day: Math.round(totalGramsDaily * 10) / 10,
      total_grams_designed: Math.round(totalGramsDaily * days * 10) / 10
    };
    if (!window.DIARY_STATE) {
      try {
        const raw = localStorage.getItem('dog_calc_v2_diary');
        const data = raw ? JSON.parse(raw) : { saved_recipes: [], feeding_log: [], events: [] };
        data.saved_recipes = data.saved_recipes || [];
        data.saved_recipes.push(recipeObj);
        localStorage.setItem('dog_calc_v2_diary', JSON.stringify(data));
      } catch (e) { alert('儲存失敗：' + e.message); return; }
    } else {
      window.DIARY_STATE.saved_recipes.push(recipeObj);
      if (typeof saveDiary === 'function') saveDiary();
    }
    closeSaveModal();
    alert('✓ 已儲存到食譜庫 (含每日量 + ' + days + ' 天總量 metadata)');
  }

  // ============================================================
  // 清除全部
  // ============================================================
  function clearAllSelections() {
    const hasAny = Object.keys(GEN.selections).length > 0
      || Object.keys(GEN.exclusions).length > 0;
    if (!hasAny) return;
    if (!confirm('清除所有已選食材 + 排除設定？')) return;
    GEN.selections = {};
    GEN.exclusions = {};
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
    migrateSelections();   // 舊 LS s.grams → 新 s.portion (in native unit)

    // 基本參數
    const daysInput = document.getElementById('gen-days');
    daysInput.value = GEN.days;
    daysInput.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (isFinite(v) && v >= 1 && v <= 30) {
        GEN.days = v;
        saveGen();
        renderKcalHint();      // 同步更新總量提示 + placeholder
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

    // 自動補上限 — 各類 number input (最多)
    document.querySelectorAll('.gen-cat-max').forEach(inp => {
      const cat = inp.dataset.catMax;
      if (GEN.maxAutoByCat[cat] != null) inp.value = GEN.maxAutoByCat[cat];
      inp.addEventListener('input', e => {
        let n = parseInt(e.target.value, 10);
        if (!isFinite(n) || n < 0) n = 0;
        const hardMax = parseInt(e.target.max, 10) || 10;
        if (n > hardMax) n = hardMax;
        GEN.maxAutoByCat[cat] = n;
        // min 不能 > max
        const minInput = document.querySelector(`[data-cat-min="${cat}"]`);
        if (minInput && parseInt(minInput.value, 10) > n) {
          minInput.value = n;
          GEN.minAutoByCat[cat] = n;
        }
        saveGen();
      });
      inp.addEventListener('blur', e => {
        // blur 時把值寫回 (清掉非法)
        e.target.value = GEN.maxAutoByCat[cat];
      });
    });
    // 自動補下限 — 各類 number input (最少, 強制)
    document.querySelectorAll('.gen-cat-min').forEach(inp => {
      const cat = inp.dataset.catMin;
      if (GEN.minAutoByCat[cat] != null) inp.value = GEN.minAutoByCat[cat];
      inp.addEventListener('input', e => {
        let n = parseInt(e.target.value, 10);
        if (!isFinite(n) || n < 0) n = 0;
        const max = GEN.maxAutoByCat[cat] != null ? GEN.maxAutoByCat[cat] : 0;
        if (n > max) n = max;
        GEN.minAutoByCat[cat] = n;
        saveGen();
      });
      inp.addEventListener('blur', e => {
        e.target.value = GEN.minAutoByCat[cat];
      });
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

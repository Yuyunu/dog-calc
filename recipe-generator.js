/* ============================================================
   recipe-generator.js — 食譜生成 heuristic
   ============================================================
   純函式 module, 不依賴 DOM
   匯出: window.RecipeGenerator.generate(opts)

   Opts:
     foods: STATE.foods (全部食材)
     standards: STATE.standards
     weight: kg
     activity: number
     targetKcal: kcal/天 (預設 = der)
     selections: [
       { foodName, mode: 'lock' | 'min' | 'max' | 'free', grams: number|null }
     ]
     mode: 'closed' | 'open'
     maxAuto: 1-10  (open 模式下最多自動補幾樣)
     standard: 'aafco_adult' | 'aafco_growth' | 'nrc_adult'  (儲備擴充)
     numVariants: 1-3

   Returns:
     {
       variants: [
         {
           label, foods: [{food, grams, portion, source, locked}],
           totals, achievement, kcal,
           unmet: [{key, name, pct}],   // 達不到 80% 的營養
           autoAdded: [foodName...]
         }
       ],
       error?: '...'
     }
   ============================================================ */

'use strict';

(function () {

  // ============================================================
  // Step size helpers (依食材決定每次貪心增加多少 grams)
  // ============================================================
  const PER_1G_FOODS = new Set([
    'V-Integra', 'Canine Complete', 'Hypo Canine Complete',
    '黑芝麻粉', '鹽', '汪喵星球牛磺酸',
  ]);

  function stepGramsFor(food) {
    // 「顆/包/匙」單位 → 一單位
    if (food.unit === '顆' || food.unit === '包' || food.unit === '匙') {
      return food.gramsPerUnit || 1;
    }
    // 補充品粉類 / 種子 / 調味
    if (PER_1G_FOODS.has(food.name)) return 1;
    // 油脂類 → 1g step (一茶匙 ≈ 5g 但太多)
    if ((food.category || '').startsWith('油')) return 1;
    // 飼料 → 5g
    // 肉/海鮮/蛋/蔬菜/水果/穀物 → 5g
    return 5;
  }

  // 一個食材在自由補充時的最大 grams 上限 (heuristic, 防止演算法瘋狂塞單一食材)
  function maxGramsFor(food, totalCalCap) {
    if (food.unit === '顆') return 6 * (food.gramsPerUnit || 1);   // 最多 6 顆
    if (food.unit === '包') return 4 * (food.gramsPerUnit || 1);   // 最多 4 包
    if (food.unit === '匙') return 8 * (food.gramsPerUnit || 1);
    if (PER_1G_FOODS.has(food.name)) return 12;                    // 12g 粉
    if ((food.category || '').startsWith('油')) return 12;         // 12g 油 ~ 100kcal
    // 防止熱量爆炸: 單一食材最多貢獻 60% 熱量, 或 400g
    if (food.kcal && food.kcal > 0) {
      return Math.min(400, (totalCalCap * 0.6) / food.kcal);
    }
    return 400;
  }

  // ============================================================
  // 開放模式可被「自動加入」的食材 — heuristic is_common
  // ============================================================
  // 飼料、調味、種子、特定包裝補充品 預設不自動加 (除非使用者選了)
  const AUTO_EXCLUDE_CATEGORIES = new Set(['飼料', '調味']);
  const AUTO_EXCLUDE_NAMES = new Set([]);

  function isAutoCandidate(food) {
    if (AUTO_EXCLUDE_CATEGORIES.has(food.category)) return false;
    if (AUTO_EXCLUDE_NAMES.has(food.name)) return false;
    return true;
  }

  // 把食材歸入一個「自動補上限」分桶
  function foodBucket(food) {
    const c = food.category || '';
    if (c === '肉類' || c === '牛肉' || c === '豬肉' || c === '雞肉' || c === '海鮮') return 'meat';
    if (c === '蔬菜' || c === '蔬菜類' || c === '蔬果' || c === '水果' || c === '水果類') return 'veg';
    if (c === '蛋類') return 'egg';
    if (c === '穀物' || c === '澱粉類' || c === '根莖類') return 'grain';
    if (c.startsWith('補充品') || c.startsWith('油') || c === '種子') return 'supp';
    return 'other';
  }

  // ============================================================
  // 計算某 portions {foodName: grams} 的總營養
  // ============================================================
  function calcTotals(portions, foodMap) {
    const totals = {};
    let totalGrams = 0;
    for (const [name, grams] of Object.entries(portions)) {
      const food = foodMap[name];
      if (!food || !grams || grams <= 0) continue;
      totalGrams += grams;
      for (const k in food) {
        const v = food[k];
        if (typeof v !== 'number' || k === 'row' || k === 'gramsPerUnit') continue;
        totals[k] = (totals[k] || 0) + v * grams;
      }
    }
    totals._totalGrams = totalGrams;
    return totals;
  }

  // ============================================================
  // 計算每個營養素的「每日最低需求」(per DER)
  // ============================================================
  function buildTargets(standards, der) {
    const targets = {};   // key → dailyMin
    const recs = {};      // key → dailyRec
    const maxes = {};     // key → dailyMax
    for (const std of standards.nutrients) {
      if (std.is_taurine) continue;       // 牛磺酸用體重 mg/kg 算 (另處理)
      if (std.key === 'cl_g' || std.key === 'vitk_mg') continue;
      const aafcoMin = std.aafco_min_per_1000kcal;
      const nrcRec = std.nrc_per_1000kcal;
      const minPer1000 = (aafcoMin != null && aafcoMin > 0) ? aafcoMin
        : (nrcRec != null && nrcRec > 0 ? nrcRec : null);
      if (minPer1000 != null) targets[std.key] = minPer1000 * der / 1000;
      if (nrcRec != null) recs[std.key] = nrcRec * der / 1000;
      if (std.aafco_max_per_1000kcal != null) maxes[std.key] = std.aafco_max_per_1000kcal * der / 1000;
    }
    return { targets, recs, maxes };
  }

  function getProvided(totals, key) {
    if (key === 'met_cys_g') return (totals.met_g || 0) + (totals.cys_g || 0);
    if (key === 'phe_tyr_g') return (totals.phe_g || 0) + (totals.tyr_g || 0);
    if (key === 'epa_dha') return totals.omega3_g || 0;
    return totals[key] || 0;
  }

  function getFoodNutrient(food, key) {
    if (key === 'met_cys_g') return (food.met_g || 0) + (food.cys_g || 0);
    if (key === 'phe_tyr_g') return (food.phe_g || 0) + (food.tyr_g || 0);
    if (key === 'epa_dha') return food.omega3_g || 0;
    return food[key] || 0;
  }

  function computeDeficits(totals, targets) {
    const deficits = {};
    for (const [k, target] of Object.entries(targets)) {
      const got = getProvided(totals, k);
      const def = target - got;
      if (def > 0) deficits[k] = { deficit: def, target };
    }
    return deficits;
  }

  // ============================================================
  // Variant 加權 (給 protein source 一點隨機/偏好讓變體不同)
  // ============================================================
  function pickProteinBias(variantIdx, lockedNames) {
    // variantIdx 0: 無偏好
    // variantIdx 1: 偏好 牛/豬
    // variantIdx 2: 偏好 雞/海鮮
    if (variantIdx === 0) return null;
    if (variantIdx === 1) return new Set(['牛肉', '豬肉']);
    if (variantIdx === 2) return new Set(['雞肉', '海鮮']);
    return null;
  }

  // ============================================================
  // 主演算法
  // ============================================================
  function greedyFill(opts) {
    const {
      foods, foodMap, standards, der, targetKcal, kcalCap,
      lockedPortions, candidatePool, userSelectedSet,
      maxAuto, proteinBias, weight
    } = opts;

    const portions = { ...lockedPortions };
    const autoAdded = new Set();
    const { targets, maxes } = buildTargets(standards, der);

    // 牛磺酸 (依體重)
    const taurineMinDaily = 8.7 * weight / 1000;  // g / day (≈100mg/11.5kg)
    targets.taurine_g = taurineMinDaily;

    let iters = 0;
    const MAX_ITERS = 600;

    while (iters++ < MAX_ITERS) {
      const totals = calcTotals(portions, foodMap);

      // 熱量到上限 → 停
      if ((totals.kcal || 0) >= kcalCap) break;

      const deficits = computeDeficits(totals, targets);
      if (Object.keys(deficits).length === 0) break;

      // 找出最佳食材 + step
      let bestFood = null;
      let bestScore = 0;
      let bestStep = 0;

      for (const food of candidatePool) {
        // open-mode 自動補上限檢查
        if (!userSelectedSet.has(food.name)) {
          if (autoAdded.size >= maxAuto && !autoAdded.has(food.name)) continue;
        }

        const step = stepGramsFor(food);
        const cur = portions[food.name] || 0;
        const limit = maxGramsFor(food, kcalCap);
        if (cur + step > limit) continue;

        const kcalAdd = (food.kcal || 0) * step;
        if ((totals.kcal || 0) + kcalAdd > kcalCap) continue;

        // score = 對缺口營養的貢獻 (相對 deficit 比例)
        let score = 0;
        let touchedDeficit = false;
        for (const [k, info] of Object.entries(deficits)) {
          const perG = getFoodNutrient(food, k);
          if (perG <= 0) continue;
          const added = perG * step;
          // ratio: 補多少缺口 (上限 1)
          const ratio = Math.min(added, info.deficit) / info.deficit;
          score += ratio;
          touchedDeficit = true;
        }
        if (!touchedDeficit) continue;

        // 超量 max 懲罰
        for (const [k, mx] of Object.entries(maxes)) {
          const future = getProvided(totals, k) + getFoodNutrient(food, k) * step;
          if (future > mx) {
            score -= 0.5;   // discourage but not forbid (locked food might still need this)
          }
        }

        // 偏好 bonus
        if (proteinBias && proteinBias.has(food.category)) {
          score *= 1.25;
        }

        // 熱量成本懲罰: 高熱量但沒對缺口幫忙的食材 score 不變;
        // 但如果熱量爆掉太快也不好 — 已在 kcalCap 檢查擋了

        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestFood = food;
          bestStep = step;
        }
      }

      if (!bestFood) break;

      portions[bestFood.name] = (portions[bestFood.name] || 0) + bestStep;
      if (!userSelectedSet.has(bestFood.name)) {
        autoAdded.add(bestFood.name);
      }
    }

    return { portions, autoAdded };
  }

  // ============================================================
  // 達標分析 (簡化版 — 跟 app.js calcAchievement 結構對齊)
  // ============================================================
  function calcAchievement(totals, standards, weight, der) {
    const results = [];

    results.push({
      key: 'kcal', name: '熱量', unit: 'kcal',
      provided: totals.kcal || 0,
      dailyMin: der, dailyMax: der * 1.1,
      pct: der > 0 ? (totals.kcal || 0) / der : null,
      status: null
    });

    for (const std of standards.nutrients) {
      let provided = totals[std.key];
      if (std.key === 'met_cys_g') provided = (totals.met_g || 0) + (totals.cys_g || 0);
      else if (std.key === 'phe_tyr_g') provided = (totals.phe_g || 0) + (totals.tyr_g || 0);
      else if (std.key === 'epa_dha') provided = totals.omega3_g || 0;
      else if (std.key === 'cl_g' || std.key === 'vitk_mg') continue;
      if (provided == null) provided = 0;

      if (std.is_taurine) {
        const taurineMg = (provided || 0) * 1000;
        const cardiacMin = (std.cardiac_min_per_kg || 50) * weight;
        const cardiacMax = (std.cardiac_max_per_kg || 100) * weight;
        let status;
        const perKg = weight > 0 ? taurineMg / weight : 0;
        if (perKg < 8.7) status = 'warn';
        else if (perKg < 50) status = 'warn';
        else if (perKg <= 100) status = 'ok';
        else if (perKg <= 200) status = 'ok';
        else status = 'warn';
        results.push({
          key: std.key, name: std.name, unit: 'mg',
          provided: taurineMg,
          dailyMin: cardiacMin, dailyMax: cardiacMax,
          pct: cardiacMin > 0 ? taurineMg / cardiacMin : null,
          status, is_taurine: true
        });
        continue;
      }

      const aafcoMin = std.aafco_min_per_1000kcal;
      const nrcRec = std.nrc_per_1000kcal;
      const minPer1000 = (aafcoMin != null && aafcoMin > 0) ? aafcoMin
        : (nrcRec != null && nrcRec > 0 ? nrcRec : null);
      const dailyMin = minPer1000 != null ? minPer1000 * der / 1000 : null;
      const dailyMax = std.aafco_max_per_1000kcal != null
        ? std.aafco_max_per_1000kcal * der / 1000 : null;

      const pct = dailyMin && dailyMin > 0 ? provided / dailyMin : null;
      results.push({
        key: std.key, name: std.name, unit: std.unit,
        provided, dailyMin, dailyMax, pct, status: null
      });
    }

    for (const r of results) {
      if (r.pct == null) r.status = 'ref';
      else if (r.dailyMax && r.provided > r.dailyMax) r.status = 'bad';
      else if (r.pct < 0.8) r.status = 'warn';
      else r.status = 'ok';
    }
    return results;
  }

  // ============================================================
  // Entry point
  // ============================================================
  function generate(opts) {
    const {
      foods, standards, weight, activity, targetKcal,
      selections, mode, maxAuto, maxAutoByCat, numVariants
    } = opts;

    if (!selections || selections.length === 0) {
      return { error: '請至少勾選 1 樣食材' };
    }

    const foodMap = {};
    for (const f of foods) foodMap[f.name] = f;

    const der = targetKcal != null && targetKcal > 0
      ? targetKcal
      : 70 * Math.pow(weight, 0.75) * activity;
    const kcalCap = der * 1.05;

    // 初始 locked portions
    const lockedPortions = {};
    const userSelectedSet = new Set();
    const lockedHardSet = new Set();    // 完全鎖定 (不能調)
    const minLockSet = new Set();        // 至少這個量
    const maxLockMap = {};               // 最多這個量 → maxGrams

    for (const sel of selections) {
      const food = foodMap[sel.foodName];
      if (!food) continue;
      userSelectedSet.add(food.name);
      const g = (sel.grams != null && isFinite(sel.grams)) ? sel.grams : null;
      if (sel.mode === 'lock') {
        if (g == null || g <= 0) {
          // 鎖定但沒填克數 → 視為自由
          lockedPortions[food.name] = 0;
        } else {
          lockedPortions[food.name] = g;
          lockedHardSet.add(food.name);
        }
      } else if (sel.mode === 'min') {
        lockedPortions[food.name] = g != null && g > 0 ? g : 0;
        if (g != null && g > 0) minLockSet.add(food.name);
      } else if (sel.mode === 'max') {
        lockedPortions[food.name] = 0;
        if (g != null && g > 0) maxLockMap[food.name] = g;
      } else {
        lockedPortions[food.name] = 0;
      }
    }

    // 候選池
    let candidatePool;
    if (mode === 'closed') {
      // 限制模式: 只用使用者勾選的, 且排除 hard-lock
      candidatePool = selections
        .map(s => foodMap[s.foodName])
        .filter(f => f && !lockedHardSet.has(f.name));
    } else {
      // 開放模式: 使用者勾選的 + 開放 is_common 候選
      const set = new Set();
      for (const s of selections) {
        const f = foodMap[s.foodName];
        if (f && !lockedHardSet.has(f.name)) set.add(f);
      }
      for (const f of foods) {
        if (set.has(f)) continue;
        if (lockedHardSet.has(f.name)) continue;
        if (isAutoCandidate(f)) set.add(f);
      }
      candidatePool = Array.from(set);
    }

    // 包裝 maxLock 進 maxGramsFor (用 closure 注入)
    const candidatePoolWithLimit = candidatePool.map(f => {
      if (maxLockMap[f.name] != null) {
        // 將 max-lock 套到 maxGramsFor
        return Object.assign(Object.create(Object.getPrototypeOf(f)), f, { _maxLockGrams: maxLockMap[f.name] });
      }
      return f;
    });

    // monkey-patch maxGramsFor to honour _maxLockGrams
    const _origMaxGrams = maxGramsFor;
    function _maxGrams(food, cap) {
      if (food._maxLockGrams != null) return food._maxLockGrams;
      return _origMaxGrams(food, cap);
    }

    // 為避免改動 greedyFill 內部, 把 maxGramsFor 的呼叫透過 stepGramsFor / maxGramsFor 已 hard-coded;
    // 使用 inline 重新實作: 我們改成 pass-in maxGetter
    const variants = [];
    const N = Math.max(1, Math.min(3, numVariants || 1));
    for (let v = 0; v < N; v++) {
      const proteinBias = pickProteinBias(v, lockedHardSet);
      const result = greedyFillCore({
        foodMap,
        standards,
        der,
        kcalCap,
        lockedPortions: { ...lockedPortions },
        candidatePool: candidatePoolWithLimit,
        userSelectedSet,
        maxAuto: mode === 'closed' ? 0 : maxAuto,
        maxAutoByCat: mode === 'closed' ? null : maxAutoByCat,  // open 模式才用
        proteinBias,
        weight,
        maxGramsGetter: _maxGrams
      });

      const totals = calcTotals(result.portions, foodMap);
      const ach = calcAchievement(totals, standards, weight, der);
      const unmet = ach.filter(a => a.pct != null && a.pct < 0.8 && a.key !== 'kcal' && !a.is_taurine);
      const overTopMax = ach.filter(a => a.status === 'bad');

      // 排序 foods 顯示順序: 使用者勾選的依原始順序 → 自動補充 → 0 grams 不顯示
      const userOrder = selections.map(s => s.foodName);
      const allNames = Object.keys(result.portions).filter(n => result.portions[n] > 0);
      const userInResult = userOrder.filter(n => allNames.includes(n));
      const autoInResult = allNames.filter(n => !userSelectedSet.has(n));
      const orderedNames = [...userInResult, ...autoInResult];

      const foodsOut = orderedNames.map(name => {
        const food = foodMap[name];
        const grams = result.portions[name];
        const portion = grams / (food.gramsPerUnit || 1);
        let source = 'user';
        if (lockedHardSet.has(name)) source = 'locked';
        else if (!userSelectedSet.has(name)) source = 'auto';
        return { food, grams, portion, source };
      });

      variants.push({
        label: ['推薦配方', '偏紅肉版', '偏雞海鮮版'][v] || `配方 ${v + 1}`,
        foods: foodsOut,
        totals,
        achievement: ach,
        kcal: totals.kcal || 0,
        unmet,
        overMax: overTopMax,
        autoAdded: Array.from(result.autoAdded)
      });
    }

    return { variants, der, kcalCap };
  }

  // 與 greedyFill 相同, 但接受 maxGramsGetter
  function greedyFillCore(opts) {
    const {
      foodMap, standards, der, kcalCap,
      lockedPortions, candidatePool, userSelectedSet,
      maxAuto, maxAutoByCat, proteinBias, weight, maxGramsGetter
    } = opts;

    const portions = { ...lockedPortions };
    const autoAdded = new Set();
    const autoAddedByCat = { meat: 0, veg: 0, egg: 0, grain: 0, supp: 0, other: 0 };
    const useByCatCap = !!maxAutoByCat;
    const { targets, maxes } = buildTargets(standards, der);

    targets.taurine_g = 8.7 * weight / 1000;
    // 把熱量也當成「缺口」 — 至少達到 95% DER, 才會收斂
    targets.kcal = der * 0.95;

    let iters = 0;
    const MAX_ITERS = 800;

    while (iters++ < MAX_ITERS) {
      const totals = calcTotals(portions, foodMap);
      if ((totals.kcal || 0) >= kcalCap) break;

      const deficits = computeDeficits(totals, targets);
      if (Object.keys(deficits).length === 0) break;

      let bestFood = null;
      let bestScore = 0;
      let bestStep = 0;

      for (const food of candidatePool) {
        if (!userSelectedSet.has(food.name)) {
          // 自動補上限檢查 (per-category 或 global)
          if (useByCatCap) {
            const bucket = foodBucket(food);
            const cap = maxAutoByCat[bucket] != null ? maxAutoByCat[bucket] : 0;
            if (cap <= 0) continue;
            if (autoAddedByCat[bucket] >= cap && !autoAdded.has(food.name)) continue;
          } else {
            if (maxAuto <= 0) continue;
            if (autoAdded.size >= maxAuto && !autoAdded.has(food.name)) continue;
          }
        }

        const step = stepGramsFor(food);
        const cur = portions[food.name] || 0;
        const limit = maxGramsGetter(food, kcalCap);
        if (cur + step > limit) continue;

        const kcalAdd = (food.kcal || 0) * step;
        if ((totals.kcal || 0) + kcalAdd > kcalCap) continue;

        let score = 0;
        let touchedDeficit = false;
        for (const [k, info] of Object.entries(deficits)) {
          const perG = getFoodNutrient(food, k);
          if (perG <= 0) continue;
          const added = perG * step;
          const ratio = Math.min(added, info.deficit) / info.deficit;
          // 熱量缺口給予較小權重 (避免高熱量食材壟斷)
          score += k === 'kcal' ? ratio * 0.6 : ratio;
          touchedDeficit = true;
        }
        if (!touchedDeficit) continue;

        // 超 max 懲罰: 只有當「這個食材 actually 增加了超量部分」才扣分
        let maxPenalty = 0;
        for (const [k, mx] of Object.entries(maxes)) {
          const cur = getProvided(totals, k);
          const adds = getFoodNutrient(food, k) * step;
          if (adds <= 0) continue;                        // 不增 → 不罰
          const future = cur + adds;
          if (future <= mx) continue;                     // 沒超 → 不罰
          const beyondMax = Math.min(adds, future - mx); // 這次增量裡超過 max 的部分
          const overshoot = beyondMax / mx;
          maxPenalty += Math.min(0.8, overshoot * 1.0);
        }
        score -= maxPenalty;

        if (proteinBias && proteinBias.has(food.category)) score *= 1.25;

        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestFood = food;
          bestStep = step;
        }
      }

      if (!bestFood) break;
      portions[bestFood.name] = (portions[bestFood.name] || 0) + bestStep;
      if (!userSelectedSet.has(bestFood.name)) {
        if (!autoAdded.has(bestFood.name)) {
          // 第一次加這個食材 → 增加對應分桶計數
          const bucket = foodBucket(bestFood);
          autoAddedByCat[bucket] = (autoAddedByCat[bucket] || 0) + 1;
        }
        autoAdded.add(bestFood.name);
      }
    }

    return { portions, autoAdded, autoAddedByCat };
  }

  // ============================================================
  // Export
  // ============================================================
  window.RecipeGenerator = {
    generate,
    calcTotals,
    calcAchievement
  };

})();

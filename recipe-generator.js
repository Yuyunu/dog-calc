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
    if (c === '蔬菜' || c === '蔬菜類' || c === '蔬果') return 'veg';
    if (c === '水果' || c === '水果類') return 'fruit';
    if (c === '蛋類') return 'egg';
    if (c === '穀物' || c === '澱粉類' || c === '根莖類') return 'grain';
    if (c.startsWith('油')) return 'oil';
    if (c.startsWith('補充品') || c === '種子') return 'supp';
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

  // 檢查加入這個食材一個 step 後, 比例 (numKey/denKey) 會不會超過 maxRatio
  // 若會超過 AND 比目前更糟, 回傳 true (應該跳過)
  function wouldExceedRatio(food, step, totals, numKey, denKey, maxRatio) {
    const numCur = getProvided(totals, numKey);
    const denCur = getProvided(totals, denKey);
    const numAdd = getFoodNutrient(food, numKey) * step;
    const denAdd = getFoodNutrient(food, denKey) * step;
    const numFuture = numCur + numAdd;
    const denFuture = denCur + denAdd;
    // 沒有分母 → 無法判斷比例, 允許 (greedy 會逐步補)
    if (denFuture <= 0) return false;
    const ratioFuture = numFuture / denFuture;
    if (ratioFuture <= maxRatio) return false;
    // 比例會超過 max — 但若這次添加是「拉低比例」則允許 (例如目前 ratio=3, 加 P 後 ratio=2.5)
    const ratioCur = denCur > 0 ? numCur / denCur : Infinity;
    if (ratioFuture < ratioCur) return false;
    return true;
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
      if (r.is_taurine) continue;     // 牛磺酸 status 已在上方依 mg/kg 規則設定, 不要覆蓋
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
      selections, exclusions, mode, maxAuto, maxAutoByCat, minAutoByCat, numVariants
    } = opts;
    const excludedSet = new Set(exclusions || []);

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
        .filter(f => f && !lockedHardSet.has(f.name) && !excludedSet.has(f.name));
    } else {
      // 開放模式: 使用者勾選的 + 開放 is_common 候選
      const set = new Set();
      for (const s of selections) {
        const f = foodMap[s.foodName];
        if (f && !lockedHardSet.has(f.name) && !excludedSet.has(f.name)) set.add(f);
      }
      for (const f of foods) {
        if (set.has(f)) continue;
        if (lockedHardSet.has(f.name)) continue;
        if (excludedSet.has(f.name)) continue;     // 排除食材永不入候選
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

    // 追蹤跨變體的「自動補食材使用次數」, 後續變體偏向選未用過的 (只算 auto, 不算 user 勾選)
    const autoFoodUsage = {};

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
        maxAutoByCat: mode === 'closed' ? null : maxAutoByCat,
        minAutoByCat: mode === 'closed' ? null : minAutoByCat,
        proteinBias,
        weight,
        maxGramsGetter: _maxGrams,
        autoFoodUsage           // 跨變體變化壓力
      });

      // 把這變體用到的「自動補」食材累計到 usage map (給後續變體挑不一樣的)
      for (const name of result.autoAdded) {
        autoFoodUsage[name] = (autoFoodUsage[name] || 0) + 1;
      }

      const totals = calcTotals(result.portions, foodMap);
      const ach = calcAchievement(totals, standards, weight, der);
      // 任何 < 100% 都算 unmet (不是只 < 80%, 因為使用者要求嚴格)
      const unmet = ach.filter(a => a.pct != null && a.pct < 1.0 && a.key !== 'kcal' && !a.is_taurine);
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
      maxAuto, maxAutoByCat, minAutoByCat, proteinBias, weight, maxGramsGetter,
      autoFoodUsage
    } = opts;

    const portions = { ...lockedPortions };
    const autoAdded = new Set();
    const autoAddedByCat = { meat: 0, veg: 0, fruit: 0, egg: 0, grain: 0, oil: 0, supp: 0, other: 0 };
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

        // 超 max 硬限制: 任何營養素超過 AAFCO max 直接 SKIP
        let wouldExceedMax = false;
        for (const [k, mx] of Object.entries(maxes)) {
          const adds = getFoodNutrient(food, k) * step;
          if (adds <= 0) continue;
          const future = getProvided(totals, k) + adds;
          if (future > mx) { wouldExceedMax = true; break; }
        }
        if (wouldExceedMax) continue;
        // 鈣磷比硬限制: 不能讓 Ca/P > 2.0 (除非加這個食材會降低比例)
        if (!wouldExceedRatio(food, step, totals, 'ca_mg', 'p_mg', 2.0)) {
          // 通過
        } else {
          continue;
        }

        if (proteinBias && proteinBias.has(food.category)) score *= 1.25;

        // 接近 max 的營養素 → 加它的食材 score 衰減 (避免單一食材吃光某營養 budget)
        // 例如 Cu 已 80% max, 高 Cu 食材 score × 0.6, 90% max → × 0.3, 95% → × 0.15
        for (const [k, mx] of Object.entries(maxes)) {
          const adds = getFoodNutrient(food, k) * step;
          if (adds <= 0) continue;
          const futureRatio = (getProvided(totals, k) + adds) / mx;
          if (futureRatio > 0.7) {
            score *= Math.max(0.15, 1 - (futureRatio - 0.7) * 2.5);
          }
        }

        // 跨變體變化壓力: 之前變體用過的自動補食材, 在此變體 score ×0.6, 用過 2 次 ×0.42
        // (只對「自動補」食材生效, 使用者勾選的不打折)
        if (autoFoodUsage && !userSelectedSet.has(food.name)) {
          const usedCount = autoFoodUsage[food.name] || 0;
          if (usedCount > 0) score *= Math.pow(0.65, usedCount);
        }

        // 「最少」分桶 bonus — 若該類仍未滿 minAutoByCat → 給大量 score 偏好
        if (minAutoByCat && !userSelectedSet.has(food.name)) {
          const bucket = foodBucket(food);
          const min = minAutoByCat[bucket] || 0;
          if (min > 0 && (autoAddedByCat[bucket] || 0) < min) {
            // 強烈傾向選這類 (即使對缺口幫助不大也要選)
            score = Math.max(score, 0.01) * 3 + 1.0;
          }
        }

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
          const bucket = foodBucket(bestFood);
          autoAddedByCat[bucket] = (autoAddedByCat[bucket] || 0) + 1;
        }
        autoAdded.add(bestFood.name);
      }
    }

    // === 缺口最終補強 post-pass ===
    // greedy 可能因為 protein bias / variety 壓力而停, 但仍有 nutrient 不到 100% min
    // 這個 pass 純粹看 deficit, 忽略 bias / variety 壓力, 嘗試補足
    // 仍尊重: max nutrient cap, Ca:P, 各類分桶上限, kcal cap
    {
      let safety = 200;
      while (safety-- > 0) {
        const t = calcTotals(portions, foodMap);
        if ((t.kcal || 0) >= kcalCap) break;
        const def = computeDeficits(t, targets);
        if (Object.keys(def).length === 0) break;

        let pick = null;
        let bestS = 0;
        let bestStep = 0;
        for (const food of candidatePool) {
          if (!userSelectedSet.has(food.name)) {
            // 自動補食材仍受分桶上限
            if (useByCatCap) {
              const bucket = foodBucket(food);
              const cap = maxAutoByCat[bucket] != null ? maxAutoByCat[bucket] : 0;
              if (cap <= 0) continue;
              if ((autoAddedByCat[bucket] || 0) >= cap && !autoAdded.has(food.name)) continue;
            } else if (maxAuto > 0) {
              if (autoAdded.size >= maxAuto && !autoAdded.has(food.name)) continue;
            } else {
              continue;
            }
          }
          const step = stepGramsFor(food);
          const cur = portions[food.name] || 0;
          const limit = maxGramsGetter(food, kcalCap);
          if (cur + step > limit) continue;
          const kcalAdd = (food.kcal || 0) * step;
          if ((t.kcal || 0) + kcalAdd > kcalCap) continue;
          // max 不超
          let blocked = false;
          for (const [k, mx] of Object.entries(maxes)) {
            const adds = getFoodNutrient(food, k) * step;
            if (adds > 0 && getProvided(t, k) + adds > mx) { blocked = true; break; }
          }
          if (blocked) continue;
          // Ca:P 不超
          if (wouldExceedRatio(food, step, t, 'ca_mg', 'p_mg', 2.0)) continue;
          // Score: 對剩餘 deficit 的覆蓋率 (純缺口導向, 不算 bias / variety)
          let s = 0;
          for (const [k, info] of Object.entries(def)) {
            const perG = getFoodNutrient(food, k);
            if (perG <= 0) continue;
            const added = perG * step;
            s += Math.min(added, info.deficit) / info.deficit;
          }
          if (s > bestS) { bestS = s; pick = food; bestStep = step; }
        }
        if (!pick || bestS === 0) break;
        portions[pick.name] = (portions[pick.name] || 0) + bestStep;
        if (!userSelectedSet.has(pick.name)) {
          if (!autoAdded.has(pick.name)) {
            const bucket = foodBucket(pick);
            autoAddedByCat[bucket] = (autoAddedByCat[bucket] || 0) + 1;
          }
          autoAdded.add(pick.name);
        }
      }
    }

    // === 強制納入使用者勾選的食材 (post-pass) ===
    // 任何被勾選但 greedy 沒給份量的食材, 至少加 1 step (前提是不超 max + Ca:P 不超)
    const USER_FORCE_TOLERANCE = 1.00;     // 0% 容忍 (使用者要求嚴格)
    for (const food of candidatePool) {
      if (!userSelectedSet.has(food.name)) continue;
      if ((portions[food.name] || 0) > 0) continue;
      const step = stepGramsFor(food);
      const limit = maxGramsGetter(food, kcalCap);
      if (step > limit) continue;
      const totals = calcTotals(portions, foodMap);
      const kcalAdd = (food.kcal || 0) * step;
      if ((totals.kcal || 0) + kcalAdd > kcalCap * 1.10) continue;
      // 不能讓 force-add 推某營養超 max
      let exceeds = false;
      for (const [k, mx] of Object.entries(maxes)) {
        const adds = getFoodNutrient(food, k) * step;
        if (adds <= 0) continue;
        if (getProvided(totals, k) + adds > mx * USER_FORCE_TOLERANCE) { exceeds = true; break; }
      }
      if (exceeds) continue;
      // Ca:P 比也不能超
      if (wouldExceedRatio(food, step, totals, 'ca_mg', 'p_mg', 2.0)) continue;
      portions[food.name] = step;
    }

    // === 強制最少 post-pass ===
    // 若 greedy 結束某類仍未達 minAutoByCat, 強制找該類食材 force-add 5g
    if (minAutoByCat) {
      let safety = 30;
      while (safety-- > 0) {
        let underBucket = null;
        for (const [bk, mn] of Object.entries(minAutoByCat)) {
          if (mn > 0 && (autoAddedByCat[bk] || 0) < mn) { underBucket = bk; break; }
        }
        if (!underBucket) break;
        // 找這類最便宜 / kcal 最低的可加候選 (還沒被加)
        const totals = calcTotals(portions, foodMap);
        let pick = null;
        let bestKcal = Infinity;
        for (const f of candidatePool) {
          if (userSelectedSet.has(f.name)) continue;
          if (autoAdded.has(f.name)) continue;
          if (foodBucket(f) !== underBucket) continue;
          const step = stepGramsFor(f);
          const kcalAdd = (f.kcal || 0) * step;
          if ((totals.kcal || 0) + kcalAdd > kcalCap) continue;
          // 不能讓 force-add 推某營養超 max
          let exceeds = false;
          for (const [k, mx] of Object.entries(maxes)) {
            const adds = getFoodNutrient(f, k) * step;
            if (adds <= 0) continue;
            if (getProvided(totals, k) + adds > mx) { exceeds = true; break; }
          }
          if (exceeds) continue;
          // Ca:P 比也不能超
          if (wouldExceedRatio(f, step, totals, 'ca_mg', 'p_mg', 2.0)) continue;
          if (kcalAdd < bestKcal) { bestKcal = kcalAdd; pick = f; }
        }
        if (!pick) break;
        const step = stepGramsFor(pick);
        portions[pick.name] = (portions[pick.name] || 0) + step;
        autoAdded.add(pick.name);
        autoAddedByCat[underBucket] = (autoAddedByCat[underBucket] || 0) + 1;
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

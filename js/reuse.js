const STRONG_SLOTS = new Set(['top', 'pant']);

const SLOT_DEFS = [
  { key: 'topId', slot: 'top', label: 'top', plural: 'tops', single: true },
  { key: 'pantId', slot: 'pant', label: 'pant', plural: 'pants', single: true },
  { key: 'shoesId', slot: 'shoes', label: 'shoes', plural: 'shoes', single: true },
  { key: 'accessoryIds', slot: 'accessory', label: 'accessory', plural: 'accessories' },
  { key: 'otherIds', slot: 'other', label: 'other item', plural: 'other items' }
];

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const value of list || []) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function dedupeIds(ids) {
  return unique(ids);
}

export function mergeOutfitIds(existingIds, incomingIds, { mode = 'add' } = {}) {
  const incoming = dedupeIds(incomingIds);
  if (mode === 'replace') return incoming;
  return dedupeIds([...(existingIds || []), ...incoming]);
}

export function nextCopyName(baseName, existingNames = []) {
  const base = (baseName || 'Untitled outfit').trim() || 'Untitled outfit';
  const names = new Set((existingNames || []).map(name => String(name || '').trim()).filter(Boolean));
  const first = `${base} copy`;
  if (!names.has(first)) return first;
  let n = 2;
  while (names.has(`${base} copy ${n}`)) n++;
  return `${base} copy ${n}`;
}

export function outfitItemEntries(outfit) {
  if (!outfit) return [];
  const entries = [];
  for (const def of SLOT_DEFS) {
    const ids = def.single
      ? (outfit[def.key] ? [outfit[def.key]] : [])
      : (Array.isArray(outfit[def.key]) ? outfit[def.key] : []);
    ids.forEach((itemId, index) => {
      if (!itemId) return;
      entries.push({
        itemId,
        slot: def.slot,
        label: def.label,
        plural: def.plural,
        severity: STRONG_SLOTS.has(def.slot) ? 'strong' : 'soft',
        index
      });
    });
  }
  return entries;
}

function normalizePlans(planByDate) {
  if (!planByDate) return [];
  if (planByDate instanceof Map) return [...planByDate.entries()];
  if (Array.isArray(planByDate)) return planByDate.map(plan => [plan.date, plan]);
  return Object.entries(planByDate);
}

function getOutfit(outfitsById, id) {
  if (!id || !outfitsById) return null;
  if (outfitsById instanceof Map) return outfitsById.get(id);
  return outfitsById[id] || null;
}

function getItem(itemsById, id) {
  if (!id || !itemsById) return null;
  if (itemsById instanceof Map) return itemsById.get(id);
  return itemsById[id] || null;
}

export function formatDateShort(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
  return `${month} ${dt.getUTCDate()}`;
}

function dateList(dates) {
  const sorted = unique(dates).sort();
  const shown = sorted.slice(0, 2).map(formatDateShort);
  const extra = sorted.length - shown.length;
  return shown.join(' and ') + (extra > 0 ? ` +${extra} more` : '');
}

function nameList(names, limit = 2) {
  const values = unique(names).filter(Boolean);
  const shown = values.slice(0, limit);
  const extra = values.length - shown.length;
  const base = joinWords(shown);
  return base + (extra > 0 ? ` +${extra} more` : '');
}

function joinWords(words) {
  const values = unique(words);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function matchGroups(matches) {
  const groups = new Map();
  for (const match of matches || []) {
    if (!match?.date || !match.itemId) continue;
    const key = `${match.slot}|${match.itemId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        itemId: match.itemId,
        itemName: match.itemName,
        slot: match.slot,
        label: match.label,
        plural: match.plural,
        dates: [],
        outfitNames: []
      });
    }
    const group = groups.get(key);
    group.dates.push(match.date);
    group.outfitNames.push(match.outfitName);
  }
  return [...groups.values()].map(group => ({
    ...group,
    dates: unique(group.dates).sort(),
    outfitNames: unique(group.outfitNames)
  }));
}

function groupSubject(group) {
  return group.itemName
    ? `${group.itemName} (${group.label})`
    : capitalize(group.label);
}

function sameDateSet(groups) {
  if (!groups.length) return false;
  const first = groups[0].dates.join('|');
  return groups.every(group => group.dates.join('|') === first);
}

function preciseMatchText(matches, { includeOutfits = false, limit = 2 } = {}) {
  const groups = matchGroups(matches);
  if (!groups.length) return '';
  if (!includeOutfits && sameDateSet(groups)) {
    return `${joinWords(groups.map(groupSubject))} repeat on ${dateList(groups[0].dates)}`;
  }
  const shown = groups.slice(0, limit).map(group => {
    const outfitText = includeOutfits && group.outfitNames.length
      ? ` in ${nameList(group.outfitNames)}`
      : '';
    return `${groupSubject(group)} repeats on ${dateList(group.dates)}${outfitText}`;
  });
  const extra = groups.length - shown.length;
  return shown.join('; ') + (extra > 0 ? `; +${extra} more` : '');
}

export function buildOutfitReuseSummary({ outfit, date, planByDate, outfitsById, itemsById } = {}) {
  const candidateEntries = outfitItemEntries(outfit);
  if (!outfit) {
    return {
      hasReuse: false,
      level: 'none',
      matches: [],
      strongMatches: [],
      softMatches: [],
      reusedDates: [],
      exactOutfitDates: []
    };
  }

  const entriesByItem = new Map();
  candidateEntries.forEach(entry => {
    if (!entriesByItem.has(entry.itemId)) entriesByItem.set(entry.itemId, []);
    entriesByItem.get(entry.itemId).push(entry);
  });

  const matches = [];
  const exactOutfitDates = [];
  const seenMatches = new Set();

  for (const [planDate, plan] of normalizePlans(planByDate)) {
    if (!planDate || planDate === date || !plan) continue;
    const outfitIds = Array.isArray(plan.outfitIds)
      ? plan.outfitIds
      : (plan.outfitId ? [plan.outfitId] : []);
    if (outfit.id && outfitIds.includes(outfit.id)) exactOutfitDates.push(planDate);

    for (const plannedOutfitId of outfitIds) {
      const plannedOutfit = getOutfit(outfitsById, plannedOutfitId);
      if (!plannedOutfit) continue;
      for (const plannedEntry of outfitItemEntries(plannedOutfit)) {
        const candidateMatches = entriesByItem.get(plannedEntry.itemId);
        if (!candidateMatches) continue;
        for (const candidateEntry of candidateMatches) {
          if (plannedEntry.slot !== candidateEntry.slot) continue;
          const key = `${planDate}|${plannedOutfitId}|${plannedEntry.itemId}|${candidateEntry.slot}`;
          if (seenMatches.has(key)) continue;
          seenMatches.add(key);
          const item = getItem(itemsById, plannedEntry.itemId);
          matches.push({
            itemId: plannedEntry.itemId,
            itemName: item ? (item.name || '(unnamed)') : '',
            slot: candidateEntry.slot,
            plannedSlot: plannedEntry.slot,
            label: candidateEntry.label,
            plural: candidateEntry.plural,
            severity: candidateEntry.severity,
            date: planDate,
            outfitId: plannedOutfitId,
            outfitName: plannedOutfit.name || 'Untitled'
          });
        }
      }
    }
  }

  const strongMatches = matches.filter(m => m.severity === 'strong');
  const softMatches = matches.filter(m => m.severity !== 'strong');
  const reusedDates = unique(matches.map(m => m.date));
  const level = strongMatches.length ? 'strong' : (softMatches.length || exactOutfitDates.length ? 'soft' : 'none');

  return {
    hasReuse: level !== 'none',
    level,
    matches,
    strongMatches,
    softMatches,
    reusedDates,
    exactOutfitDates: unique(exactOutfitDates)
  };
}

export function reuseSummaryCopy(summary) {
  if (!summary || !summary.hasReuse) return null;
  const dates = dateList(summary.reusedDates.length ? summary.reusedDates : summary.exactOutfitDates);
  if (summary.level === 'strong') {
    const details = preciseMatchText(summary.strongMatches, { includeOutfits: true, limit: 3 });
    return {
      title: 'Main pieces repeat',
      detail: `${capitalize(details)}. You can still use this outfit.`
    };
  }
  if (summary.softMatches.length) {
    const details = preciseMatchText(summary.softMatches, { includeOutfits: true, limit: 3 });
    const softSlots = unique(summary.softMatches.map(m => m.slot));
    const usualCopy = softSlots.every(slot => slot === 'shoes' || slot === 'accessory')
      ? 'Usually fine for shoes and accessories.'
      : 'Less critical than repeating tops or pants.';
    return {
      title: 'Easy repeat',
      detail: `${capitalize(details)}. ${usualCopy}`
    };
  }
  return {
    title: 'Outfit already planned',
    detail: `This outfit is already planned on ${dates}. You can reuse it or duplicate it to edit.`
  };
}

export function reuseSummaryShortText(summary) {
  if (!summary || !summary.hasReuse) return '';
  const dates = dateList(summary.reusedDates.length ? summary.reusedDates : summary.exactOutfitDates);
  if (summary.level === 'strong') {
    return capitalize(preciseMatchText(summary.strongMatches));
  }
  if (summary.softMatches.length) {
    return capitalize(preciseMatchText(summary.softMatches));
  }
  return `Outfit also used on ${dates}`;
}

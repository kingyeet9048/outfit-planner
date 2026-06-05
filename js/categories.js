export const ITEM_CATEGORIES = [
  { value: 'top', label: 'Top', plural: 'Tops', icon: '👕' },
  { value: 'dress', label: 'Dress', plural: 'Dresses', icon: '👗' },
  { value: 'pant', label: 'Pant', plural: 'Pants', icon: '👖' },
  { value: 'skirt', label: 'Skirt', plural: 'Skirts', icon: '👗' },
  { value: 'shoes', label: 'Shoes', plural: 'Shoes', icon: '👟' },
  { value: 'purse', label: 'Purse', plural: 'Purses', icon: '👜' },
  { value: 'accessory', label: 'Accessory', plural: 'Accessories', icon: '✨' },
  { value: 'other', label: 'Other', plural: 'Other', icon: '🎒' }
];

export const ITEM_CATEGORY_FILTERS = [
  { value: 'all', label: 'All' },
  ...ITEM_CATEGORIES.map(category => ({ value: category.value, label: category.plural })),
  { value: 'tobuy', label: 'To buy' }
];

export const ITEM_CATEGORY_VALUES = new Set(ITEM_CATEGORIES.map(category => category.value));
export const ITEM_FILTER_VALUES = new Set(ITEM_CATEGORY_FILTERS.map(category => category.value));

export const CATEGORY_LABELS = Object.fromEntries(ITEM_CATEGORIES.map(category => [category.value, category.label]));
export const CATEGORY_PLURAL_LABELS = Object.fromEntries(ITEM_CATEGORIES.map(category => [category.value, category.plural]));
export const CATEGORY_ICONS = Object.fromEntries(ITEM_CATEGORIES.map(category => [category.value, category.icon]));

export const CATEGORY_ORDER = ['accessory', 'purse', 'dress', 'top', 'pant', 'skirt', 'shoes', 'other'];

const SUBCATEGORY_PLACEHOLDERS = {
  dress: 'e.g., maxi, cocktail, sundress',
  skirt: 'e.g., midi, denim, pleated',
  purse: 'e.g., crossbody, clutch, tote',
  accessory: 'e.g., watch, necklace, ring',
  other: 'e.g., jacket, hat, scarf'
};

const SUBCATEGORY_CATEGORIES = new Set(Object.keys(SUBCATEGORY_PLACEHOLDERS));

export function categoryLabel(category, { plural = false, fallback = '' } = {}) {
  const labels = plural ? CATEGORY_PLURAL_LABELS : CATEGORY_LABELS;
  return labels[category] || fallback || category || 'Item';
}

export function categoryIcon(category, fallback = '👕') {
  return CATEGORY_ICONS[category] || fallback;
}

export function normalizeCategoryList(category) {
  const values = Array.isArray(category) ? category : [category];
  return values.filter(value => ITEM_CATEGORY_VALUES.has(value));
}

export function categoryUsesSubcategory(category) {
  return SUBCATEGORY_CATEGORIES.has(category);
}

export function subcategoryPlaceholder(category) {
  return SUBCATEGORY_PLACEHOLDERS[category] || '';
}

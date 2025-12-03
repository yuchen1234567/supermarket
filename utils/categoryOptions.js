const DEFAULT_CATEGORY_OPTIONS = [
  { value: 'Fruits & Vegetables', label: 'Fruits & Vegetables' },
  { value: 'Meat & Seafood', label: 'Meat & Seafood' },
  { value: 'Dairy & Eggs', label: 'Dairy & Eggs' },
  { value: 'Bakery', label: 'Bakery' },
  { value: 'Beverages', label: 'Beverages' },
  { value: 'Snacks', label: 'Snacks' }
];


function buildCategoryOptions(products = []) {
  const defaultCategoryValues = new Set(DEFAULT_CATEGORY_OPTIONS.map(option => option.value));
  const extraCategoryValues = new Set();

  products.forEach(product => {
    const categoryName = product && product.category && product.category.trim()
      ? product.category.trim()
      : 'General';

    if (!defaultCategoryValues.has(categoryName)) {
      extraCategoryValues.add(categoryName);
    }
  });

  const extraCategories = Array.from(extraCategoryValues)
    .sort((a, b) => a.localeCompare(b))
    .map(value => ({ value, label: value }));

  return [...DEFAULT_CATEGORY_OPTIONS, ...extraCategories];
}

module.exports = {
  DEFAULT_CATEGORY_OPTIONS,
  buildCategoryOptions
};

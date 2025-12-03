// ========================================
// Product Controller
// Handles all product-related business logic
// ========================================
const Product = require('../models/products');
const { buildCategoryOptions, DEFAULT_CATEGORY_OPTIONS } = require('../utils/categoryOptions');

/**
 * List all products
 * Render different views based on user role:
 * - Admin: display inventory management page
 * - Regular user: display shopping page
 */
function listAll(req, res) {
  const user = req.session.user || null;  // Get current logged-in user
  const view = user && user.role === 'admin' ? 'inventory' : 'shopping';  // Select view based on role
  
  // Get all products from database
  Product.getAll((err, results) => {
    if (err) {
      // Handle database error
      return res.status(500).render(view, { 
        products: [], 
        error: 'Database error', 
        user,
        messages: req.flash(),
        categories: DEFAULT_CATEGORY_OPTIONS
      });
    }

    const categories = buildCategoryOptions(results);

    // Successfully retrieved product list, render page
    return res.render(view, { 
      products: results, 
      error: null, 
      user,
      messages: req.flash(),
      categories
    });
  });
}

/**
 * Get product details by ID
 * Display detailed information page for a single product
 */
function getById(req, res) {
  const user = req.session.user || null;
  const id = parseInt(req.params.id, 10);  // Get product ID from URL parameter
  
  // Validate if ID is a valid number
  if (Number.isNaN(id)) {
    return res.status(400).render('product', { product: null, error: 'Invalid product ID', user });
  }
  
  // Query product information from database
  Product.getById(id, (err, product) => {
    if (err)  return res.status(500).render('product', { product: null, error: 'Database error', user });
    if (!product) return res.status(404).render('product', { product: null, error: 'Product not found', user });
    return res.render('product', { product, error: null, user });
  });
}

/**
 * Add new product
 * Handle product addition form submission, including image upload
 * Admin only
 */
function add(req, res) {
  const user = req.session.user || null;
  // Get form data (compatible with different field names)
  const productName = req.body.productName || req.body.name;
  const category = req.body.category || 'General';
  const quantity = parseInt(req.body.quantity, 10);
  const price = parseFloat(req.body.price);
  const image = req.file ? req.file.filename : null;  // Get uploaded image filename

  // Validate required fields
  if (!productName || Number.isNaN(quantity) || Number.isNaN(price)) {
    req.flash('error', 'Missing or invalid fields');
    return res.status(400).render('addProduct', {
      user,
      messages: req.flash(),
      categories: DEFAULT_CATEGORY_OPTIONS
    });
  }

  // Validate if image is uploaded
  if (!image) {
    req.flash('error', 'Product image is required');
    return res.status(400).render('addProduct', {
      user,
      messages: req.flash(),
      categories: DEFAULT_CATEGORY_OPTIONS
    });
  }

  // Call model layer to add product to database
  Product.add({ productName, category, quantity, price, image }, (err) => {
    if (err) {
      console.error('Error adding product:', err);
      req.flash('error', 'Failed to add product');
      return res.status(500).render('addProduct', {
        user,
        messages: req.flash(),
        categories: DEFAULT_CATEGORY_OPTIONS
      });
    }
    req.flash('success', 'Product added successfully');
    return res.redirect('/inventory');  // Addition successful, redirect to inventory page
  });
}

/**
 * Display product update form
 * Get product information and display edit page
 * Admin only
 */
function showUpdateForm(req, res) {
  const user = req.session.user || null;
  const id = parseInt(req.params.id, 10);  // Get product ID from URL
  
  // Validate if ID is valid
  if (Number.isNaN(id)) {
    return res.status(400).render('updateProduct', { product: null, error: 'Invalid product ID', user, categories: DEFAULT_CATEGORY_OPTIONS });
  }
  
  // Query product information
  Product.getById(id, (err, product) => {
    if (err)  return res.status(500).render('updateProduct', { product: null, error: 'Database error', user, categories: DEFAULT_CATEGORY_OPTIONS });
    if (!product) return res.status(404).render('updateProduct', { product: null, error: 'Product not found', user, categories: DEFAULT_CATEGORY_OPTIONS });
    return res.render('updateProduct', { product, error: null, user, categories: DEFAULT_CATEGORY_OPTIONS });
  });
}

/**
 * Update product information
 * Handle product update form submission
 * If no new image is uploaded, keep the existing image
 * Admin only
 */
function update(req, res) {
  const user = req.session.user || null;
  const id = parseInt(req.params.id, 10);  // Get product ID from URL
  
  // Validate if ID is valid
  if (Number.isNaN(id)) {
    req.flash('error', 'Invalid product ID');
    return res.redirect('/inventory');
  }

  // Get form data
  const productName = req.body.productName || req.body.name;
  const category = req.body.category || 'General';
  const quantity = parseInt(req.body.quantity, 10);
  const price = parseFloat(req.body.price);
  // If new image uploaded use new image, otherwise keep existing image
  const image = req.file ? req.file.filename : (req.body.currentImage || null);

  const product = { productName, category, quantity, price, image };

  // Validate required fields
  if (!productName || Number.isNaN(quantity) || Number.isNaN(price)) {
    req.flash('error', 'Missing or invalid fields');
    return res.redirect(`/updateProduct/${id}`);
  }

  // Call model layer to update product information
  Product.update(id, product, (err, result) => {
    if (err) {
      console.error('Error updating product:', err);
      req.flash('error', 'Failed to update product');
      return res.redirect(`/updateProduct/${id}`);
    }
    if (result && result.affectedRows === 0) {
      req.flash('error', 'Product not found');
      return res.redirect('/inventory');
    }
    req.flash('success', 'Product updated successfully');
    return res.redirect(`/product/${id}`);  // Update successful, redirect to product details page
  });
}

/**
 * Delete product
 * Delete specified product from database
 * Admin only
 */
function remove(req, res) {
  const user = req.session.user || null;
  const id = parseInt(req.params.id, 10);  // Get product ID from URL
  
  // Validate if ID is valid
  if (Number.isNaN(id)) {
    req.flash('error', 'Invalid product ID');
    return res.redirect('/inventory');
  }

  // Call model layer to delete product
  Product.delete(id, (err, result) => {
    if (err) {
      console.error('Error deleting product:', err);
      req.flash('error', 'Failed to delete product');
      return res.redirect('/inventory');
    }
    if (result && result.affectedRows === 0) {
      req.flash('error', 'Product not found');
      return res.redirect('/inventory');
    }
    req.flash('success', 'Product deleted successfully');
    return res.redirect('/inventory');  // Deletion successful, return to inventory page
  });
}

// ========================================
// Export all controller functions
// ========================================
module.exports = {
  listAll,           // List all products
  getById,           // Get single product details
  add,               // Add new product
  showUpdateForm,    // Display update form
  update,            // Update product information
  delete: remove     // Delete product (use remove to avoid keyword conflict)
};

// ========================================
// Product Model
// Handles database operations related to product data
// Table fields: id, productName, category, quantity, price, image
// ========================================
const db = require('../db');  // Database connection

/**
 * Get all products
 * @param {Function} callback - Callback function (err, results)
 */
function getAll(callback) {
    const sql = 'SELECT id, productName, category, quantity, price, image FROM products';
    db.query(sql, (err, results) => callback(err, results));
}

/**
 * Get single product by ID
 * @param {Number} id - Product ID
 * @param {Function} callback - Callback function (err, product)
 */
function getById(id, callback) {
    const sql = 'SELECT id, productName, category, quantity, price, image FROM products WHERE id = ? LIMIT 1';
    db.query(sql, [id], (err, results) => callback(err, results && results[0] ? results[0] : null));
}

/**
 * Add new product
 * @param {Object} product - Product object { productName, category, quantity, price, image }
 * @param {Function} callback - Callback function (err, result)
 */
function add(product, callback) {
    const { productName, category, quantity, price, image } = product;
    const sql = 'INSERT INTO products (productName, category, quantity, price, image) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [productName, category || 'General', quantity, price, image], (err, result) => callback(err, result));
}

/**
 * Update product information
 * @param {Number} id - Product ID
 * @param {Object} product - Product object { productName, category, quantity, price, image }
 * @param {Function} callback - Callback function (err, result)
 */
function updateById(id, product, callback) {
    const { productName, category, quantity, price, image } = product;
    const sql = 'UPDATE products SET productName = ?, category = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
    db.query(sql, [productName, category || 'General', quantity, price, image, id], (err, result) => callback(err, result));
}

/**
 * Delete product
 * @param {Number} id - Product ID
 * @param {Function} callback - Callback function (err, result)
 */
function deleteById(id, callback) {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], (err, result) => callback(err, result));
}

// ========================================
// Export model methods
// ========================================
module.exports = {
    getAll,              // Get all products
    getById,             // Get product by ID
    add,                 // Add new product
    update: updateById,  // Update product
    delete: deleteById   // Delete product
};
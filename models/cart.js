// ========================================
// Cart Model
// Handles shopping cart business logic (database-based storage)
// All cart data persists in database for data consistency
// ========================================

const db = require('../db');  // Database connection

const cartModel = {
  /**
   * Get user's shopping cart from database
   * @param {Number} userId - User ID
   * @param {Function} callback - Callback function (err, cartItems)
   */
  getCart(userId, callback) {
    const sql = `
      SELECT 
        c.id as cartId,
        c.products_id as productId,
        c.quantity,
        p.productName,
        p.price,
        p.image,
        p.quantity as stock
      FROM cart c
      JOIN products p ON c.products_id = p.id
      WHERE c.users_id = ?
      ORDER BY c.id DESC
    `;
    
    db.query(sql, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching cart:', err);
        return callback(err, null);
      }
      callback(null, results);
    });
  },

  /**
   * Add or update product in cart (database)
   * If product exists, increase quantity; otherwise add new item
   * @param {Number} userId - User ID
   * @param {Number} productId - Product ID
   * @param {Number} quantity - Quantity
   * @param {Function} callback - Callback function (err, result)
   */
  addItem(userId, productId, quantity, callback) {
    // Check if item already exists in cart
    const checkSql = 'SELECT * FROM cart WHERE users_id = ? AND products_id = ?';
    
    db.query(checkSql, [userId, productId], (err, results) => {
      if (err) {
        console.error('Error checking cart:', err);
        return callback(err);
      }

      if (results.length > 0) {
        // Item exists, update quantity
        const newQuantity = results[0].quantity + quantity;
        const updateSql = 'UPDATE cart SET quantity = ? WHERE users_id = ? AND products_id = ?';
        db.query(updateSql, [newQuantity, userId, productId], callback);
      } else {
        // Item doesn't exist, insert new
        const insertSql = 'INSERT INTO cart (users_id, products_id, quantity) VALUES (?, ?, ?)';
        db.query(insertSql, [userId, productId, quantity], callback);
      }
    });
  },

  /**
   * Update cart item quantity
   * @param {Number} userId - User ID
   * @param {Number} productId - Product ID
   * @param {Number} newQuantity - New quantity
   * @param {Function} callback - Callback function (err, result)
   */
  updateQuantity(userId, productId, newQuantity, callback) {
    const sql = 'UPDATE cart SET quantity = ? WHERE users_id = ? AND products_id = ?';
    db.query(sql, [newQuantity, userId, productId], callback);
  },

  /**
   * Remove product from cart (database)
   * @param {Number} userId - User ID
   * @param {Number} productId - Product ID to remove
   * @param {Function} callback - Callback function (err, result)
   */
  removeItem(userId, productId, callback) {
    const sql = 'DELETE FROM cart WHERE users_id = ? AND products_id = ?';
    db.query(sql, [userId, productId], callback);
  },

  /**
   * Clear all items in user's cart (database)
   * @param {Number} userId - User ID
   * @param {Function} callback - Callback function (err, result)
   */
  clearCart(userId, callback) {
    const sql = 'DELETE FROM cart WHERE users_id = ?';
    db.query(sql, [userId], callback);
  }
};

// Export cart model
module.exports = cartModel;

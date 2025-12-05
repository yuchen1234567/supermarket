// ========================================
// Order Item Model
// Handles database operations for order_items table
// ========================================
const db = require('../db');

/**
 * Create a single order item record
 */
function create(item, callback) {
    const sql = `
        INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
        VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
        item.order_id,
        item.product_id,
        item.product_name,
        item.price,
        item.quantity
    ];
    db.query(sql, params, callback);
}

/**
 * Bulk create order items for an order
 */
function bulkCreate(orderId, items, callback) {
    if (!items || items.length === 0) return callback(null, { affectedRows: 0 });

    const values = items.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = items.flatMap(i => [
        orderId,
        i.product_id,
        i.product_name,
        i.price,
        i.quantity
    ]);

    const sql = `
        INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
        VALUES ${values}
    `;
    db.query(sql, params, callback);
}

/**
 * Get items by order ID
 */
function findByOrderId(orderId, callback) {
    const sql = 'SELECT * FROM order_items WHERE order_id = ?';
    db.query(sql, [orderId], callback);
}

/**
 * Get items with product details for an order
 */
function findDetailedByOrderId(orderId, callback) {
    const sql = `
        SELECT oi.*, p.productName, p.image
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
    `;
    db.query(sql, [orderId], callback);
}

/**
 * Update quantity for an order item
 */
function updateQuantity(id, quantity, callback) {
    const sql = 'UPDATE order_items SET quantity = ? WHERE id = ?';
    db.query(sql, [quantity, id], callback);
}

/**
 * Delete order item by ID
 */
function deleteById(id, callback) {
    const sql = 'DELETE FROM order_items WHERE id = ?';
    db.query(sql, [id], callback);
}

/**
 * Delete all items for an order
 */
function deleteByOrderId(orderId, callback) {
    const sql = 'DELETE FROM order_items WHERE order_id = ?';
    db.query(sql, [orderId], callback);
}

module.exports = {
    create,
    bulkCreate,
    findByOrderId,
    findDetailedByOrderId,
    updateQuantity,
    delete: deleteById,
    deleteByOrderId
};

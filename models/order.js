// ========================================
// Order Model
// Handles database operations related to order data
// Tables involved: orders (main table) and order_items (detail table)
// ========================================
const db = require('../db');  // Database connection

/**
 * Create new order
 * First create main order record, then insert order items
 * @param {Number} userId - User ID
 * @param {Number} total - Order total price
 * @param {Array} items - Order items array
 * @param {Function} callback - Callback function (err, result)
 */
function create(userId, total, items, callback) {
    // Insert main order record
    const orderSql = 'INSERT INTO orders (user_id, total, created_at) VALUES (?, ?, NOW())';

    db.query(orderSql, [userId, total], (err, result) => {
        if (err) {
            console.error('Error inserting order:', err);
            return callback(err);
        }

        const orderId = result.insertId;  // Get newly created order ID

        // Insert order items
        if (items && items.length > 0) {
            // Prepare order items data
            const itemsValues = items.map(item => [
                orderId,
                item.productId,
                item.productName || 'Unknown Product',
                item.price,
                item.quantity
            ]);

            // Batch insert order items
            const itemsSql = 'INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES ?';
            db.query(itemsSql, [itemsValues], (err) => {
                if (err) {
                    console.error('Error inserting order items:', err);
                    return callback(err);
                }

                // Update product stock after inserting order_items
                updateProductStock(items, (stockErr) => {
                    if (stockErr) {
                        console.error('Error updating product stock:', stockErr);
                        return callback(stockErr);
                    }

                    callback(null, { orderId, insertId: orderId });
                });
            });
        } else {
            callback(null, { orderId, insertId: orderId });
        }
    });
}

/**
 * Update product stock based on items in an order.
 * @param {Array} items - Order items array
 * @param {Function} callback - Callback function (err)
 */
function updateProductStock(items, callback) {
    if (!items || items.length === 0) {
        return callback(null);
    }

    let remaining = items.length;
    let hasError = false;

    items.forEach(item => {
        // Prevent negative stock by adding quantity >= ? condition
        const sql = `
            UPDATE products
            SET quantity = quantity - ?
            WHERE id = ? AND quantity >= ?
        `;

        db.query(sql, [item.quantity, item.productId, item.quantity], (err) => {
            if (hasError) return; // Already errored, don't callback multiple times

            if (err) {
                hasError = true;
                return callback(err);
            }

            remaining -= 1;
            if (remaining === 0 && !hasError) {
                callback(null);
            }
        });
    });
}

/**
 * Get all orders for a user
 * Query order list for specified user, including order item count
 * @param {Number} userId - User ID
 * @param {String} searchQuery - Search query (optional) - searches in order ID, status
 * @param {Function} callback - Callback function (err, orders)
 */
function getByUserId(userId, searchQuery, callback) {
    // If only two arguments are provided, second is the callback (backward compatible)
    if (typeof searchQuery === 'function') {
        callback = searchQuery;
        searchQuery = null;
    }
    
    let sql = `
        SELECT o.*, 
               COUNT(oi.id) as item_count
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE o.user_id = ?
    `;
    
    const params = [userId];
    
    // Add search condition if search query is provided
    if (searchQuery && searchQuery.trim() !== '') {
        sql += ` AND (o.id LIKE ? OR o.status LIKE ?)`;
        const searchPattern = `%${searchQuery.trim()}%`;
        params.push(searchPattern, searchPattern);
    }
    
    sql += `
        GROUP BY o.id
        ORDER BY o.created_at DESC
    `;
    
    db.query(sql, params, (err, results) => callback(err, results));
}

/**
 * Get all orders (admin only)
 * Query all orders in system, including user info and item count
 * @param {String} searchQuery - Search query (optional) - searches in order ID, username, email, status
 * @param {Function} callback - Callback function (err, orders)
 */
function getAll(searchQuery, callback) {
    // If only one argument is provided, it's the callback (backward compatible)
    if (typeof searchQuery === 'function') {
        callback = searchQuery;
        searchQuery = null;
    }
    
    let sql = `
        SELECT o.*, 
               u.username,
               u.email,
               COUNT(oi.id) as item_count
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
    `;
    
    const params = [];
    
    // Add search condition if search query is provided
    if (searchQuery && searchQuery.trim() !== '') {
        sql += `
        WHERE (
            o.id LIKE ? OR
            u.username LIKE ? OR
            u.email LIKE ? OR
            o.status LIKE ?
        )
        `;
        const searchPattern = `%${searchQuery.trim()}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    sql += `
        GROUP BY o.id
        ORDER BY o.created_at DESC
    `;
    
    db.query(sql, params, (err, results) => callback(err, results));
}

/**
 * Get order details by ID
 * Query main order info and all order items
 * @param {Number} orderId - Order ID
 * @param {Function} callback - Callback function (err, order)
 */
function getById(orderId, callback) {
    // Query main order info and user info
    const orderSql = `
        SELECT o.*, u.username, u.email, u.address, u.contact
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
    `;

    db.query(orderSql, [orderId], (err, orderResults) => {
        if (err) return callback(err);
        if (!orderResults || orderResults.length === 0) return callback(null, null);

        const order = orderResults[0];

        // Query order items
        const itemsSql = `
            SELECT oi.*, p.productName, p.image
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `;

        db.query(itemsSql, [orderId], (err, items) => {
            if (err) return callback(err);
            order.items = items;  // Add items to order object
            callback(null, order);
        });
    });
}

/**
 * Update order status
 * @param {Number} orderId - Order ID
 * @param {String} status - New status
 * @param {Function} callback - Callback function (err, result)
 */
function updateStatus(orderId, status, callback) {
    const sql = 'UPDATE orders SET status = ? WHERE id = ?';
    db.query(sql, [status, orderId], (err, result) => callback(err, result));
}

/**
 * Delete order
 * First delete order items, then delete main order record
 * @param {Number} orderId - Order ID
 * @param {Function} callback - Callback function (err, result)
 */
function deleteById(orderId, callback) {
    // First delete order items
    const deleteItemsSql = 'DELETE FROM order_items WHERE order_id = ?';
    db.query(deleteItemsSql, [orderId], (err) => {
        if (err) return callback(err);

        // Then delete main order record
        const deleteOrderSql = 'DELETE FROM orders WHERE id = ?';
        db.query(deleteOrderSql, [orderId], (err, result) => callback(err, result));
    });
}

// ========================================
// Export model methods
// ========================================
module.exports = {
    create,          // Create order
    getByUserId,     // Get user orders
    getAll,          // Get all orders
    getById,         // Get order details
    updateStatus,    // Update order status
    delete: deleteById  // Delete order
};

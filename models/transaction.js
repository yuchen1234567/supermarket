// ========================================
// Transaction Model
// Handles database operations for transactions table
// ========================================
const db = require('../db');

/**
 * Create a transaction record
 */
function create(transaction, callback, connection = null) {
    const sql = `
        INSERT INTO transactions (
            user_id, order_id, type, amount,
            balance_before, balance_after, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        transaction.user_id,
        transaction.order_id || null,
        transaction.type,
        transaction.amount,
        transaction.balance_before,
        transaction.balance_after,
        transaction.status || 'completed',
        transaction.description || null
    ];

    const runner = connection || db;
    runner.query(sql, params, callback);
}

/**
 * List transactions by user
 */
function listByUser(userId, limit = 100, callback) {
    const sql = `
        SELECT t.*, o.id as order_number
        FROM transactions t
        LEFT JOIN orders o ON t.order_id = o.id
        WHERE t.user_id = ?
        ORDER BY t.created_at DESC
        LIMIT ?
    `;
    db.query(sql, [userId, limit], callback);
}

/**
 * List transactions by order
 */
function listByOrder(orderId, callback) {
    const sql = `
        SELECT * FROM transactions
        WHERE order_id = ?
        ORDER BY created_at DESC
    `;
    db.query(sql, [orderId], callback);
}

module.exports = {
    create,
    listByUser,
    listByOrder
};

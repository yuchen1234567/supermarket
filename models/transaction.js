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
            user_id, order_id, type, payment_method, amount,
            balance_before, balance_after, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        transaction.user_id,
        transaction.order_id || null,
        transaction.type,
        transaction.payment_method || null,
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

/**
 * Update status/description for a transaction
 */
function updateStatusAndDescription(id, status, description, callback, connection = null) {
    const runner = connection || db;
    const sql = `
        UPDATE transactions
        SET status = ?, description = ?
        WHERE id = ?
        LIMIT 1
    `;
    runner.query(sql, [status, description || null, id], callback);
}

module.exports = {
    create,
    listByUser,
    listByOrder,
    updateStatusAndDescription
};

/**
 * Get a single transaction by id
 */
function getById(id, callback) {
    const sql = 'SELECT * FROM transactions WHERE id = ? LIMIT 1';
    db.query(sql, [id], (err, results) => {
        if (err) return callback(err);
        callback(null, results && results[0] ? results[0] : null);
    });
}

module.exports.getById = getById;

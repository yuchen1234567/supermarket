/**
 * Refund Model - Refund request management
 */

const db = require('../db');

const Refund = {
    /**
     * Create refund request
     */
    create: (orderId, userId, shipmentId, amount, reason, callback) => {
        const sql = `
            INSERT INTO refund_requests 
            (order_id, user_id, shipment_id, amount, reason)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [orderId, userId, shipmentId, amount, reason], (err, result) => {
            if (err) return callback(err);
            callback(null, result.insertId);
        });
    },

    /**
     * Get refund request by ID
     */
    getById: (id, callback) => {
        const sql = `
            SELECT r.*,
                   o.total as order_total,
                   u.username,
                   u.email,
                   s.tracking_number,
                   s.status as shipment_status
            FROM refund_requests r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN shipments s ON r.shipment_id = s.id
            WHERE r.id = ?
        `;
        db.query(sql, [id], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    /**
     * Get refund requests by user
     */
    getByUserId: (userId, callback) => {
        const sql = `
            SELECT r.*,
                   o.total as order_total,
                   s.tracking_number
            FROM refund_requests r
            JOIN orders o ON r.order_id = o.id
            LEFT JOIN shipments s ON r.shipment_id = s.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        `;
        db.query(sql, [userId], callback);
    },

    /**
     * Get refund request by order ID
     */
    getByOrderId: (orderId, callback) => {
        const sql = `
            SELECT r.*,
                   u.username,
                   s.tracking_number
            FROM refund_requests r
            JOIN users u ON r.user_id = u.id
            LEFT JOIN shipments s ON r.shipment_id = s.id
            WHERE r.order_id = ?
        `;
        db.query(sql, [orderId], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    /**
     * Get all refund requests (admin)
     */
    getAll: (status = null, callback) => {
        let sql = `
            SELECT r.*,
                   o.total as order_total,
                   u.username,
                   u.email,
                   s.tracking_number,
                   s.status as shipment_status
            FROM refund_requests r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN shipments s ON r.shipment_id = s.id
        `;
        
        const params = [];
        if (status) {
            sql += ' WHERE r.status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY r.created_at DESC';
        
        db.query(sql, params, callback);
    },

    /**
     * Approve refund request
     */
    approve: (refundId, adminId, adminResponse, callback) => {
        const sql = `
            UPDATE refund_requests 
            SET status = 'approved',
                admin_response = ?,
                processed_by = ?,
                processed_at = NOW()
            WHERE id = ?
        `;
        db.query(sql, [adminResponse, adminId, refundId], (err, result) => {
            if (err) return callback(err);
            callback(null, result.affectedRows > 0);
        });
    },

    /**
     * Reject refund request
     */
    reject: (refundId, adminId, adminResponse, callback) => {
        const sql = `
            UPDATE refund_requests 
            SET status = 'rejected',
                admin_response = ?,
                processed_by = ?,
                processed_at = NOW()
            WHERE id = ?
        `;
        db.query(sql, [adminResponse, adminId, refundId], (err, result) => {
            if (err) return callback(err);
            callback(null, result.affectedRows > 0);
        });
    },

    /**
     * Update refund status
     */
    updateStatus: (refundId, status, callback) => {
        const sql = 'UPDATE refund_requests SET status = ? WHERE id = ?';
        db.query(sql, [status, refundId], callback);
    }
};

module.exports = Refund;

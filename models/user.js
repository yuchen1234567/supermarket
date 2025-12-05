// ========================================
// User Model
// Handles database operations related to user data
// ========================================
const db = require('../db');  // Database connection

module.exports = {
    /**
     * Get all users
     */
    getAll: function(callback) {
        const sql = 'SELECT id, username, email FROM users';
        db.query(sql, function(err, results) {
            callback(err, results);
        });
    },

    /**
     * Get single user by ID
     */
    getById: function(id, callback) {
        const sql = 'SELECT id, username, email FROM users WHERE id = ? LIMIT 1';
        db.query(sql, [id], function(err, results) {
            if (err) return callback(err);
            callback(null, results[0] || null);  // Return first result or null
        });
    },

    /**
     * Update user information
     */
    update: function(id, user, callback) {
        const sql = 'UPDATE users SET username = ?, email = ?, password = ? WHERE id = ?';
        const params = [user.username, user.email, user.password, id];
        db.query(sql, params, function(err, result) {
            callback(err, result);
        });
    },

    /**
     * Delete user
     */
    delete: function(id, callback) {
        const sql = 'DELETE FROM users WHERE id = ?';
        db.query(sql, [id], function(err, result) {
            callback(err, result);
        });
    }
};

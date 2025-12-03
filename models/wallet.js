/**
 * Wallet Model - User wallet management
 */

const db = require('../db');

const Wallet = {
    /**
     * Get wallet by user ID
     */
    getByUserId: (userId, callback) => {
        const sql = 'SELECT * FROM user_wallets WHERE user_id = ?';
        db.query(sql, [userId], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    /**
     * Create wallet for new user
     */
    create: (userId, initialBalance = 1000.00, callback) => {
        const sql = 'INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)';
        db.query(sql, [userId, initialBalance], (err, result) => {
            if (err) return callback(err);
            callback(null, result.insertId);
        });
    },

    /**
     * Get balance
     */
    getBalance: (userId, callback) => {
        const sql = 'SELECT balance, frozen_balance FROM user_wallets WHERE user_id = ?';
        db.query(sql, [userId], (err, results) => {
            if (err) return callback(err);
            if (results.length === 0) {
                return callback(new Error('Wallet not found'));
            }
            callback(null, {
                balance: results[0].balance,
                frozen_balance: results[0].frozen_balance,
                total: parseFloat(results[0].balance) + parseFloat(results[0].frozen_balance)
            });
        });
    },

    /**
     * Freeze balance (when placing order)
     */
    freezeBalance: (userId, orderId, amount, callback) => {
        db.getConnection((err, connection) => {
            if (err) return callback(err);

            connection.beginTransaction((err) => {
                if (err) {
                    connection.release();
                    return callback(err);
                }

                // Check if balance is sufficient
                const checkSql = 'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE';
                connection.query(checkSql, [userId], (err, results) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(err);
                        });
                    }

                    if (results.length === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(new Error('Wallet not found'));
                        });
                    }

                    const availableBalance = parseFloat(results[0].balance);
                    if (availableBalance < amount) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(new Error('Insufficient balance'));
                        });
                    }

                    const balanceBefore = availableBalance;
                    const balanceAfter = availableBalance - amount;

                    // Deduct from available balance and add to frozen balance
                    const updateSql = `
                        UPDATE user_wallets 
                        SET balance = balance - ?,
                            frozen_balance = frozen_balance + ?,
                            total_expense = total_expense + ?
                        WHERE user_id = ?
                    `;
                    connection.query(updateSql, [amount, amount, amount, userId], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(err);
                            });
                        }

                        // Record transaction
                        const transSql = `
                            INSERT INTO transactions 
                            (user_id, order_id, type, amount, balance_before, balance_after, description)
                            VALUES (?, ?, 'purchase', ?, ?, ?, ?)
                        `;
                        const description = `Payment for order #${orderId}`;
                        connection.query(transSql, [userId, orderId, -amount, balanceBefore, balanceAfter, description], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(err);
                                });
                            }

                            connection.commit((err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(err);
                                    });
                                }
                                connection.release();
                                callback(null, { success: true, balanceAfter });
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Confirm delivery - transfer from frozen to admin
     */
    confirmDelivery: (orderId, userId, adminId, amount, callback) => {
        db.getConnection((err, connection) => {
            if (err) return callback(err);

            connection.beginTransaction((err) => {
                if (err) {
                    connection.release();
                    return callback(err);
                }

                // Deduct from user's frozen balance
                const deductSql = 'UPDATE user_wallets SET frozen_balance = frozen_balance - ? WHERE user_id = ?';
                connection.query(deductSql, [amount, userId], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(err);
                        });
                    }

                    // Get admin's current balance
                    const getAdminBalanceSql = 'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE';
                    connection.query(getAdminBalanceSql, [adminId], (err, results) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(err);
                            });
                        }

                        const adminBalanceBefore = results.length > 0 ? parseFloat(results[0].balance) : 0;
                        const adminBalanceAfter = adminBalanceBefore + amount;

                        // Add to admin's balance
                        const addSql = `
                            UPDATE user_wallets 
                            SET balance = balance + ?,
                                total_income = total_income + ?
                            WHERE user_id = ?
                        `;
                        connection.query(addSql, [amount, amount, adminId], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(err);
                                });
                            }

                            // Record admin's income transaction
                            const transSql = `
                                INSERT INTO transactions 
                                (user_id, order_id, type, amount, balance_before, balance_after, description)
                                VALUES (?, ?, 'income', ?, ?, ?, ?)
                            `;
                            const description = `Income from order #${orderId} (confirmed delivery)`;
                            connection.query(transSql, [adminId, orderId, amount, adminBalanceBefore, adminBalanceAfter, description], (err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(err);
                                    });
                                }

                                connection.commit((err) => {
                                    if (err) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(err);
                                        });
                                    }
                                    connection.release();
                                    callback(null, { success: true });
                                });
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Process refund
     */
    refund: (orderId, userId, amount, callback) => {
        db.getConnection((err, connection) => {
            if (err) return callback(err);

            connection.beginTransaction((err) => {
                if (err) {
                    connection.release();
                    return callback(err);
                }

                // Get current balance
                const getBalanceSql = 'SELECT balance, frozen_balance FROM user_wallets WHERE user_id = ? FOR UPDATE';
                connection.query(getBalanceSql, [userId], (err, results) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(err);
                        });
                    }

                    const balanceBefore = results.length > 0 ? parseFloat(results[0].balance) : 0;
                    const frozenBalance = results.length > 0 ? parseFloat(results[0].frozen_balance) : 0;
                    const balanceAfter = balanceBefore + amount;

                    // Refund: deduct from frozen balance (if any) and add to available balance
                    const refundSql = `
                        UPDATE user_wallets 
                        SET frozen_balance = GREATEST(0, frozen_balance - ?),
                            balance = balance + ?
                        WHERE user_id = ?
                    `;
                    connection.query(refundSql, [amount, amount, userId], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(err);
                            });
                        }

                        // Record refund transaction
                        const transSql = `
                            INSERT INTO transactions 
                            (user_id, order_id, type, amount, balance_before, balance_after, description)
                            VALUES (?, ?, 'refund', ?, ?, ?, ?)
                        `;
                        const description = `Refund for order #${orderId}`;
                        connection.query(transSql, [userId, orderId, amount, balanceBefore, balanceAfter, description], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(err);
                                });
                            }

                            connection.commit((err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(err);
                                    });
                                }
                                connection.release();
                                callback(null, { success: true, balanceAfter });
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Recharge wallet
     */
    recharge: (userId, amount, description, callback) => {
        db.getConnection((err, connection) => {
            if (err) return callback(err);

            connection.beginTransaction((err) => {
                if (err) {
                    connection.release();
                    return callback(err);
                }

                const ensureWalletSql = `
                    INSERT INTO user_wallets (user_id, balance)
                    VALUES (?, 0)
                    ON DUPLICATE KEY UPDATE user_id = user_id
                `;

                connection.query(ensureWalletSql, [userId], (ensureErr) => {
                    if (ensureErr) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(ensureErr);
                        });
                    }

                    const getBalanceSql = 'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE';
                    connection.query(getBalanceSql, [userId], (err, results) => {
                        if (err || !results || results.length === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(err || new Error('Wallet not found'));
                            });
                        }

                        const balanceBefore = parseFloat(results[0].balance) || 0;
                        const balanceAfter = balanceBefore + amount;

                        const updateSql = 'UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?';
                        connection.query(updateSql, [amount, userId], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(err);
                                });
                            }

                            const transSql = `
                                INSERT INTO transactions 
                                (user_id, type, amount, balance_before, balance_after, description)
                                VALUES (?, 'recharge', ?, ?, ?, ?)
                            `;
                            connection.query(transSql, [userId, amount, balanceBefore, balanceAfter, description || 'Wallet recharge'], (err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(err);
                                    });
                                }

                                connection.commit((err) => {
                                    if (err) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(err);
                                        });
                                    }
                                    connection.release();
                                    callback(null, { success: true, balanceAfter });
                                });
                            });
                        });
                    });
                });
            });
        });
    },

    /**
     * Get transaction history
     */
    getTransactions: (userId, limit = 50, callback) => {
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
};

module.exports = Wallet;

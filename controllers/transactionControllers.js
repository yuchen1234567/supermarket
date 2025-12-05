// ========================================
// Transaction Controllers
// Handles viewing transactions from transactions table
// ========================================
const Transaction = require('../models/transaction');

/**
 * User: View own transactions
 */
function listUserTransactions(req, res) {
    const user = req.session.user;

    Transaction.listByUser(user.id, 100, (err, transactions) => {
        if (err) {
            console.error('Error fetching transactions:', err);
            req.flash('error', 'Failed to load transactions');
            return res.redirect('/wallet');
        }

        res.render('transactions', {
            user,
            transactions: transactions || [],
            messages: req.flash()
        });
    });
}

/**
 * Admin: View all transactions (optional filter by user or order)
 */
function listAllTransactions(req, res) {
    const userId = req.query.user_id || null;
    const orderId = req.query.order_id || null;
    const viewer = req.session.user;

    // Build filters using existing listByUser/listByOrder helpers for simplicity
    if (userId) {
        return Transaction.listByUser(userId, 200, (err, transactions) => {
            if (err) {
                console.error('Error fetching transactions:', err);
                req.flash('error', 'Failed to load transactions');
                return res.redirect('/admin/dashboard');
            }

            res.render('adminTransactions', {
                user: viewer,
                transactions: transactions || [],
                filter: { userId, orderId: null },
                messages: req.flash()
            });
        });
    }

    if (orderId) {
        return Transaction.listByOrder(orderId, (err, transactions) => {
            if (err) {
                console.error('Error fetching transactions:', err);
                req.flash('error', 'Failed to load transactions');
                return res.redirect('/admin/dashboard');
            }

            res.render('adminTransactions', {
                user: viewer,
                transactions: transactions || [],
                filter: { userId: null, orderId },
                messages: req.flash()
            });
        });
    }

    // Default: show latest transactions across users (limited)
    const sql = `
        SELECT t.*, u.username, u.email
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
        LIMIT 200
    `;
    require('../db').query(sql, (err, transactions) => {
        if (err) {
            console.error('Error fetching transactions:', err);
            req.flash('error', 'Failed to load transactions');
            return res.redirect('/admin/dashboard');
        }

        res.render('adminTransactions', {
            user: viewer,
            transactions: transactions || [],
            filter: { userId: null, orderId: null },
            messages: req.flash()
        });
    });
}

module.exports = {
    listUserTransactions,
    listAllTransactions
};

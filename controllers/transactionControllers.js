// ========================================
// Transaction Controllers
// Handles viewing transactions from transactions table
// ========================================
const Transaction = require('../models/transaction');
const PDFDocument = require('pdfkit');
const db = require('../db');

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
    , downloadInvoicePdf
};

/**
 * Generate and stream a simple invoice PDF for a transaction
 * Shows out_trade_no, trade_no, amount, actual paid, date, description
 */
function downloadInvoicePdf(req, res) {
    const user = req.session.user;
    const txnId = parseInt(req.params.id, 10);
    if (Number.isNaN(txnId) || txnId <= 0) {
        req.flash('error', 'Invalid transaction id');
        return res.redirect('/wallet');
    }

    Transaction.getById(txnId, (err, txn) => {
        if (err || !txn) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/wallet');
        }

        if (user.role !== 'admin' && txn.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/wallet');
        }

        // Try to extract trade identifiers from txn or description
        let trade_no = txn.trade_no || null;
        let out_trade_no = txn.out_trade_no || null;
        const desc = (txn.description || '').toString();
        if (!trade_no) {
            const m = desc.match(/trade_no\s*[:=]?\s*([A-Za-z0-9_\-]+)/i);
            if (m) trade_no = m[1];
        }
        if (!out_trade_no) {
            const m2 = desc.match(/out_trade_no\s*[:=]?\s*([A-Za-z0-9_\-]+)/i);
            if (m2) out_trade_no = m2[1];
            else {
                const m3 = desc.match(/\b(TXN_\d+)\b/i);
                if (m3) out_trade_no = m3[1];
            }
        }

        const paidAmount = Number(txn.amount) || 0;
        const createdAt = txn.created_at ? new Date(txn.created_at) : new Date();

        // Generate PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice_txn_${txn.id}.pdf"`);

        doc.fontSize(18).text('Invoice (Payment Receipt)', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Transaction ID: ${txn.id}`);
        if (out_trade_no) doc.text(`Out Trade No: ${out_trade_no}`);
        if (trade_no) doc.text(`Trade No: ${trade_no}`);
        doc.text(`Type: ${txn.type || ''}`);
        doc.text(`Payment Method: ${txn.payment_method || ''}`);
        doc.text(`Amount: $${paidAmount.toFixed(2)}`);
        doc.text(`Status: ${txn.status || ''}`);
        doc.text(`Date: ${createdAt.toLocaleString('en-SG')}`);
        doc.moveDown();

        doc.fontSize(12).text('Description:');
        doc.fontSize(10).text(txn.description || '-', { width: 500 });

        doc.moveDown(2);
        doc.fontSize(10).text('This is a system generated payment receipt.', { align: 'center' });

        doc.end();
        doc.pipe(res);
    });
}

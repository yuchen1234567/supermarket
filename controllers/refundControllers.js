// ========================================
// Refund Controllers
// Handles refund_requests table operations
// ========================================
const Refund = require('../models/refund');
const Order = require('../models/order');
const Wallet = require('../models/wallet');
const shippingModel = require('../models/shipping');

/**
 * User: Request refund for an order
 */
function requestRefund(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.orderId, 10);
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
        req.flash('error', 'Please provide a detailed reason (at least 10 characters)');
        return res.redirect(`/order/${orderId}`);
    }

    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        if (order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }

        if (order.is_confirmed) {
            req.flash('error', 'Cannot request refund after confirming delivery');
            return res.redirect(`/order/${orderId}`);
        }

        Refund.getByOrderId(orderId, (refErr, existingRefund) => {
            if (refErr) {
                console.error('Error checking refund:', refErr);
                req.flash('error', 'Failed to process refund request');
                return res.redirect(`/order/${orderId}`);
            }

            if (existingRefund) {
                req.flash('error', 'Refund request already exists for this order');
                return res.redirect(`/order/${orderId}`);
            }

            shippingModel.getByOrderId(orderId, (shipErr, shipment) => {
                const shipmentId = shipment ? shipment.id : null;

                Refund.create(orderId, user.id, shipmentId, order.total, reason, (createErr) => {
                    if (createErr) {
                        console.error('Error creating refund:', createErr);
                        req.flash('error', 'Failed to submit refund request');
                    } else {
                        req.flash('success', 'Refund request submitted successfully. Please wait for admin approval.');
                    }
                    res.redirect(`/order/${orderId}`);
                });
            });
        });
    });
}

/**
 * User: View own refund requests
 */
function viewMyRefunds(req, res) {
    const user = req.session.user;

    Refund.getByUserId(user.id, (err, refunds) => {
        if (err) {
            console.error('Error fetching refunds:', err);
            req.flash('error', 'Failed to load refund requests');
            return res.redirect('/wallet');
        }

        res.render('myRefunds', {
            user,
            refunds: refunds || [],
            messages: req.flash()
        });
    });
}

/**
 * Admin: List all refund requests
 */
function viewAllRefunds(req, res) {
    const user = req.session.user;
    const status = req.query.status || null;

    Refund.getAll(status, (err, refunds) => {
        if (err) {
            console.error('Error fetching refunds:', err);
            req.flash('error', 'Failed to load refund requests');
            return res.redirect('/admin/dashboard');
        }

        res.render('adminRefunds', {
            user,
            refunds: refunds || [],
            currentStatus: status,
            messages: req.flash()
        });
    });
}

/**
 * Admin: View refund details
 */
function viewRefundDetails(req, res) {
    const user = req.session.user;
    const refundId = parseInt(req.params.id, 10);

    Refund.getById(refundId, (err, refund) => {
        if (err || !refund) {
            req.flash('error', 'Refund request not found');
            return res.redirect('/admin/refunds');
        }

        res.render('adminRefundDetails', {
            user,
            refund,
            messages: req.flash()
        });
    });
}

/**
 * Admin: Process refund (approve/reject)
 */
function processRefund(req, res) {
    const user = req.session.user;
    const refundId = parseInt(req.params.id, 10);
    const { action, admin_response } = req.body;

    if (!action || (action !== 'approve' && action !== 'reject')) {
        req.flash('error', 'Invalid action');
        return res.redirect(`/admin/refund/${refundId}`);
    }

    Refund.getById(refundId, (err, refund) => {
        if (err || !refund) {
            req.flash('error', 'Refund request not found');
            return res.redirect('/admin/refunds');
        }

        if (refund.status !== 'pending') {
            req.flash('error', 'This refund request has already been processed');
            return res.redirect(`/admin/refund/${refundId}`);
        }

        if (action === 'approve') {
            Refund.approve(refundId, user.id, admin_response || 'Refund approved', (approveErr) => {
                if (approveErr) {
                    console.error('Error approving refund:', approveErr);
                    req.flash('error', 'Failed to approve refund');
                    return res.redirect(`/admin/refund/${refundId}`);
                }

                Wallet.refund(refund.order_id, refund.user_id, refund.amount, (walletErr) => {
                    if (walletErr) {
                        console.error('Error processing refund:', walletErr);
                        req.flash('error', 'Failed to process refund payment');
                    } else {
                        req.flash('success', `Refund approved and $${refund.amount.toFixed(2)} refunded to user`);
                    }
                    res.redirect('/admin/refunds');
                });
            });
        } else {
            Refund.reject(refundId, user.id, admin_response || 'Refund rejected', (rejectErr) => {
                if (rejectErr) {
                    console.error('Error rejecting refund:', rejectErr);
                    req.flash('error', 'Failed to reject refund');
                } else {
                    req.flash('success', 'Refund request rejected');
                }
                res.redirect('/admin/refunds');
            });
        }
    });
}

module.exports = {
    requestRefund,
    viewMyRefunds,
    viewAllRefunds,
    viewRefundDetails,
    processRefund
};

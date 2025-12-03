/**
 * Wallet Controllers - Wallet and transaction management
 */

const Wallet = require('../models/wallet');
const Refund = require('../models/refund');
const Order = require('../models/order');

/**
 * View wallet dashboard
 */
function viewWallet(req, res) {
    const user = req.session.user;
    
    Wallet.getByUserId(user.id, (err, wallet) => {
        if (err) {
            console.error('Error fetching wallet:', err);
            req.flash('error', 'Failed to load wallet');
            return res.redirect('/');
        }
        
        // Get recent transactions
        Wallet.getTransactions(user.id, 20, (err, transactions) => {
            if (err) {
                console.error('Error fetching transactions:', err);
            }
            
            res.render('wallet', {
                user,
                wallet: wallet || { balance: 0, frozen_balance: 0, total_income: 0, total_expense: 0 },
                transactions: transactions || [],
                messages: req.flash()
            });
        });
    });
}

/**
 * Recharge wallet (for testing/demo)
 */
function recharge(req, res) {
    const user = req.session.user;
    const amount = parseFloat(req.body.amount);
    
    if (!amount || amount <= 0) {
        req.flash('error', 'Invalid amount');
        return res.redirect('/wallet');
    }
    
    if (amount > 10000) {
        req.flash('error', 'Maximum recharge amount is $10,000');
        return res.redirect('/wallet');
    }
    
    Wallet.recharge(user.id, amount, 'Manual recharge', (err, result) => {
        if (err) {
            console.error('Error recharging wallet:', err);
            req.flash('error', 'Failed to recharge wallet');
        } else {
            req.flash('success', `Successfully recharged $${amount.toFixed(2)}`);
        }
        res.redirect('/wallet');
    });
}

/**
 * View transaction history
 */
function viewTransactions(req, res) {
    const user = req.session.user;
    
    Wallet.getTransactions(user.id, 100, (err, transactions) => {
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
 * Request refund
 */
function requestRefund(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.orderId);
    const { reason } = req.body;
    
    const shippingModel = require('../models/shipping');
    
    if (!reason || reason.trim().length < 10) {
        req.flash('error', 'Please provide a detailed reason (at least 10 characters)');
        return res.redirect(`/order/${orderId}`);
    }
    
    // Get order details
    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }
        
        // Check if order belongs to user
        if (order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }
        
        // Check if already confirmed delivery
        if (order.is_confirmed) {
            req.flash('error', 'Cannot request refund after confirming delivery');
            return res.redirect(`/order/${orderId}`);
        }
        
        // Check if refund already requested
        Refund.getByOrderId(orderId, (err, existingRefund) => {
            if (err) {
                console.error('Error checking refund:', err);
                req.flash('error', 'Failed to process refund request');
                return res.redirect(`/order/${orderId}`);
            }
            
            if (existingRefund) {
                req.flash('error', 'Refund request already exists for this order');
                return res.redirect(`/order/${orderId}`);
            }
            
            // Get shipment info for this order
            shippingModel.getByOrderId(orderId, (shipErr, shipment) => {
                const shipmentId = shipment ? shipment.id : null;
                
                // Create refund request
                Refund.create(orderId, user.id, shipmentId, order.total, reason, (err, refundId) => {
                    if (err) {
                        console.error('Error creating refund:', err);
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
 * View my refund requests
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
 * Admin: View all refund requests
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
 * Admin: View refund request details
 */
function viewRefundDetails(req, res) {
    const user = req.session.user;
    const refundId = parseInt(req.params.id);
    
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
 * Admin: Process refund (approve or reject)
 */
function processRefund(req, res) {
    const user = req.session.user;
    const refundId = parseInt(req.params.id);
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
            // Approve refund
            Refund.approve(refundId, user.id, admin_response || 'Refund approved', (err, success) => {
                if (err) {
                    console.error('Error approving refund:', err);
                    req.flash('error', 'Failed to approve refund');
                    return res.redirect(`/admin/refund/${refundId}`);
                }
                
                // Process the actual refund
                Wallet.refund(refund.order_id, refund.user_id, refund.amount, (err, result) => {
                    if (err) {
                        console.error('Error processing refund:', err);
                        req.flash('error', 'Failed to process refund payment');
                    } else {
                        req.flash('success', `Refund approved and $${refund.amount.toFixed(2)} refunded to user`);
                    }
                    res.redirect('/admin/refunds');
                });
            });
        } else {
            // Reject refund
            Refund.reject(refundId, user.id, admin_response || 'Refund rejected', (err, success) => {
                if (err) {
                    console.error('Error rejecting refund:', err);
                    req.flash('error', 'Failed to reject refund');
                } else {
                    req.flash('success', 'Refund request rejected');
                }
                res.redirect('/admin/refunds');
            });
        }
    });
}

/**
 * Confirm delivery (user confirms receipt)
 */
function confirmDelivery(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.orderId);
    
    const shippingModel = require('../models/shipping');
    
    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }
        
        // Check if order belongs to user
        if (order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }
        
        // Check if already confirmed
        if (order.is_confirmed) {
            req.flash('error', 'Order already confirmed');
            return res.redirect(`/order/${orderId}`);
        }
        
        // Get shipment info to check delivery status
        shippingModel.getByOrderId(orderId, (shipErr, shipment) => {
            if (shipErr) {
                console.error('Error fetching shipment:', shipErr);
                req.flash('error', 'Failed to fetch shipment information');
                return res.redirect(`/order/${orderId}`);
            }
            
            // Check if shipment is delivered
            if (!shipment || shipment.status !== 'delivered') {
                req.flash('error', 'Can only confirm after shipment is delivered');
                return res.redirect(`/order/${orderId}`);
            }
            
            // Find admin user (role = 'admin')
            const findAdminSql = "SELECT id FROM users WHERE role = 'admin' LIMIT 1";
            require('../db').query(findAdminSql, (err, admins) => {
                if (err || admins.length === 0) {
                    console.error('Error finding admin:', err);
                    req.flash('error', 'System error: Admin not found');
                    return res.redirect(`/order/${orderId}`);
                }
                
                const adminId = admins[0].id;
                
                // Confirm delivery and transfer money from frozen to admin
                Wallet.confirmDelivery(orderId, user.id, adminId, order.total, (err, result) => {
                    if (err) {
                        console.error('Error confirming delivery:', err);
                        req.flash('error', 'Failed to confirm delivery');
                    } else {
                        req.flash('success', 'Delivery confirmed! Payment transferred to merchant.');
                    }
                    res.redirect(`/order/${orderId}`);
                });
            });
        });
    });
}

module.exports = {
    viewWallet,
    recharge,
    viewTransactions,
    requestRefund,
    viewMyRefunds,
    viewAllRefunds,
    viewRefundDetails,
    processRefund,
    confirmDelivery
};

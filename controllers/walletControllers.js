/**
 * Wallet Controllers - Wallet and transaction management
 */

const Wallet = require('../models/wallet');
const Order = require('../models/order');
const alipaySandbox = require('../utils/alipaySandbox');
const paypalSandbox = require('../utils/paypalSandbox');
const netsSandbox = require('../utils/netsSandbox');

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
    const paymentMethod = (req.body.paymentMethod || 'manual').toString().trim().toLowerCase();
    
    if (!amount || amount <= 0) {
        req.flash('error', 'Invalid amount');
        return res.redirect('/wallet');
    }
    
    if (amount > 10000) {
        req.flash('error', 'Maximum recharge amount is $10,000');
        return res.redirect('/wallet');
    }

    if (paymentMethod === 'alipay') {
        return alipaySandbox.startWalletRecharge(req, res, user.id, amount);
    }

    if (paymentMethod === 'paypal') {
        return paypalSandbox.startWalletRecharge(req, res, user.id, amount);
    }

    if (paymentMethod === 'nets') {
        return netsSandbox.startWalletRecharge(req, res, user.id, amount);
    }
    
    Wallet.recharge(user.id, amount, 'Manual recharge', (err, result) => {
        if (err) {
            console.error('Error recharging wallet:', err);
            req.flash('error', 'Failed to recharge wallet');
        } else {
            req.flash('success', `Successfully recharged $${amount.toFixed(2)}`);
        }
        res.redirect('/wallet');
    }, paymentMethod === 'manual' ? 'manual' : null);
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
    confirmDelivery
};

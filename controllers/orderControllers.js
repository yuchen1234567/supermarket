// ========================================
// Order Controller
// Handles all order-related business logic
// Now uses database-based cart for data persistence
// ========================================
const Order = require('../models/order');  // Order model
const cartModel = require('../models/cart');  // Cart model
const shippingModel = require('../models/shipping');  // Shipping model
const addressModel = require('../models/address');  // Address model
const Wallet = require('../models/wallet');  // Wallet model

/**
 * Show checkout page
 * Display order summary, delivery address selection, and payment info
 */
function showCheckout(req, res) {
    const user = req.session.user;
    
    // Get cart data
    cartModel.getCart(user.id, (err, cart) => {
        if (err) {
            console.error('Error fetching cart:', err);
            req.flash('error', 'Error loading cart. Please try again.');
            return res.redirect('/cart');
        }
        
        // Check if cart is empty
        if (!cart || cart.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }
        
        // Get user's wallet balance
        Wallet.getBalance(user.id, (walletErr, wallet) => {
            if (walletErr) {
                console.error('Error fetching wallet:', walletErr);
                wallet = { balance: 0, frozen_balance: 0 };
            }
            
            // Get user's addresses
            addressModel.getByUserId(user.id, (addrErr, addresses) => {
                if (addrErr) {
                    console.error('Error fetching addresses:', addrErr);
                    addresses = [];
                }
                
                res.render('checkout', {
                    user: user,
                    cart: cart,
                    wallet: wallet,
                    addresses: addresses,
                    messages: req.flash()
                });
            });
        });
    });
}

/**
 * Checkout function
 * Convert shopping cart items from database into an order
 */
function checkout(req, res) {
    const user = req.session.user;  // Get current user
    
    // Get cart data from database
    cartModel.getCart(user.id, (err, cart) => {
        if (err) {
            console.error('Error fetching cart:', err);
            req.flash('error', 'Error loading cart. Please try again.');
            return res.redirect('/cart');
        }
        
        // Check if cart is empty
        if (!cart || cart.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }
        
        // Validate cart items
        for (let item of cart) {
            if (!item.productId || !item.price || !item.quantity) {
                console.error('Invalid cart item:', item);
                req.flash('error', 'Invalid cart data. Please try again.');
                return res.redirect('/cart');
            }
        }
        
        // Calculate order total
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Check wallet balance first
        Wallet.getBalance(user.id, (err, balanceInfo) => {
            if (err) {
                console.error('Error checking balance:', err);
                req.flash('error', 'Failed to check wallet balance');
                return res.redirect('/cart');
            }
            
            if (balanceInfo.balance < total) {
                req.flash('error', `Insufficient balance. You need $${total.toFixed(2)} but only have $${balanceInfo.balance.toFixed(2)}. Please recharge your wallet.`);
                return res.redirect('/wallet');
            }
            
            // Prepare order items data
            const items = cart.map(item => ({
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                price: item.price
            }));
            
            // Create order
            Order.create(user.id, total, items, (err, result) => {
                if (err) {
                    console.error('=== Error creating order ===');
                    console.error('Error details:', err);
                    req.flash('error', 'Failed to create order. Please try again or contact support.');
                    return res.redirect('/cart');
                }
                
                const orderId = result.orderId || result.insertId;
                
                // Freeze balance for this order
                Wallet.freezeBalance(user.id, orderId, total, (freezeErr, freezeResult) => {
                    if (freezeErr) {
                        console.error('Error freezing balance:', freezeErr);
                        req.flash('error', 'Payment failed: ' + freezeErr.message);
                        // TODO: Rollback order creation
                        return res.redirect('/cart');
                    }
                    
                    // Create shipment record automatically
                    createShipmentForOrder(orderId, user.id, total, (shipErr) => {
                        if (shipErr) {
                            console.error('Error creating shipment:', shipErr);
                            // Continue even if shipment creation fails
                        }
                        
                        // Clear cart from database after successful order
                        cartModel.clearCart(user.id, (clearErr) => {
                            if (clearErr) {
                                console.error('Error clearing cart:', clearErr);
                            }
                            
                            req.flash('success', `Order placed successfully! $${total.toFixed(2)} has been deducted from your wallet. Confirm delivery to complete the transaction.`);
                            res.redirect('/orders');
                        });
                    });
                });
            });
        });
    });
}

/**
 * View user's own order list
 * Display all orders for the current user
 * Supports search by order ID or status
 */
function listUserOrders(req, res) {
    const user = req.session.user;  // Get current user
    const searchQuery = req.query.search || '';  // Get search query from URL parameter
    
    // Query all orders for the user (with optional search filter)
    Order.getByUserId(user.id, searchQuery, (err, orders) => {
        if (err) {
            console.error('Error fetching orders:', err);
            return res.render('orders', { 
                orders: [], 
                error: 'Failed to load orders', 
                user,
                messages: req.flash(),
                searchQuery 
            });
        }
        
        res.render('orders', { 
            orders, 
            error: null, 
            user, 
            messages: req.flash(),
            searchQuery 
        });
    });
}

/**
 * View all orders (admin only)
 * Admin can view all orders from all users in the system
 * Supports search by order ID, username, email, or status
 */
function listAllOrders(req, res) {
    const user = req.session.user;  // Get current user (should be admin)
    const searchQuery = req.query.search || '';  // Get search query from URL parameter
    
    // Query all orders (with optional search filter)
    Order.getAll(searchQuery, (err, orders) => {
        if (err) {
            console.error('Error fetching all orders:', err);
            return res.render('adminOrders', { 
                orders: [], 
                error: 'Failed to load orders', 
                user,
                searchQuery 
            });
        }
        
        res.render('adminOrders', { 
            orders, 
            error: null, 
            user,
            searchQuery 
        });
    });
}

/**
 * View order details
 * Display detailed information for a single order
 * Users can only view their own orders, admins can view all orders
 */
function viewOrder(req, res) {
    const user = req.session.user;  // Get current user
    const orderId = parseInt(req.params.id, 10);  // Get order ID from URL
    
    // Validate order ID
    if (Number.isNaN(orderId)) {
        req.flash('error', 'Invalid order ID');
        return res.redirect('/orders');
    }
    
    // Query order information
    Order.getById(orderId, (err, order) => {
        if (err) {
            console.error('Error fetching order:', err);
            req.flash('error', 'Failed to load order');
            return res.redirect('/orders');
        }
        
        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }
        
        // Check if user has permission to view this order (order owner or admin)
        if (user.role !== 'admin' && order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }
        
        // Get shipment information for this order
        shippingModel.getByOrderId(orderId, (shipErr, shipment) => {
            if (shipErr) {
                console.error('Error fetching shipment:', shipErr);
            }
            
            // Get refund request for this order
            const Refund = require('../models/refund');
            Refund.getByOrderId(orderId, (refundErr, refundRequest) => {
                if (refundErr) {
                    console.error('Error fetching refund:', refundErr);
                }
                
                order.refund_request = refundRequest || null;
                
                // If shipment exists, get tracking history
                if (shipment) {
                    shippingModel.getTrackingHistory(shipment.id, (trackErr, tracking) => {
                        if (trackErr) {
                            console.error('Error fetching tracking:', trackErr);
                        }
                        shipment.tracking = tracking || [];
                        order.shipment = shipment;
                        res.render('orderDetails', { order, error: null, user, messages: req.flash() });
                    });
                } else {
                    order.shipment = null;
                    res.render('orderDetails', { order, error: null, user, messages: req.flash() });
                }
            });
        });
    });
}

/**
 * Update order status (admin only)
 * Admin can change order processing status (e.g., pending, shipped, completed, etc.)
 */
function updateStatus(req, res) {
    const orderId = parseInt(req.params.id, 10);  // Get order ID from URL
    const status = req.body.status;  // Get new status
    
    // Validate request parameters
    if (Number.isNaN(orderId) || !status) {
        req.flash('error', 'Invalid request');
        return res.redirect('/admin/orders');
    }
    
    // Update order status
    Order.updateStatus(orderId, status, (err) => {
        if (err) {
            console.error('Error updating order status:', err);
            req.flash('error', 'Failed to update order status');
        } else {
            req.flash('success', 'Order status updated successfully');
        }
        res.redirect('/admin/orders');  // Return to admin orders page
    });
}

/**
 * Delete order (admin only)
 * Admin can delete order records
 */
function deleteOrder(req, res) {
    const orderId = parseInt(req.params.id, 10);  // Get order ID from URL
    
    // Validate order ID
    if (Number.isNaN(orderId)) {
        req.flash('error', 'Invalid order ID');
        return res.redirect('/admin/orders');
    }
    
    // Delete order
    Order.delete(orderId, (err) => {
        if (err) {
            console.error('Error deleting order:', err);
            req.flash('error', 'Failed to delete order');
        } else {
            req.flash('success', 'Order deleted successfully');
        }
        res.redirect('/admin/orders');  // Return to admin orders page
    });
}

/**
 * Print order invoice
 * Display order details in print-friendly format
 */
function printOrder(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.id, 10);
    
    if (Number.isNaN(orderId)) {
        req.flash('error', 'Invalid order ID');
        return res.redirect('/orders');
    }
    
    // Get order details
    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }
        
        // Check permissions
        if (user.role !== 'admin' && order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }
        
        // Render invoice template
        res.render('orderInvoice', { 
            order, 
            items: order.items || [],
            user: user
        });
    });
}

/**
 * Download order invoice as PDF
 * Opens print dialog with auto-print enabled
 */
function downloadPDF(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.id, 10);
    
    if (Number.isNaN(orderId)) {
        req.flash('error', 'Invalid order ID');
        return res.redirect('/orders');
    }
    
    // Get order details
    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }
        
        // Check permissions
        if (user.role !== 'admin' && order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }
        
        // Render invoice template with auto-print enabled
        res.render('orderInvoice', { 
            order, 
            items: order.items || [],
            user: user,
            autoPrint: true  // Auto-open print dialog for PDF download
        });
    });
}

/**
 * Helper function: Create shipment for order automatically
 * Creates a shipment record with default shipping details
 */
function createShipmentForOrder(orderId, userId, orderTotal, callback) {
    // Get user's default address
    addressModel.getDefaultByUserId(userId, (err, address) => {
        if (err) {
            console.error('Error getting default address:', err);
            return callback(err);
        }
        
        // If no address found, use user's profile address from users table
        if (!address) {
            const db = require('../db');
            db.query('SELECT username, contact, address FROM users WHERE id = ?', [userId], (userErr, userResults) => {
                if (userErr || !userResults || userResults.length === 0) {
                    return callback(new Error('User address not found'));
                }
                
                const user = userResults[0];
                createShipmentWithAddress(orderId, {
                    recipient_name: user.username,
                    phone: user.contact,
                    address_line1: user.address || 'No address provided',
                    city: 'Singapore',
                    postal_code: '000000',
                    country: 'Singapore'
                }, orderTotal, callback);
            });
        } else {
            createShipmentWithAddress(orderId, address, orderTotal, callback);
        }
    });
}

/**
 * Helper function: Create shipment with given address
 */
function createShipmentWithAddress(orderId, address, orderTotal, callback) {
    // Calculate shipping fee based on order total
    let shippingFee = 5.00;  // Standard fee
    if (orderTotal >= 50) {
        shippingFee = 0;  // Free shipping for orders above $50
    }
    
    // Determine shipping method
    const shippingMethod = orderTotal >= 100 ? 'express' : 'standard';
    
    // Calculate estimated delivery
    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + (shippingMethod === 'express' ? 1 : 3));
    
    // Generate tracking number
    const trackingNumber = shippingModel.generateTrackingNumber(orderId);
    
    // Create shipment data
    const shipmentData = {
        order_id: orderId,
        tracking_number: trackingNumber,
        shipping_method: shippingMethod,
        shipping_fee: shippingFee,
        carrier: shippingMethod === 'express' ? 'DHL Express' : 'SingPost',
        recipient_name: address.recipient_name,
        phone: address.phone,
        address_line1: address.address_line1,
        address_line2: address.address_line2 || null,
        city: address.city || 'Singapore',
        state: address.state || null,
        postal_code: address.postal_code,
        country: address.country || 'Singapore',
        status: 'pending',
        estimated_delivery: estimatedDelivery.toISOString().split('T')[0],
        notes: `Order total: $${orderTotal.toFixed(2)}. ${shippingFee === 0 ? 'Free shipping applied.' : ''}`
    };
    
    // Create shipment
    shippingModel.create(shipmentData, callback);
}

// ========================================
// Export all controller functions
// ========================================
module.exports = {
    showCheckout,      // Show checkout page
    checkout,          // Checkout function (POST)
    listUserOrders,    // View user orders
    listAllOrders,     // View all orders (admin)
    viewOrder,         // View order details
    updateStatus,      // Update order status (admin)
    deleteOrder,       // Delete order (admin)
    printOrder,        // Print order invoice
    downloadPDF        // Download order as PDF
};

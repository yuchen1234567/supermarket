// ========================================
// Shipping Controllers
// Handle shipping and delivery related business logic
// ========================================
const shippingModel = require('../models/shipping');
const orderModel = require('../models/order');
const addressModel = require('../models/address');

/**
 * View shipment tracking page (customer)
 * GET /shipping/track/:trackingNumber
 */
function trackShipment(req, res) {
    const trackingNumber = req.params.trackingNumber;
    
    shippingModel.getByTrackingNumber(trackingNumber, (err, shipment) => {
        if (err) {
            console.error('Error fetching shipment:', err);
            req.flash('error', 'Error loading shipment information');
            return res.redirect('/orders');
        }
        
        if (!shipment) {
            req.flash('error', 'Shipment not found with this tracking number');
            return res.redirect('/orders');
        }
        
        // Check if user has permission to view this shipment
        if (req.session.user.role !== 'admin' && shipment.user_id !== req.session.user.id) {
            req.flash('error', 'You do not have permission to view this shipment');
            return res.redirect('/orders');
        }
        
        // Get tracking history
        shippingModel.getTrackingHistory(shipment.id, (trackErr, tracking) => {
            if (trackErr) {
                console.error('Error fetching tracking history:', trackErr);
            }
            
            shipment.tracking = tracking || [];
            
            res.render('trackShipment', {
                user: req.session.user,
                shipment: shipment,
                messages: req.flash()
            });
        });
    });
}

/**
 * Admin: View all shipments
 * GET /admin/shipments
 */
function listAllShipments(req, res) {
    const searchQuery = req.query.search || '';
    
    shippingModel.getAll(searchQuery, (err, shipments) => {
        if (err) {
            console.error('Error fetching shipments:', err);
            req.flash('error', 'Error loading shipments');
            return res.redirect('/admin/orders');
        }
        
        res.render('adminShipments', {
            user: req.session.user,
            shipments: shipments,
            searchQuery: searchQuery,
            messages: req.flash()
        });
    });
}

/**
 * Admin: View shipment details
 * GET /admin/shipment/:id
 */
function viewShipmentDetails(req, res) {
    const shipmentId = req.params.id;
    
    shippingModel.getWithTracking(shipmentId, (err, shipment) => {
        if (err) {
            console.error('Error fetching shipment:', err);
            req.flash('error', 'Error loading shipment details');
            return res.redirect('/admin/shipments');
        }
        
        if (!shipment) {
            req.flash('error', 'Shipment not found');
            return res.redirect('/admin/shipments');
        }
        
        // Get order details
        orderModel.getById(shipment.order_id, (orderErr, order) => {
            if (orderErr) {
                console.error('Error fetching order:', orderErr);
            }
            
            res.render('adminShipmentDetails', {
                user: req.session.user,
                shipment: shipment,
                order: order,
                messages: req.flash()
            });
        });
    });
}

/**
 * Admin: Update shipment status
 * POST /admin/shipment/:id/status
 */
function updateShipmentStatus(req, res) {
    const shipmentId = req.params.id;
    const { status, location, description } = req.body;
    
    if (!status) {
        req.flash('error', 'Status is required');
        return res.redirect(`/admin/shipment/${shipmentId}`);
    }
    
    shippingModel.updateStatus(shipmentId, status, location, description, (err) => {
        if (err) {
            console.error('Error updating shipment status:', err);
            req.flash('error', 'Error updating shipment status');
            return res.redirect(`/admin/shipment/${shipmentId}`);
        }
        
        req.flash('success', 'Shipment status updated successfully');
        res.redirect(`/admin/shipment/${shipmentId}`);
    });
}

/**
 * Admin: Update shipment details
 * POST /admin/shipment/:id/update
 */
function updateShipment(req, res) {
    const shipmentId = req.params.id;
    const updateData = {
        carrier: req.body.carrier,
        estimated_delivery: req.body.estimated_delivery,
        shipping_method: req.body.shipping_method,
        shipping_fee: req.body.shipping_fee,
        notes: req.body.notes
    };
    
    shippingModel.update(shipmentId, updateData, (err) => {
        if (err) {
            console.error('Error updating shipment:', err);
            req.flash('error', 'Error updating shipment details');
            return res.redirect(`/admin/shipment/${shipmentId}`);
        }
        
        req.flash('success', 'Shipment details updated successfully');
        res.redirect(`/admin/shipment/${shipmentId}`);
    });
}

/**
 * Customer: View own shipments
 * GET /my-shipments
 */
function listUserShipments(req, res) {
    const userId = req.session.user.id;
    
    // Get user's orders with shipments
    orderModel.getByUserId(userId, (err, orders) => {
        if (err) {
            console.error('Error fetching orders:', err);
            req.flash('error', 'Error loading shipments');
            return res.redirect('/orders');
        }
        
        // Get shipment for each order
        const orderIds = orders.map(o => o.id);
        if (orderIds.length === 0) {
            return res.render('myShipments', {
                user: req.session.user,
                shipments: [],
                messages: req.flash()
            });
        }
        
        const sql = `
            SELECT s.*, o.id as order_id, o.total as order_total
            FROM shipments s
            LEFT JOIN orders o ON s.order_id = o.id
            WHERE o.user_id = ?
            ORDER BY s.created_at DESC
        `;
        
        const db = require('../db');
        db.query(sql, [userId], (shipErr, shipments) => {
            if (shipErr) {
                console.error('Error fetching shipments:', shipErr);
                req.flash('error', 'Error loading shipments');
                return res.redirect('/orders');
            }
            
            res.render('myShipments', {
                user: req.session.user,
                shipments: shipments,
                messages: req.flash()
            });
        });
    });
}

// ========================================
// Export controller functions
// ========================================
module.exports = {
    trackShipment,
    listAllShipments,
    viewShipmentDetails,
    updateShipmentStatus,
    updateShipment,
    listUserShipments
};

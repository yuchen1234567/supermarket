// ========================================
// Order Item Controllers
// Handles CRUD operations for order_items table
// ========================================
const OrderItem = require('../models/orderItem');

/**
 * Get items for an order (JSON)
 */
function listByOrder(req, res) {
    const orderId = parseInt(req.params.orderId, 10);
    OrderItem.findByOrderId(orderId, (err, items) => {
        if (err) {
            console.error('Error fetching order items:', err);
            return res.status(500).json({ success: false, message: 'Error loading order items' });
        }
        res.json({ success: true, items: items || [] });
    });
}

/**
 * Admin: Update quantity for an order item
 */
function updateQuantity(req, res) {
    const itemId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (!quantity || quantity < 1) {
        req.flash('error', 'Quantity must be at least 1');
        return res.redirect('back');
    }

    OrderItem.updateQuantity(itemId, quantity, (err) => {
        if (err) {
            console.error('Error updating order item quantity:', err);
            req.flash('error', 'Failed to update item quantity');
        } else {
            req.flash('success', 'Item quantity updated');
        }
        res.redirect('back');
    });
}

/**
 * Admin: Delete an order item
 */
function deleteItem(req, res) {
    const itemId = parseInt(req.params.id, 10);

    OrderItem.delete(itemId, (err) => {
        if (err) {
            console.error('Error deleting order item:', err);
            req.flash('error', 'Failed to delete item');
        } else {
            req.flash('success', 'Item deleted');
        }
        res.redirect('back');
    });
}

module.exports = {
    listByOrder,
    updateQuantity,
    deleteItem
};

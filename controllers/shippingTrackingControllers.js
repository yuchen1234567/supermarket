// ========================================
// Shipping Tracking Controllers
// Handles tracking records for shipping_tracking table
// ========================================
const Tracking = require('../models/shippingTracking');

/**
 * Admin: Add a tracking update to a shipment
 */
function addTrackingUpdate(req, res) {
    const shipmentId = parseInt(req.params.id, 10);
    const { status, location, description } = req.body;

    if (!status) {
        req.flash('error', 'Status is required');
        return res.redirect(`/admin/shipment/${shipmentId}`);
    }

    Tracking.create({ shipment_id: shipmentId, status, location, description }, (err) => {
        if (err) {
            console.error('Error adding tracking update:', err);
            req.flash('error', 'Failed to add tracking update');
        } else {
            req.flash('success', 'Tracking update added');
        }
        res.redirect(`/admin/shipment/${shipmentId}`);
    });
}

/**
 * Get tracking history (JSON)
 */
function getTrackingHistory(req, res) {
    const shipmentId = parseInt(req.params.id, 10);

    Tracking.listByShipmentId(shipmentId, (err, records) => {
        if (err) {
            console.error('Error fetching tracking history:', err);
            return res.status(500).json({ success: false, message: 'Error fetching tracking' });
        }
        res.json({ success: true, tracking: records || [] });
    });
}

module.exports = {
    addTrackingUpdate,
    getTrackingHistory
};

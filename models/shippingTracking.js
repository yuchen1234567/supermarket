// ========================================
// Shipping Tracking Model
// Handles shipping_tracking table operations
// ========================================
const db = require('../db');

/**
 * Create a tracking record for a shipment
 */
function create(trackingData, callback) {
    const sql = `
        INSERT INTO shipping_tracking (shipment_id, status, location, description, timestamp)
        VALUES (?, ?, ?, ?, NOW())
    `;
    const params = [
        trackingData.shipment_id,
        trackingData.status,
        trackingData.location || null,
        trackingData.description || null
    ];
    db.query(sql, params, callback);
}

/**
 * List tracking history for a shipment
 */
function listByShipmentId(shipmentId, callback) {
    const sql = `
        SELECT * FROM shipping_tracking 
        WHERE shipment_id = ? 
        ORDER BY timestamp ASC
    `;
    db.query(sql, [shipmentId], callback);
}

/**
 * Delete tracking records for a shipment
 */
function deleteByShipmentId(shipmentId, callback) {
    const sql = 'DELETE FROM shipping_tracking WHERE shipment_id = ?';
    db.query(sql, [shipmentId], callback);
}

module.exports = {
    create,
    listByShipmentId,
    deleteByShipmentId
};

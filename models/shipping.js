// ========================================
// Shipping Model
// Handles database operations related to shipping and delivery
// ========================================
const db = require('../db');

/**
 * Create new shipment record for an order
 * @param {Object} shipmentData - Shipment data
 * @param {Function} callback - Callback function (err, result)
 */
function create(shipmentData, callback) {
    const sql = `
        INSERT INTO shipments (
            order_id, tracking_number, shipping_method, shipping_fee, carrier,
            recipient_name, phone, address_line1, address_line2, 
            city, state, postal_code, country, 
            status, estimated_delivery, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        shipmentData.order_id,
        shipmentData.tracking_number,
        shipmentData.shipping_method || 'standard',
        shipmentData.shipping_fee || 5.00,
        shipmentData.carrier || 'SingPost',
        shipmentData.recipient_name,
        shipmentData.phone,
        shipmentData.address_line1,
        shipmentData.address_line2 || null,
        shipmentData.city,
        shipmentData.state || null,
        shipmentData.postal_code,
        shipmentData.country || 'Singapore',
        shipmentData.status || 'pending',
        shipmentData.estimated_delivery,
        shipmentData.notes || null
    ];
    
    db.query(sql, params, (err, result) => {
        if (err) return callback(err);
        
        // Add initial tracking record
        if (result.insertId) {
            addTrackingRecord(result.insertId, {
                status: shipmentData.status || 'pending',
                location: 'FreshMart Warehouse',
                description: 'Order received and waiting for processing'
            }, (trackErr) => {
                if (trackErr) console.error('Error adding tracking record:', trackErr);
            });
        }
        
        callback(null, result);
    });
}

/**
 * Get shipment by order ID
 * @param {Number} orderId - Order ID
 * @param {Function} callback - Callback function (err, shipment)
 */
function getByOrderId(orderId, callback) {
    const sql = `
        SELECT * FROM shipments 
        WHERE order_id = ? 
        LIMIT 1
    `;
    
    db.query(sql, [orderId], (err, results) => {
        if (err) return callback(err);
        callback(null, results[0] || null);
    });
}

/**
 * Get shipment by tracking number
 * @param {String} trackingNumber - Tracking number
 * @param {Function} callback - Callback function (err, shipment)
 */
function getByTrackingNumber(trackingNumber, callback) {
    const sql = `
        SELECT s.*, o.user_id, o.total as order_total, o.status as order_status
        FROM shipments s
        LEFT JOIN orders o ON s.order_id = o.id
        WHERE s.tracking_number = ? 
        LIMIT 1
    `;
    
    db.query(sql, [trackingNumber], (err, results) => {
        if (err) return callback(err);
        callback(null, results[0] || null);
    });
}

/**
 * Get all shipments (admin)
 * @param {String} searchQuery - Search query (optional)
 * @param {Function} callback - Callback function (err, shipments)
 */
function getAll(searchQuery, callback) {
    // If only one argument provided, it's the callback
    if (typeof searchQuery === 'function') {
        callback = searchQuery;
        searchQuery = null;
    }
    
    let sql = `
        SELECT s.*, o.user_id, u.username, u.email, o.total as order_total
        FROM shipments s
        LEFT JOIN orders o ON s.order_id = o.id
        LEFT JOIN users u ON o.user_id = u.id
    `;
    
    const params = [];
    
    if (searchQuery && searchQuery.trim() !== '') {
        sql += `
            WHERE (
                s.tracking_number LIKE ? OR
                s.status LIKE ? OR
                s.recipient_name LIKE ? OR
                u.username LIKE ? OR
                o.id LIKE ?
            )
        `;
        const searchPattern = `%${searchQuery.trim()}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    sql += ` ORDER BY s.created_at DESC`;
    
    db.query(sql, params, callback);
}

/**
 * Update shipment status
 * @param {Number} shipmentId - Shipment ID
 * @param {String} status - New status
 * @param {String} location - Current location (optional)
 * @param {String} description - Status description (optional)
 * @param {Function} callback - Callback function (err, result)
 */
function updateStatus(shipmentId, status, location, description, callback) {
    const sql = 'UPDATE shipments SET status = ?, updated_at = NOW() WHERE id = ?';
    
    db.query(sql, [status, shipmentId], (err, result) => {
        if (err) return callback(err);
        
        // Add tracking record
        addTrackingRecord(shipmentId, {
            status: status,
            location: location || null,
            description: description || `Status updated to: ${status}`
        }, (trackErr) => {
            if (trackErr) console.error('Error adding tracking record:', trackErr);
        });
        
        // Update actual delivery time if status is 'delivered'
        if (status === 'delivered') {
            const updateDeliverySql = 'UPDATE shipments SET actual_delivery = NOW() WHERE id = ?';
            db.query(updateDeliverySql, [shipmentId], (deliveryErr) => {
                if (deliveryErr) console.error('Error updating delivery time:', deliveryErr);
            });
        }
        
        callback(null, result);
    });
}

/**
 * Update shipment details
 * @param {Number} shipmentId - Shipment ID
 * @param {Object} updateData - Data to update
 * @param {Function} callback - Callback function (err, result)
 */
function update(shipmentId, updateData, callback) {
    const fields = [];
    const params = [];
    
    if (updateData.carrier) {
        fields.push('carrier = ?');
        params.push(updateData.carrier);
    }
    if (updateData.estimated_delivery) {
        fields.push('estimated_delivery = ?');
        params.push(updateData.estimated_delivery);
    }
    if (updateData.notes !== undefined) {
        fields.push('notes = ?');
        params.push(updateData.notes);
    }
    if (updateData.shipping_method) {
        fields.push('shipping_method = ?');
        params.push(updateData.shipping_method);
    }
    if (updateData.shipping_fee !== undefined) {
        fields.push('shipping_fee = ?');
        params.push(updateData.shipping_fee);
    }
    
    if (fields.length === 0) {
        return callback(new Error('No fields to update'));
    }
    
    fields.push('updated_at = NOW()');
    params.push(shipmentId);
    
    const sql = `UPDATE shipments SET ${fields.join(', ')} WHERE id = ?`;
    
    db.query(sql, params, callback);
}

/**
 * Add tracking record to shipping_tracking table
 * @param {Number} shipmentId - Shipment ID
 * @param {Object} trackingData - Tracking data {status, location, description}
 * @param {Function} callback - Callback function (err, result)
 */
function addTrackingRecord(shipmentId, trackingData, callback) {
    const sql = `
        INSERT INTO shipping_tracking (shipment_id, status, location, description, timestamp)
        VALUES (?, ?, ?, ?, NOW())
    `;
    
    const params = [
        shipmentId,
        trackingData.status,
        trackingData.location || null,
        trackingData.description || null
    ];
    
    db.query(sql, params, callback);
}

/**
 * Get tracking history for a shipment
 * @param {Number} shipmentId - Shipment ID
 * @param {Function} callback - Callback function (err, trackingHistory)
 */
function getTrackingHistory(shipmentId, callback) {
    const sql = `
        SELECT * FROM shipping_tracking 
        WHERE shipment_id = ? 
        ORDER BY timestamp ASC
    `;
    
    db.query(sql, [shipmentId], callback);
}

/**
 * Generate unique tracking number
 * @param {Number} orderId - Order ID
 * @returns {String} Tracking number
 */
function generateTrackingNumber(orderId) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `FM${orderId.toString().padStart(8, '0')}${timestamp}${random}`;
}

/**
 * Get shipment with tracking history
 * @param {Number} shipmentId - Shipment ID
 * @param {Function} callback - Callback function (err, shipmentWithTracking)
 */
function getWithTracking(shipmentId, callback) {
    const sql = 'SELECT * FROM shipments WHERE id = ?';
    
    db.query(sql, [shipmentId], (err, results) => {
        if (err) return callback(err);
        if (!results || results.length === 0) return callback(null, null);
        
        const shipment = results[0];
        
        // Get tracking history
        getTrackingHistory(shipmentId, (trackErr, tracking) => {
            if (trackErr) return callback(trackErr);
            shipment.tracking = tracking || [];
            callback(null, shipment);
        });
    });
}

/**
 * Delete shipment
 * @param {Number} shipmentId - Shipment ID
 * @param {Function} callback - Callback function (err, result)
 */
function deleteById(shipmentId, callback) {
    // Tracking records will be deleted automatically due to CASCADE
    const sql = 'DELETE FROM shipments WHERE id = ?';
    db.query(sql, [shipmentId], callback);
}

// ========================================
// Export model methods
// ========================================
module.exports = {
    create,
    getByOrderId,
    getByTrackingNumber,
    getAll,
    updateStatus,
    update,
    addTrackingRecord,
    getTrackingHistory,
    getWithTracking,
    generateTrackingNumber,
    delete: deleteById
};

// ========================================
// Address Model
// Handles database operations related to user addresses
// ========================================
const db = require('../db');

/**
 * Create new address for user
 * @param {Object} addressData - Address data
 * @param {Function} callback - Callback function (err, result)
 */
function create(addressData, callback) {
    // If this is set as default, unset other default addresses first
    if (addressData.is_default) {
        const unsetDefaultSql = 'UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?';
        db.query(unsetDefaultSql, [addressData.user_id], (err) => {
            if (err) return callback(err);
            insertAddress(addressData, callback);
        });
    } else {
        insertAddress(addressData, callback);
    }
}

/**
 * Helper function to insert address
 */
function insertAddress(addressData, callback) {
    const sql = `
        INSERT INTO user_addresses (
            user_id, recipient_name, phone, 
            address_line1, address_line2, city, state, postal_code, country,
            is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        addressData.user_id,
        addressData.recipient_name,
        addressData.phone,
        addressData.address_line1,
        addressData.address_line2 || null,
        addressData.city,
        addressData.state || null,
        addressData.postal_code,
        addressData.country || 'Singapore',
        addressData.is_default || false
    ];
    
    db.query(sql, params, callback);
}

/**
 * Get all addresses for a user
 * @param {Number} userId - User ID
 * @param {Function} callback - Callback function (err, addresses)
 */
function getByUserId(userId, callback) {
    const sql = `
        SELECT * FROM user_addresses 
        WHERE user_id = ? 
        ORDER BY is_default DESC, created_at DESC
    `;
    
    db.query(sql, [userId], callback);
}

/**
 * Get address by ID
 * @param {Number} addressId - Address ID
 * @param {Function} callback - Callback function (err, address)
 */
function getById(addressId, callback) {
    const sql = 'SELECT * FROM user_addresses WHERE id = ? LIMIT 1';
    
    db.query(sql, [addressId], (err, results) => {
        if (err) return callback(err);
        callback(null, results[0] || null);
    });
}

/**
 * Get default address for user
 * @param {Number} userId - User ID
 * @param {Function} callback - Callback function (err, address)
 */
function getDefaultByUserId(userId, callback) {
    const sql = `
        SELECT * FROM user_addresses 
        WHERE user_id = ? AND is_default = TRUE 
        LIMIT 1
    `;
    
    db.query(sql, [userId], (err, results) => {
        if (err) return callback(err);
        
        // If no default found, get the first address
        if (!results || results.length === 0) {
            const fallbackSql = `
                SELECT * FROM user_addresses 
                WHERE user_id = ? 
                ORDER BY created_at DESC 
                LIMIT 1
            `;
            db.query(fallbackSql, [userId], (fallbackErr, fallbackResults) => {
                if (fallbackErr) return callback(fallbackErr);
                callback(null, fallbackResults[0] || null);
            });
        } else {
            callback(null, results[0]);
        }
    });
}

/**
 * Update address
 * @param {Number} addressId - Address ID
 * @param {Object} addressData - Address data to update
 * @param {Function} callback - Callback function (err, result)
 */
function update(addressId, addressData, callback) {
    // If setting as default, first get the user_id to unset other defaults
    if (addressData.is_default) {
        const getUserSql = 'SELECT user_id FROM user_addresses WHERE id = ?';
        db.query(getUserSql, [addressId], (err, results) => {
            if (err) return callback(err);
            if (!results || results.length === 0) return callback(new Error('Address not found'));
            
            const userId = results[0].user_id;
            const unsetDefaultSql = 'UPDATE user_addresses SET is_default = FALSE WHERE user_id = ? AND id != ?';
            db.query(unsetDefaultSql, [userId, addressId], (unsetErr) => {
                if (unsetErr) return callback(unsetErr);
                performUpdate(addressId, addressData, callback);
            });
        });
    } else {
        performUpdate(addressId, addressData, callback);
    }
}

/**
 * Helper function to perform update
 */
function performUpdate(addressId, addressData, callback) {
    const sql = `
        UPDATE user_addresses SET
            recipient_name = ?,
            phone = ?,
            address_line1 = ?,
            address_line2 = ?,
            city = ?,
            state = ?,
            postal_code = ?,
            country = ?,
            is_default = ?,
            updated_at = NOW()
        WHERE id = ?
    `;
    
    const params = [
        addressData.recipient_name,
        addressData.phone,
        addressData.address_line1,
        addressData.address_line2 || null,
        addressData.city,
        addressData.state || null,
        addressData.postal_code,
        addressData.country || 'Singapore',
        addressData.is_default || false,
        addressId
    ];
    
    db.query(sql, params, callback);
}

/**
 * Set address as default
 * @param {Number} addressId - Address ID
 * @param {Number} userId - User ID
 * @param {Function} callback - Callback function (err, result)
 */
function setDefault(addressId, userId, callback) {
    // First unset all defaults for this user
    const unsetSql = 'UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?';
    
    db.query(unsetSql, [userId], (err) => {
        if (err) return callback(err);
        
        // Then set this address as default
        const setSql = 'UPDATE user_addresses SET is_default = TRUE WHERE id = ? AND user_id = ?';
        db.query(setSql, [addressId, userId], callback);
    });
}

/**
 * Delete address
 * @param {Number} addressId - Address ID
 * @param {Number} userId - User ID (for security check)
 * @param {Function} callback - Callback function (err, result)
 */
function deleteById(addressId, userId, callback) {
    // Check if this is the default address
    const checkSql = 'SELECT is_default FROM user_addresses WHERE id = ? AND user_id = ?';
    
    db.query(checkSql, [addressId, userId], (err, results) => {
        if (err) return callback(err);
        if (!results || results.length === 0) return callback(new Error('Address not found'));
        
        const wasDefault = results[0].is_default;
        
        // Delete the address
        const deleteSql = 'DELETE FROM user_addresses WHERE id = ? AND user_id = ?';
        db.query(deleteSql, [addressId, userId], (deleteErr, deleteResult) => {
            if (deleteErr) return callback(deleteErr);
            
            // If it was default, set another address as default
            if (wasDefault) {
                const setNewDefaultSql = `
                    UPDATE user_addresses 
                    SET is_default = TRUE 
                    WHERE user_id = ? 
                    ORDER BY created_at DESC 
                    LIMIT 1
                `;
                db.query(setNewDefaultSql, [userId], (setErr) => {
                    if (setErr) console.error('Error setting new default:', setErr);
                    callback(null, deleteResult);
                });
            } else {
                callback(null, deleteResult);
            }
        });
    });
}

/**
 * Format address as string
 * @param {Object} address - Address object
 * @returns {String} Formatted address
 */
function formatAddress(address) {
    if (!address) return '';
    
    let formatted = address.address_line1;
    if (address.address_line2) formatted += ', ' + address.address_line2;
    formatted += ', ' + address.city;
    if (address.state) formatted += ', ' + address.state;
    formatted += ' ' + address.postal_code;
    formatted += ', ' + address.country;
    
    return formatted;
}

// ========================================
// Export model methods
// ========================================
module.exports = {
    create,
    getByUserId,
    getById,
    getDefaultByUserId,
    update,
    setDefault,
    delete: deleteById,
    formatAddress
};

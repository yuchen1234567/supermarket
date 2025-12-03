// ========================================
// Address Controllers
// Handle user address management business logic
// ========================================
const addressModel = require('../models/address');

/**
 * View all addresses for current user
 * GET /addresses
 */
function listAddresses(req, res) {
    const userId = req.session.user.id;
    
    addressModel.getByUserId(userId, (err, addresses) => {
        if (err) {
            console.error('Error fetching addresses:', err);
            req.flash('error', 'Error loading addresses');
            return res.redirect('/');
        }
        
        res.render('addresses', {
            user: req.session.user,
            addresses: addresses,
            messages: req.flash()
        });
    });
}

/**
 * Show add address form
 * GET /addresses/add
 */
function showAddForm(req, res) {
    res.render('addAddress', {
        user: req.session.user,
        messages: req.flash(),
        formData: req.flash('formData')[0] || {}
    });
}

/**
 * Create new address
 * POST /addresses/add
 */
function createAddress(req, res) {
    const addressData = {
        user_id: req.session.user.id,
        recipient_name: req.body.recipient_name,
        phone: req.body.phone,
        address_line1: req.body.address_line1,
        address_line2: req.body.address_line2,
        city: req.body.city,
        state: req.body.state,
        postal_code: req.body.postal_code,
        country: req.body.country || 'Singapore',
        is_default: req.body.is_default === 'on' || req.body.is_default === 'true'
    };
    
    // Validation
    if (!addressData.recipient_name || !addressData.phone || !addressData.address_line1 || 
        !addressData.city || !addressData.postal_code) {
        req.flash('error', 'Please fill in all required fields');
        req.flash('formData', req.body);
        return res.redirect('/addresses/add');
    }
    
    addressModel.create(addressData, (err) => {
        if (err) {
            console.error('Error creating address:', err);
            req.flash('error', 'Error saving address. Please try again.');
            req.flash('formData', req.body);
            return res.redirect('/addresses/add');
        }
        
        req.flash('success', 'Address added successfully');
        res.redirect('/addresses');
    });
}

/**
 * Show edit address form
 * GET /addresses/edit/:id
 */
function showEditForm(req, res) {
    const addressId = req.params.id;
    const userId = req.session.user.id;
    
    addressModel.getById(addressId, (err, address) => {
        if (err) {
            console.error('Error fetching address:', err);
            req.flash('error', 'Error loading address');
            return res.redirect('/addresses');
        }
        
        if (!address) {
            req.flash('error', 'Address not found');
            return res.redirect('/addresses');
        }
        
        // Check if address belongs to current user
        if (address.user_id !== userId) {
            req.flash('error', 'You do not have permission to edit this address');
            return res.redirect('/addresses');
        }
        
        res.render('editAddress', {
            user: req.session.user,
            address: address,
            messages: req.flash()
        });
    });
}

/**
 * Update address
 * POST /addresses/edit/:id
 */
function updateAddress(req, res) {
    const addressId = req.params.id;
    const userId = req.session.user.id;
    
    // First check if address belongs to user
    addressModel.getById(addressId, (getErr, existingAddress) => {
        if (getErr || !existingAddress) {
            req.flash('error', 'Address not found');
            return res.redirect('/addresses');
        }
        
        if (existingAddress.user_id !== userId) {
            req.flash('error', 'You do not have permission to edit this address');
            return res.redirect('/addresses');
        }
        
        const addressData = {
            recipient_name: req.body.recipient_name,
            phone: req.body.phone,
            address_line1: req.body.address_line1,
            address_line2: req.body.address_line2,
            city: req.body.city,
            state: req.body.state,
            postal_code: req.body.postal_code,
            country: req.body.country || 'Singapore',
            is_default: req.body.is_default === 'on' || req.body.is_default === 'true'
        };
        
        // Validation
        if (!addressData.recipient_name || !addressData.phone || !addressData.address_line1 || 
            !addressData.city || !addressData.postal_code) {
            req.flash('error', 'Please fill in all required fields');
            return res.redirect(`/addresses/edit/${addressId}`);
        }
        
        addressModel.update(addressId, addressData, (err) => {
            if (err) {
                console.error('Error updating address:', err);
                req.flash('error', 'Error updating address. Please try again.');
                return res.redirect(`/addresses/edit/${addressId}`);
            }
            
            req.flash('success', 'Address updated successfully');
            res.redirect('/addresses');
        });
    });
}

/**
 * Set address as default
 * POST /addresses/:id/set-default
 */
function setDefaultAddress(req, res) {
    const addressId = req.params.id;
    const userId = req.session.user.id;
    
    addressModel.setDefault(addressId, userId, (err) => {
        if (err) {
            console.error('Error setting default address:', err);
            req.flash('error', 'Error setting default address');
            return res.redirect('/addresses');
        }
        
        req.flash('success', 'Default address updated');
        res.redirect('/addresses');
    });
}

/**
 * Delete address
 * POST /addresses/delete/:id
 */
function deleteAddress(req, res) {
    const addressId = req.params.id;
    const userId = req.session.user.id;
    
    addressModel.delete(addressId, userId, (err) => {
        if (err) {
            console.error('Error deleting address:', err);
            req.flash('error', 'Error deleting address');
            return res.redirect('/addresses');
        }
        
        req.flash('success', 'Address deleted successfully');
        res.redirect('/addresses');
    });
}

/**
 * Select address for checkout (returns JSON for AJAX)
 * GET /addresses/:id/select
 */
function selectAddress(req, res) {
    const addressId = req.params.id;
    const userId = req.session.user.id;
    
    addressModel.getById(addressId, (err, address) => {
        if (err || !address) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }
        
        if (address.user_id !== userId) {
            return res.status(403).json({ success: false, message: 'Permission denied' });
        }
        
        res.json({ success: true, address: address });
    });
}

// ========================================
// Export controller functions
// ========================================
module.exports = {
    listAddresses,
    showAddForm,
    createAddress,
    showEditForm,
    updateAddress,
    setDefaultAddress,
    deleteAddress,
    selectAddress
};

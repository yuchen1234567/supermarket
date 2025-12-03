// ========================================
// Shipping and Delivery Feature Route Configuration
// Add the following code to app.js file
// ========================================

// ========================================
// Step 1: Import shipping and address controllers
// Add this at the top of the file, after the controllers import section
// ========================================
const shippingControllers = require('./controllers/shippingControllers');
const addressControllers = require('./controllers/addressControllers');


// ========================================
// Step 2: Address Management Routes (Customer)
// Add these routes after existing routes
// ========================================

// View all addresses
app.get('/addresses', checkAuthenticated, addressControllers.listAddresses);

// Add new address
app.get('/addresses/add', checkAuthenticated, addressControllers.showAddForm);
app.post('/addresses/add', checkAuthenticated, addressControllers.createAddress);

// Edit address
app.get('/addresses/edit/:id', checkAuthenticated, addressControllers.showEditForm);
app.post('/addresses/edit/:id', checkAuthenticated, addressControllers.updateAddress);

// Set default address
app.post('/addresses/:id/set-default', checkAuthenticated, addressControllers.setDefaultAddress);

// Delete address
app.post('/addresses/delete/:id', checkAuthenticated, addressControllers.deleteAddress);

// Select address (AJAX endpoint)
app.get('/addresses/:id/select', checkAuthenticated, addressControllers.selectAddress);


// ========================================
// Step 3: Shipping Routes (Customer)
// ========================================

// View own shipments
app.get('/my-shipments', checkAuthenticated, shippingControllers.listUserShipments);

// Track shipment by tracking number
app.get('/shipping/track/:trackingNumber', checkAuthenticated, shippingControllers.trackShipment);


// ========================================
// Step 4: Shipping Management Routes (Admin Only)
// ========================================

// View all shipments (admin)
app.get('/admin/shipments', checkAuthenticated, checkAdmin, shippingControllers.listAllShipments);

// View shipment details (admin)
app.get('/admin/shipment/:id', checkAuthenticated, checkAdmin, shippingControllers.viewShipmentDetails);

// Update shipment status (admin)
app.post('/admin/shipment/:id/status', checkAuthenticated, checkAdmin, shippingControllers.updateShipmentStatus);

// Update shipment details (admin)
app.post('/admin/shipment/:id/update', checkAuthenticated, checkAdmin, shippingControllers.updateShipment);


// ========================================
// Done!
// After adding these routes, restart the server to use shipping functionality
// ========================================

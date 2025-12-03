// ========================================
// Supermarket Management System - Main Application File
// ========================================

// Import required modules
require('dotenv').config();  // Load environment variables
const express = require('express');  // Express framework
const mysql = require('mysql2');  // MySQL database driver
const session = require('express-session');  // Session management
const flash = require('connect-flash');  // Flash messages (for displaying temporary notifications)
const multer = require('multer');  // File upload handling
const productController = require('./controllers/productControllers'); // Product controller (MVC pattern)
const { DEFAULT_CATEGORY_OPTIONS } = require('./utils/categoryOptions');
const db = require('./db');  // Database connection pool
const Wallet = require('./models/wallet'); // Wallet model for account balance management

// Import middleware
const { checkAuthenticated, checkAdmin, validateRegistration, validateLogin } = require('./middleware');

const app = express();  // Create Express application instance

// ========================================
// File Upload Configuration (Multer)
// ========================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Set file save directory to public/images
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);  // Save with original filename
    }
});

const upload = multer({ storage: storage });  // Create multer instance

// ========================================
// Database Connection Configuration
// ========================================
const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',  // Database host address
    user: process.env.DB_USER || 'root',  // Database username
    password: process.env.DB_PASSWORD || '',  // Database password
    database: process.env.DB_NAME || 'freshmart_db'  // Database name
});

// Connect to MySQL database
connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});


// ========================================
// Express Application Configuration
// ========================================
// Set view engine to EJS
app.set('view engine', 'ejs');

// Enable static file serving (CSS, JS, images, etc.)
app.use(express.static('public'));

// Enable form data parsing (for handling POST requests)
app.use(express.urlencoded({
    extended: false  // Use querystring library for parsing
}));

// ========================================
// Session and Flash Message Middleware
// ========================================
// Configure session middleware
app.use(session({
    secret: 'secret',  // Session encryption key
    resave: false,  // Don't force save unmodified sessions
    saveUninitialized: true,  // Save uninitialized sessions
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }  // Session validity: 7 days
}));

// Enable flash messages (for passing one-time messages between pages)
app.use(flash());

// ========================================
// Import Controllers
// ========================================

// Import cart, order and user controllers
const cartControllers = require('./controllers/cartControllers');
const orderControllers = require('./controllers/orderControllers');
const userControllers = require('./controllers/userControllers');

// Import shipping and address controllers
const shippingControllers = require('./controllers/shippingControllers');
const addressControllers = require('./controllers/addressControllers');

// Import wallet controllers
const walletControllers = require('./controllers/walletControllers');

// ========================================
// Route Definitions
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


// Default themes for known categories on the homepage
const DEFAULT_CATEGORY_THEMES = {
    'Fruits': { icon: '🍎', title: 'Orchard Fresh', subtitle: 'Fresh fruits', color: '#ef4444' },
    'Vegetables': { icon: '🥬', title: 'Garden Greens', subtitle: 'Vegetables', color: '#10b981' },
    'Dairy': { icon: '🥛', title: 'Dairy Corner', subtitle: 'Milk & eggs', color: '#3b82f6' },
    'Meat': { icon: '🥩', title: "Butcher's Choice", subtitle: 'Fresh meat', color: '#f59e0b' },
    'Bakery': { icon: '🍞', title: 'Fresh Bakes', subtitle: 'Bread & pastries', color: '#f97316' },
    'Beverages': { icon: '🥤', title: 'Thirst Quenchers', subtitle: 'Drinks & juices', color: '#8b5cf6' },
    'Snacks': { icon: '🍿', title: 'Munchies', subtitle: 'Snacks & treats', color: '#ec4899' }
};

// Home page route
app.get('/', (req, res) => {
    // Get all products, grouped by category
    const sql = 'SELECT * FROM products WHERE quantity > 0 ORDER BY category, id DESC';
    connection.query(sql, (err, products) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.render('index', {
                user: req.session.user,
                productsByCategory: {},
                categoryList: []
            });
        }

        const productsByCategory = {};

        products.forEach(product => {
            const category = product.category || 'Uncategorized';
            if (!productsByCategory[category]) {
                productsByCategory[category] = [];
            }

            if (productsByCategory[category].length < 4) {
                productsByCategory[category].push(product);
            }
        });

        const fallbackTheme = { icon: '🛒', subtitle: 'Top picks for today', color: '#2563eb' };
        const categoryList = Object.keys(productsByCategory)
            .sort((a, b) => a.localeCompare(b))
            .map((name, index) => {
                const sanitized = name.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                const anchorId = sanitized ? `${sanitized}-section` : `category-${index}`;
                const theme = DEFAULT_CATEGORY_THEMES[name] || {};

                return {
                    key: name,
                    icon: theme.icon || fallbackTheme.icon,
                    title: theme.title || name,
                    subtitle: theme.subtitle || fallbackTheme.subtitle,
                    color: theme.color || fallbackTheme.color,
                    anchorId
                };
            });

        res.render('index', {
            user: req.session.user,
            productsByCategory,
            categoryList
        });
    });
});

// ========================================
// Product Related Routes
// ========================================

// Inventory management page (admin only)
app.get('/inventory', checkAuthenticated, checkAdmin, productController.listAll);

// Shopping page (accessible to both regular users and admins)
app.get('/shopping', checkAuthenticated, productController.listAll);

// ========================================
// User Authentication Related Routes
// ========================================

// Display registration page
app.get('/register', (req, res) => {
    res.render('register', { 
        messages: req.flash('error'),  // Get error messages
        formData: req.flash('formData')[0]  // Get previously filled form data
    });
});

// Handle user registration
app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact, role } = req.body;

    // Check if email already exists
    const checkSql = 'SELECT id FROM users WHERE email = ?';
    connection.query(checkSql, [email], (checkErr, checkResults) => {
        if (checkErr) {
            console.error(checkErr);
            req.flash('error', 'System error, please try again.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }

        if (checkResults.length > 0) {
            req.flash('error', 'Email already registered');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }

        // Insert new user
        const insertSql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
        connection.query(
            insertSql,
            [username, email, password, address, contact, role],
            (insertErr, result) => {
                if (insertErr) {
                    console.error(insertErr);
                    req.flash('error', 'Error creating user, please try again.');
                    req.flash('formData', req.body);
                    return res.redirect('/register');
                }

                const newUserId = result.insertId;

                Wallet.create(newUserId, 0, (walletErr) => {
                    if (walletErr) {
                        console.error('Error initializing wallet for new user:', walletErr);
                        req.flash('error', 'Account created but wallet setup failed. Please contact support.');
                    } else {
                        req.flash('success', 'Registration successful! Please log in.');
                    }

                    return res.redirect('/login');
                });
            }
        );
    });
});

// Display login page
app.get('/login', (req, res) => {
    res.render('login', { 
        messages: req.flash('success'),  // Get success messages
        errors: req.flash('error')  // Get error messages
    });
});

// Handle user login
app.post('/login', validateLogin, (req, res) => {
    const { email, password } = req.body;

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error(err);
            req.flash('error', 'System error, please try again.');
            return res.redirect('/login');
        }

        if (results.length === 0) {
            // Login failed: invalid credentials
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/login');
        }

        const user = results[0];

        // Login successful
        req.session.user = user;  // Store user info in session
        req.flash('success', 'Login successful!');

        // Redirect to different pages based on user role
        if (req.session.user.role == 'user')
            res.redirect('/shopping');  // Regular user redirects to shopping page
        else
            res.redirect('/inventory');  // Admin redirects to inventory management page
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();  // Destroy session
    res.redirect('/');  // Redirect to home page
});


// ========================================
// Shopping Cart Related Routes
// ========================================

// Add product to cart
app.post('/add-to-cart/:id', checkAuthenticated, cartControllers.add);

// View cart
app.get('/cart', checkAuthenticated, cartControllers.list);

// Delete product from cart
app.get('/cart/remove/:productId', checkAuthenticated, cartControllers.delete);
app.post('/cart/delete/:productId', checkAuthenticated, cartControllers.delete);

// Update cart item quantity
app.post('/cart/update/:productId', checkAuthenticated, cartControllers.update);

// Clear cart
app.get('/cart/clear', checkAuthenticated, cartControllers.clearAll);

// ========================================
// Admin Dashboard Route
// ========================================

// Test dashboard route (for debugging)
app.get('/admin/test-dashboard', checkAuthenticated, checkAdmin, (req, res) => {
    const statsQuery = `
        SELECT 
            (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status = 'Completed') as totalRevenue,
            (SELECT COUNT(*) FROM orders WHERE status = 'Completed') as completedOrders,
            (SELECT COUNT(*) FROM orders WHERE status = 'Pending') as pendingOrders
    `;
    
    db.query(statsQuery, (err, statsResults) => {
        if (err) {
            console.error('Error fetching stats:', err);
            return res.status(500).send('Error loading test dashboard');
        }
        
        const stats = statsResults[0];
        
        const monthlyRevenueQuery = `
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COALESCE(SUM(total), 0) as revenue
            FROM orders
            WHERE status = 'Completed'
                AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month ASC
        `;
        
        db.query(monthlyRevenueQuery, (err, revenueResults) => {
            if (err) {
                console.error('Error fetching monthly revenue:', err);
                return res.status(500).send('Error loading test dashboard');
            }
            
            const months = [];
            const revenue = [];
            const now = new Date();
            
            for (let i = 5; i >= 0; i--) {
                const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthKey = date.toISOString().substr(0, 7);
                const monthName = date.toLocaleDateString('en-US', { month: 'short' });
                months.push(monthName);
                const found = revenueResults.find(r => r.month === monthKey);
                revenue.push(found ? parseFloat(found.revenue) : 0);
            }
            
            res.render('test-dashboard', {
                user: req.session.user,
                stats: stats,
                chartData: { months, revenue }
            });
        });
    });
});

// Admin dashboard with statistics
app.get('/admin/dashboard', checkAuthenticated, checkAdmin, (req, res) => {
    // Get statistics
    const statsQuery = `
        SELECT 
            (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status = 'Completed') as totalRevenue,
            (SELECT COUNT(*) FROM orders) as totalOrders,
            (SELECT COUNT(*) FROM orders WHERE status = 'Completed') as completedOrders,
            (SELECT COUNT(*) FROM orders WHERE status = 'Pending') as pendingOrders,
            (SELECT COUNT(*) FROM orders WHERE status = 'Processing') as processingOrders,
            (SELECT COUNT(*) FROM orders WHERE status = 'Cancelled') as cancelledOrders,
            (SELECT COUNT(*) FROM products) as totalProducts,
            (SELECT COUNT(*) FROM products WHERE quantity > 0) as inStockProducts,
            (SELECT COUNT(*) FROM products WHERE quantity = 0) as outOfStockProducts,
            (SELECT COUNT(*) FROM users WHERE role = 'user') as totalCustomers
    `;
    
    db.query(statsQuery, (err, statsResults) => {
        if (err) {
            console.error('Error fetching stats:', err);
            return res.status(500).send('Error loading dashboard');
        }
        
        const stats = statsResults[0];
        
        // Get monthly revenue for the past 6 months
        const monthlyRevenueQuery = `
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COALESCE(SUM(total), 0) as revenue
            FROM orders
            WHERE status = 'Completed'
                AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month ASC
        `;
        
        db.query(monthlyRevenueQuery, (err, revenueResults) => {
            if (err) {
                console.error('Error fetching monthly revenue:', err);
                return res.status(500).send('Error loading dashboard');
            }
            
            // Process chart data
            const months = [];
            const revenue = [];
            
            // Get last 6 months
            const now = new Date();
            for (let i = 5; i >= 0; i--) {
                const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthKey = date.toISOString().substr(0, 7);
                const monthName = date.toLocaleDateString('en-US', { month: 'short' });
                
                months.push(monthName);
                
                const found = revenueResults.find(r => r.month === monthKey);
                revenue.push(found ? parseFloat(found.revenue) : 0);
            }
            
            const chartData = { months, revenue };
            
            // Get recent orders
            const recentOrdersQuery = `
                SELECT o.id, o.total, o.created_at, u.username
                FROM orders o
                JOIN users u ON o.user_id = u.id
                ORDER BY o.created_at DESC
                LIMIT 10
            `;
            
            db.query(recentOrdersQuery, (err, recentOrders) => {
                if (err) {
                    console.error('Error fetching recent orders:', err);
                    return res.status(500).send('Error loading dashboard');
                }
                
                // Get top selling products
                const topProductsQuery = `
                    SELECT p.productName as name, SUM(oi.quantity) as sales
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.id
                    JOIN orders o ON oi.order_id = o.id
                    WHERE o.status = 'Completed'
                    GROUP BY p.id, p.productName
                    ORDER BY sales DESC
                    LIMIT 5
                `;
                
                db.query(topProductsQuery, (err, topProductsResults) => {
                    if (err) {
                        console.error('Error fetching top products:', err);
                        // Continue with empty data if query fails
                        topProductsResults = [{name: 'No data', sales: 0}];
                    }
                    
                    const topProducts = topProductsResults.length > 0 ? topProductsResults : [{name: 'No data', sales: 0}];
                    
                    res.render('adminDashboard', {
                        user: req.session.user,
                        stats: stats,
                        chartData: chartData,
                        recentOrders: recentOrders,
                        topProducts: topProducts
                    });
                });
            });
        });
    });
});

// ========================================
// Order Related Routes
// ========================================

// Show checkout page
app.get('/checkout', checkAuthenticated, orderControllers.showCheckout);

// Checkout (create order)
app.post('/checkout', checkAuthenticated, orderControllers.checkout);

// View user's own order list
app.get('/orders', checkAuthenticated, orderControllers.listUserOrders);

// View order details
app.get('/order/:id', checkAuthenticated, orderControllers.viewOrder);

// Print order invoice
app.get('/order/:id/print', checkAuthenticated, orderControllers.printOrder);

// Download order as PDF
app.get('/order/:id/pdf', checkAuthenticated, orderControllers.downloadPDF);

// Admin view all orders
app.get('/admin/orders', checkAuthenticated, checkAdmin, orderControllers.listAllOrders);

// Admin update order status
app.post('/admin/order/:id/status', checkAuthenticated, checkAdmin, orderControllers.updateStatus);

// Admin delete order
app.get('/admin/order/:id/delete', checkAuthenticated, checkAdmin, orderControllers.deleteOrder);

// ========================================
// User Management Routes (Admin only)
// ========================================

// View all users (admin only)
app.get('/admin/users', checkAuthenticated, checkAdmin, userControllers.listAll);

// Display create admin form (admin only)
app.get('/admin/users/create', checkAuthenticated, checkAdmin, userControllers.showCreateAdminForm);

// Create new admin user (admin only)
// Create admin user - verified status can be 1 or 0 based on design
app.post('/admin/users/create', checkAuthenticated, checkAdmin, userControllers.createAdmin);

// Display edit user form (admin only)
app.get('/admin/users/edit/:id', checkAuthenticated, checkAdmin, userControllers.showEditForm);

// Update user (admin only)
app.post('/admin/users/edit/:id', checkAuthenticated, checkAdmin, userControllers.update);

// Delete user (admin only)
app.get('/admin/users/delete/:id', checkAuthenticated, checkAdmin, userControllers.delete);

// ========================================
// Product Related Routes
// ========================================

// View product details by ID
app.get('/product/:id', checkAuthenticated, productController.getById);

// Display add product form (admin only)
app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { 
        user: req.session.user,
        messages: req.flash(),  // Get all flash messages
        categories: DEFAULT_CATEGORY_OPTIONS
    });
});

// Add product (admin only, supports image upload)
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.add);

// Display update product form (admin only)
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.showUpdateForm);

// Update product (admin only, supports image upload)
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.update);

// Delete product (admin only)
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.delete);

// ========================================
// Shipping & Address Routes
// ========================================

// Customer: Track shipment by tracking number
app.get('/shipping/track/:trackingNumber', checkAuthenticated, shippingControllers.trackShipment);

// Customer: View own shipments
app.get('/my-shipments', checkAuthenticated, shippingControllers.listUserShipments);

// Admin: View all shipments
app.get('/admin/shipments', checkAuthenticated, checkAdmin, shippingControllers.listAllShipments);

// Admin: View shipment details
app.get('/admin/shipment/:id', checkAuthenticated, checkAdmin, shippingControllers.viewShipmentDetails);

// Admin: Update shipment status
app.post('/admin/shipment/:id/status', checkAuthenticated, checkAdmin, shippingControllers.updateShipmentStatus);

// Address management routes
app.get('/addresses', checkAuthenticated, addressControllers.listAddresses);
app.get('/addresses/add', checkAuthenticated, addressControllers.showAddForm);
app.post('/addresses/add', checkAuthenticated, addressControllers.createAddress);
app.get('/addresses/edit/:id', checkAuthenticated, addressControllers.showEditForm);
app.post('/addresses/edit/:id', checkAuthenticated, addressControllers.updateAddress);
app.post('/addresses/:id/set-default', checkAuthenticated, addressControllers.setDefaultAddress);
app.post('/addresses/delete/:id', checkAuthenticated, addressControllers.deleteAddress);

// ========================================
// Wallet & Refund Routes
// ========================================

// Wallet management
app.get('/wallet', checkAuthenticated, walletControllers.viewWallet);
app.post('/wallet/recharge', checkAuthenticated, walletControllers.recharge);
app.get('/wallet/transactions', checkAuthenticated, walletControllers.viewTransactions);

// Refund management
app.post('/order/:orderId/request-refund', checkAuthenticated, walletControllers.requestRefund);
app.get('/wallet/refunds', checkAuthenticated, walletControllers.viewMyRefunds);
app.post('/order/:orderId/confirm-delivery', checkAuthenticated, walletControllers.confirmDelivery);

// Admin: Refund management
app.get('/admin/refunds', checkAuthenticated, checkAdmin, walletControllers.viewAllRefunds);
app.get('/admin/refund/:id', checkAuthenticated, checkAdmin, walletControllers.viewRefundDetails);
app.post('/admin/refund/:id/process', checkAuthenticated, checkAdmin, walletControllers.processRefund);

// ========================================
// Start Server
// ========================================
const PORT = process.env.PORT || 3000;  // Get port from environment variable, default to 3000
app.listen(PORT, () => console.log(`Server running on URL address: http://localhost:${PORT}/`));

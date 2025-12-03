// ========================================
// Middleware Functions
// Contains authentication, authorization and validation middleware
// All user verification now queries database in real-time for data consistency
// ========================================

const db = require('./db');  // Import database connection

/**
 * Check if user is logged in and still exists in database
 * Verifies user status in real-time from database
 * If user is deleted or session invalid, redirect to login page
 */
const checkAuthenticated = (req, res, next) => {
    // Check if session has user ID
    if (!req.session.user || !req.session.user.id) {
        req.flash('error', 'Please log in to view this resource');
        return res.redirect('/login');
    }

    // Query database to verify user still exists and get latest info
    const sql = 'SELECT id, username, email, address, contact, role FROM users WHERE id = ?';
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) {
            console.error('Database error in checkAuthenticated:', err);
            req.flash('error', 'System error, please try again');
            return res.redirect('/login');
        }

        // User not found in database (deleted or invalid)
        if (!results || results.length === 0) {
            req.session.destroy();  // Clear invalid session
            req.flash('error', 'Your account no longer exists. Please contact administrator.');
            return res.redirect('/login');
        }

        // Update session with latest user data from database
        req.session.user = results[0];
        next();  // User verified, continue execution
    });
};

/**
 * Check if user is an administrator
 * Verifies admin role in real-time from database
 * If user role changed or access denied, redirect appropriately
 */
const checkAdmin = (req, res, next) => {
    // First check if user is logged in
    if (!req.session.user || !req.session.user.id) {
        req.flash('error', 'Please log in to view this resource');
        return res.redirect('/login');
    }

    // Query database to verify user is still admin
    const sql = 'SELECT id, username, email, role FROM users WHERE id = ? AND role = ?';
    db.query(sql, [req.session.user.id, 'admin'], (err, results) => {
        if (err) {
            console.error('Database error in checkAdmin:', err);
            req.flash('error', 'System error, please try again');
            return res.redirect('/login');
        }

        // User not found or no longer admin
        if (!results || results.length === 0) {
            // Check if user still exists but role changed
            const checkUserSql = 'SELECT role FROM users WHERE id = ?';
            db.query(checkUserSql, [req.session.user.id], (err2, userResults) => {
                if (err2 || !userResults || userResults.length === 0) {
                    // User deleted
                    req.session.destroy();
                    req.flash('error', 'Your account no longer exists');
                    return res.redirect('/login');
                } else {
                    // User exists but role changed
                    req.session.user.role = userResults[0].role;  // Update session
                    req.flash('error', 'Access denied. You no longer have administrator privileges.');
                    return res.redirect('/shopping');
                }
            });
        } else {
            // User is admin, update session with latest data and continue
            req.session.user = results[0];
            next();
        }
    });
};

/**
 * Registration form validation middleware
 * Validates user registration data submission
 */
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;

    // Check if all fields are filled
    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }

    // Validate password length: must be at least 6 characters
    if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters long');
        req.flash('formData', req.body);  // Save form data for redisplay
        return res.redirect('/register');
    }

    // Validate contact number length: must be exactly 8 digits
    if (contact.length !== 8) {
        req.flash('error', 'Contact number must be exactly 8 digits');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Validate contact number format: must contain only digits
    if (!/^\d{8}$/.test(contact)) {
        req.flash('error', 'Contact number must contain only digits');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    next();  // Validation passed, continue execution
};

/**
 * Login form validation middleware
 * Validates user login data submission
 */
const validateLogin = (req, res, next) => {
    const { email, password } = req.body;

    // Validate if email and password are filled
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    next();  // Validation passed, continue execution
};

module.exports = {
    checkAuthenticated,
    checkAdmin,
    validateRegistration,
    validateLogin
};

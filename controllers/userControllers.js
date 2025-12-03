// ========================================
// User Controller
// Handles all user-related business logic and page rendering
// ========================================
const db = require('../db');  // Database connection

const usersController = {
  /**
   * Display user management page (Admin only)
   * Shows all users in the system
   */
  listAll: (req, res) => {
    const sql = 'SELECT id, username, email, address, contact, role FROM users ORDER BY id DESC';
    
    db.query(sql, (err, results) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.render('users', {
          user: req.session.user,
          users: [],
          messages: req.flash(),
          error: 'Error loading users'
        });
      }
      
      res.render('users', {
        user: req.session.user,
        users: results,
        messages: req.flash(),
        error: null
      });
    });
  },

  /**
   * Display create admin user form
   */
  showCreateAdminForm: (req, res) => {
    res.render('createAdmin', {
      user: req.session.user,
      messages: req.flash()
    });
  },

  /**
   * Create new admin user (Admin only)
   */
  createAdmin: (req, res) => {
    const { username, email, password, address, contact } = req.body;

    // Validate all fields
    if (!username || !email || !password || !address || !contact) {
      req.flash('error', 'All fields are required');
      return res.redirect('/admin/users/create');
    }

    // Validate password length
    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters long');
      return res.redirect('/admin/users/create');
    }

    // Validate contact number
    if (!/^\d{8}$/.test(contact)) {
      req.flash('error', 'Contact number must be exactly 8 digits');
      return res.redirect('/admin/users/create');
    }

    // Insert new admin user into database
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    
    db.query(sql, [username, email, password, address, contact, 'admin'], (err, result) => {
      if (err) {
        console.error('Error creating admin:', err);
        if (err.code === 'ER_DUP_ENTRY') {
          req.flash('error', 'Email already exists');
        } else {
          req.flash('error', 'Error creating admin user');
        }
        return res.redirect('/admin/users/create');
      }

      req.flash('success', 'Admin user created successfully!');
      res.redirect('/admin/users');
    });
  },

  /**
   * Display edit user form
   */
  showEditForm: (req, res) => {
    const { id } = req.params;
    const sql = 'SELECT id, username, email, address, contact, role FROM users WHERE id = ?';
    
    db.query(sql, [id], (err, results) => {
      if (err || results.length === 0) {
        req.flash('error', 'User not found');
        return res.redirect('/admin/users');
      }

      res.render('editUser', {
        user: req.session.user,
        editUser: results[0],
        messages: req.flash()
      });
    });
  },

  /**
   * Update user information (Admin only)
   */
  update: (req, res) => {
    const { id } = req.params;
    const { username, email, address, contact, role } = req.body;

    // Validate fields
    if (!username || !email || !address || !contact || !role) {
      req.flash('error', 'All fields are required');
      return res.redirect(`/admin/users/edit/${id}`);
    }

    // Validate contact number
    if (!/^\d{8}$/.test(contact)) {
      req.flash('error', 'Contact number must be exactly 8 digits');
      return res.redirect(`/admin/users/edit/${id}`);
    }

    const sql = 'UPDATE users SET username = ?, email = ?, address = ?, contact = ?, role = ? WHERE id = ?';
    
    db.query(sql, [username, email, address, contact, role, id], (err, result) => {
      if (err) {
        console.error('Error updating user:', err);
        req.flash('error', 'Error updating user');
        return res.redirect(`/admin/users/edit/${id}`);
      }

      req.flash('success', 'User updated successfully!');
      res.redirect('/admin/users');
    });
  },

  /**
   * Delete user (Admin only)
   */
  delete: (req, res) => {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (parseInt(id) === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/admin/users');
    }

    const sql = 'DELETE FROM users WHERE id = ?';
    
    db.query(sql, [id], (err, result) => {
      if (err) {
        console.error('Error deleting user:', err);
        req.flash('error', 'Error deleting user');
        return res.redirect('/admin/users');
      }

      if (result.affectedRows === 0) {
        req.flash('error', 'User not found');
      } else {
        req.flash('success', 'User deleted successfully!');
      }
      
      res.redirect('/admin/users');
    });
  }
};

// Export user controller
module.exports = usersController;
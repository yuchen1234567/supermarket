// ========================================
// Cart Controller
// Handles all shopping cart-related business logic
// Now uses database storage for data persistence
// ========================================
const cartModel = require('../models/cart');  // Cart model
const db = require('../db');                  // Database connection

const cartController = {
  /**
   * Display shopping cart
   * Get current user's cart contents from database and render page
   */
  list(req, res) {
    const userId = req.session.user.id;
    
    // Get cart data from database
    cartModel.getCart(userId, (err, cartItems) => {
      if (err) {
        console.error('Error loading cart:', err);
        return res.render('cart', {
          cart: [],
          user: req.session.user,
          messages: req.flash(),
          error: 'Error loading cart'
        });
      }

      res.render('cart', {
        cart: cartItems,
        user: req.session.user,
        messages: req.flash()
      });
    });
  },

  /**
   * Add product to cart (database)
   * Validate stock + current quantity in cart, then add product
   */
  add(req, res) {
    const userId = req.session.user.id;
    const productId = parseInt(req.params.id, 10);          // Get product ID from URL
    let quantity = parseInt(req.body.quantity, 10) || 1;    // Get quantity, default to 1

    // Prevent weird values
    if (quantity < 1) quantity = 1;

    // Query product information from DB
    db.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
      if (error) {
        console.error('Error fetching product:', error);
        req.flash('error', 'Failed to add product to cart');
        return res.redirect('/shopping');
      }

      // Check if product exists
      if (results.length === 0) {
        req.flash('error', 'Product not found');
        return res.redirect('/shopping');
      }

      const product = results[0];

      // Check current quantity in cart from database
      db.query('SELECT quantity FROM cart WHERE users_id = ? AND products_id = ?', 
        [userId, productId], (err, cartResults) => {
        if (err) {
          console.error('Error checking cart:', err);
          req.flash('error', 'Failed to add product to cart');
          return res.redirect('/shopping');
        }

        const currentQtyInCart = cartResults.length > 0 ? cartResults[0].quantity : 0;

        // ✅ Total quantity (existing + new) cannot exceed stock
        const newTotalQty = currentQtyInCart + quantity;
        if (newTotalQty > product.quantity) {
          req.flash(
            'error',
            `Only ${product.quantity} item(s) in stock. You already have ${currentQtyInCart} in your cart.`
          );
          return res.redirect('/shopping');
        }

        // Safe to add to database
        cartModel.addItem(userId, productId, quantity, (err) => {
          if (err) {
            console.error('Error adding to cart:', err);
            req.flash('error', 'Failed to add product to cart');
            return res.redirect('/shopping');
          }
          req.flash('success', 'Product added to cart');
          return res.redirect('/cart');  // Redirect to cart page
        });
      });
    });
  },

  /**
   * Delete product from cart (database)
   * Remove specified product item
   */
  delete(req, res) {
    const userId = req.session.user.id;
    const productId = parseInt(req.params.productId, 10);  // Get product ID from URL
    
    cartModel.removeItem(userId, productId, (err) => {
      if (err) {
        console.error('Error removing from cart:', err);
        req.flash('error', 'Failed to remove product from cart');
      } else {
        req.flash('success', 'Product removed from cart');
      }
      res.redirect('/cart');                                 // Return to cart page
    });
  },

  /**
   * Update product quantity in cart (database)
   * Support + / - buttons and manual quantity update
   * Always check against product stock in DB
   */
  update(req, res) {
    const userId = req.session.user.id;
    const productId = parseInt(req.params.productId, 10);   // Get product ID from URL
    const action = req.body.action;                         // 'increase' / 'decrease' / undefined
    const inputQty = parseInt(req.body.quantity, 10);       // Quantity from input box

    // Get current cart item from database
    db.query('SELECT quantity FROM cart WHERE users_id = ? AND products_id = ?', 
      [userId, productId], (err, cartResults) => {
      if (err || cartResults.length === 0) {
        req.flash('error', 'Item not found in cart');
        return res.redirect('/cart');
      }

      const currentQty = cartResults[0].quantity;

      // Get latest stock from DB
      db.query('SELECT quantity FROM products WHERE id = ?', [productId], (err, results) => {
        if (err) {
          console.error('Error fetching stock for update:', err);
          req.flash('error', 'Failed to update cart');
          return res.redirect('/cart');
        }

        if (results.length === 0) {
          req.flash('error', 'Product no longer exists');
          return res.redirect('/cart');
        }

        const stock = results[0].quantity;
        let newQty = currentQty;

        // Decide new quantity based on user action
        if (action === 'increase') {
          newQty = currentQty + 1;
        } else if (action === 'decrease') {
          newQty = Math.max(1, currentQty - 1);  // Minimum 1
        } else {
          // "Update" button: use value in input box
          if (!isNaN(inputQty) && inputQty >= 1) {
            newQty = inputQty;
          }
        }

        // ✅ Enforce stock limit
        if (newQty > stock) {
          newQty = stock;  // Clamp to stock
          req.flash('error', `Only ${stock} item(s) left in stock. Quantity has been adjusted.`);
        } else {
          req.flash('success', 'Cart updated');
        }

        // Update quantity in database
        cartModel.updateQuantity(userId, productId, newQty, (err) => {
          if (err) {
            console.error('Error updating cart:', err);
            req.flash('error', 'Failed to update cart');
          }
          return res.redirect('/cart');
        });
      });
    });
  },

  /**
   * Clear all items from cart (database)
   * Remove all products from user's cart
   */
  clearAll(req, res) {
    const userId = req.session.user.id;
    
    cartModel.clearCart(userId, (err) => {
      if (err) {
        console.error('Error clearing cart:', err);
        req.flash('error', 'Failed to clear cart');
      } else {
        req.flash('success', 'Cart cleared successfully');
      }
      res.redirect('/cart');
    });
  }
};

// Export cart controller
module.exports = cartController;

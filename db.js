// ========================================
// Database Connection Configuration File
// Uses MySQL2 library to connect to MySQL database
// Configuration info read from .env environment variables file
// ========================================

const mysql = require('mysql2');  // Import MySQL2 module
require('dotenv').config();  // Load environment variables from .env file

// ========================================
// Create Database Connection Pool (Better for production)
// Connection pool handles multiple concurrent connections
// ========================================
const pool = mysql.createPool({
    host: process.env.DB_HOST,          // Database host address
    user: process.env.DB_USER,          // Database username
    password: process.env.DB_PASSWORD,  // Database password
    database: process.env.DB_NAME,      // Database name
    waitForConnections: true,           // Wait when no connections available
    connectionLimit: 10,                // Maximum number of connections
    queueLimit: 0                       // No limit on queued requests
});

// Test connection
pool.getConnection((err, connection) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
    connection.release();  // Release connection back to pool
});

// Export database connection pool for use by other modules
// Use pool.query() for queries - it automatically handles connections
module.exports = pool;

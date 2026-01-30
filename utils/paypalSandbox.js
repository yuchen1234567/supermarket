const https = require('https');
const db = require('../db');

let cachedAccessToken = null;
let cachedAccessTokenExpiresAtMs = 0;

function formatMoney(amount) {
    const num = Number(amount);
    if (!Number.isFinite(num)) return null;
    return num.toFixed(2);
}

function getConfig(req) {
    const apiBase = (process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com').trim();
    const clientId = (process.env.PAYPAL_CLIENT_ID || '').trim();
    const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
    const brandName = (process.env.PAYPAL_BRAND_NAME || 'FreshMart').trim();

    const appBaseUrl = `${req.protocol}://${req.get('host')}`;
    return { apiBase, clientId, clientSecret, brandName, appBaseUrl };
}

function assertConfig(config) {
    if (!config.apiBase) return 'Missing PAYPAL_API_BASE in .env';
    if (!config.clientId) return 'Missing PAYPAL_CLIENT_ID in .env';
    if (!config.clientSecret) return 'Missing PAYPAL_CLIENT_SECRET in .env';
    return null;
}

function parseTransactionId(outTradeNo) {
    const m = (outTradeNo || '').toString().trim().match(/^TXN_(\d+)$/);
    if (!m) return null;
    return Number(m[1]);
}

function getVipPlanId() {
    // Get PayPal plan id for VIP subscription
    return (process.env.PAYPAL_VIP_PLAN_ID || '').trim();
}

function normalizeCurrency(code) {
    const s = (code || '').toString().trim().toUpperCase();
    if (!s) return 'USD';
    if (!/^[A-Z]{3}$/.test(s)) return 'USD';
    return s;
}

function normalizeIntervalUnit(unit) {
    const s = (unit || '').toString().trim().toUpperCase();
    if (s === 'DAY' || s === 'WEEK' || s === 'MONTH' || s === 'YEAR') return s;
    return 'MONTH';
}

function normalizeIntervalCount(count) {
    const n = Number.parseInt((count || '').toString().trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(n, 365);
}

function normalizePlanPrice(price) {
    const num = Number(price);
    if (!Number.isFinite(num) || num <= 0) return null;
    return formatMoney(num);
}

function safeJson(res, statusCode, payload) {
    if (!res || res.headersSent || res.writableEnded) return;
    res.status(statusCode).json(payload);
}

function httpsRequestJson(method, urlStr, headers, body) {
    const url = new URL(urlStr);
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method,
                headers
            },
            (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (raw += chunk));
                res.on('end', () => {
                    const ok = res.statusCode >= 200 && res.statusCode < 300;
                    if (!ok) {
                        return reject(new Error(`PayPal HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
                    }
                    try {
                        resolve(raw ? JSON.parse(raw) : {});
                    } catch (e) {
                        reject(new Error(`Invalid PayPal JSON: ${raw.slice(0, 300)}`));
                    }
                });
            }
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getAccessToken(config) {
    const now = Date.now();
    if (cachedAccessToken && now < cachedAccessTokenExpiresAtMs - 15 * 1000) {
        return cachedAccessToken;
    }

    const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64');
    const body = 'grant_type=client_credentials';

    const data = await httpsRequestJson(
        'POST',
        `${config.apiBase}/v1/oauth2/token`,
        {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );

    if (!data || !data.access_token) {
        throw new Error('PayPal token response missing access_token');
    }

    cachedAccessToken = data.access_token;
    const expiresInSec = Number(data.expires_in) || 0;
    cachedAccessTokenExpiresAtMs = Date.now() + expiresInSec * 1000;
    return cachedAccessToken;
}

// Create PayPal product for subscription plan
async function createVipProductRemote(config, opts) {
    const token = await getAccessToken(config);
    const name = (opts && opts.name ? String(opts.name) : 'VIP Membership').trim() || 'VIP Membership';
    const description = (opts && opts.description ? String(opts.description) : 'VIP subscription product').trim() || 'VIP subscription product';

    const bodyObj = {
        name,
        description,
        type: 'SERVICE',
        category: 'SOFTWARE'
    };

    const body = JSON.stringify(bodyObj);
    const data = await httpsRequestJson(
        'POST',
        `${config.apiBase}/v1/catalogs/products`,
        {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );

    const productId = data && data.id ? String(data.id) : null;
    if (!productId) throw new Error('PayPal product response missing id');
    return { productId, raw: data };
}

// Create PayPal subscription plan
async function createVipPlanRemote(config, opts) {
    const token = await getAccessToken(config);
    const productId = (opts && opts.productId ? String(opts.productId) : '').trim();
    if (!productId) throw new Error('Missing product_id');

    const name = (opts && opts.name ? String(opts.name) : 'VIP Monthly Plan').trim() || 'VIP Monthly Plan';
    const description = (opts && opts.description ? String(opts.description) : 'VIP subscription plan').trim() || 'VIP subscription plan';
    const currency = normalizeCurrency(opts && opts.currency ? String(opts.currency) : 'USD');
    const value = normalizePlanPrice(opts && opts.price !== undefined ? opts.price : '9.99');
    if (!value) throw new Error('Invalid price');

    const intervalUnit = normalizeIntervalUnit(opts && opts.intervalUnit ? String(opts.intervalUnit) : 'MONTH');
    const intervalCount = normalizeIntervalCount(opts && opts.intervalCount !== undefined ? opts.intervalCount : 1);

    const bodyObj = {
        product_id: productId,
        name,
        description,
        status: 'ACTIVE',
        billing_cycles: [
            {
                frequency: { interval_unit: intervalUnit, interval_count: intervalCount },
                tenure_type: 'REGULAR',
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: {
                    fixed_price: {
                        currency_code: currency,
                        value
                    }
                }
            }
        ],
        payment_preferences: {
            auto_bill_outstanding: true,
            setup_fee_failure_action: 'CONTINUE',
            payment_failure_threshold: 1
        }
    };

    const body = JSON.stringify(bodyObj);
    const data = await httpsRequestJson(
        'POST',
        `${config.apiBase}/v1/billing/plans`,
        {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );

    const planId = data && data.id ? String(data.id) : null;
    if (!planId) throw new Error('PayPal plan response missing id');
    return { planId, raw: data };
}

// Admin API: create VIP plan (and product if needed)
async function handleCreateVipPlan(req, res) {
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return safeJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Invalid PayPal configuration' });
    }
    const configError = assertConfig(config);
    if (configError) return safeJson(res, 500, { ok: false, error: configError });

    const productIdFromReq = (req.body.product_id || '').toString().trim();
    const productName = (req.body.product_name || '').toString().trim();
    const productDesc = (req.body.product_description || '').toString().trim();

    const planName = (req.body.plan_name || '').toString().trim();
    const planDesc = (req.body.plan_description || '').toString().trim();
    const currency = normalizeCurrency(req.body.currency || 'USD');
    const price = normalizePlanPrice(req.body.price || '9.99');
    const intervalUnit = normalizeIntervalUnit(req.body.interval_unit || 'MONTH');
    const intervalCount = normalizeIntervalCount(req.body.interval_count || 1);

    if (!price) return safeJson(res, 400, { ok: false, error: 'Invalid price' });

    try {
        let productId = productIdFromReq;
        if (!productId) {
            const createdProduct = await createVipProductRemote(config, {
                name: productName || 'VIP Membership',
                description: productDesc || 'VIP subscription product'
            });
            productId = createdProduct.productId;
        }

        const createdPlan = await createVipPlanRemote(config, {
            productId,
            name: planName || 'VIP Monthly Plan',
            description: planDesc || 'VIP subscription plan',
            currency,
            price,
            intervalUnit,
            intervalCount
        });

        return safeJson(res, 200, {
            ok: true,
            apiBase: config.apiBase,
            product_id: productId,
            plan_id: createdPlan.planId
        });
    } catch (e) {
        return safeJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Failed to create PayPal plan' });
    }
}

function renderVipProductTestPageInternal(req, res, model) {
    const payload = model || {};
    res.render('adminPayPalVipProductTest', {
        user: req.session.user,
        form: payload.form || {},
        result: payload.result || null,
        error: payload.error || null
    });
}

function renderVipProductTestPage(req, res) {
    return renderVipProductTestPageInternal(req, res, {});
}

// Admin test page: create PayPal product
async function handleVipProductTestCreate(req, res) {
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return renderVipProductTestPageInternal(req, res, { error: e && e.message ? e.message : 'Invalid PayPal configuration' });
    }
    const configError = assertConfig(config);
    if (configError) return renderVipProductTestPageInternal(req, res, { error: configError });

    const form = {
        product_name: (req.body.product_name || '').toString(),
        product_description: (req.body.product_description || '').toString()
    };

    try {
        const createdProduct = await createVipProductRemote(config, {
            name: form.product_name,
            description: form.product_description
        });
        return renderVipProductTestPageInternal(req, res, {
            form,
            result: {
                apiBase: config.apiBase,
                product_id: createdProduct.productId,
                raw: createdProduct.raw
            }
        });
    } catch (e) {
        return renderVipProductTestPageInternal(req, res, { form, error: e && e.message ? e.message : 'Failed to create PayPal product' });
    }
}

function renderVipPlanTestPageInternal(req, res, model) {
    const payload = model || {};
    res.render('adminPayPalVipPlanTest', {
        user: req.session.user,
        form: payload.form || {},
        result: payload.result || null,
        error: payload.error || null
    });
}

function renderVipPlanTestPage(req, res) {
    return renderVipPlanTestPageInternal(req, res, {});
}

// Admin test page: create PayPal plan (product_id optional)
async function handleVipPlanTestCreate(req, res) {
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return renderVipPlanTestPageInternal(req, res, { error: e && e.message ? e.message : 'Invalid PayPal configuration' });
    }
    const configError = assertConfig(config);
    if (configError) return renderVipPlanTestPageInternal(req, res, { error: configError });

    const form = {
        product_id: (req.body.product_id || '').toString(),
        product_name: (req.body.product_name || '').toString(),
        product_description: (req.body.product_description || '').toString(),
        plan_name: (req.body.plan_name || '').toString(),
        plan_description: (req.body.plan_description || '').toString(),
        currency: (req.body.currency || '').toString(),
        price: (req.body.price || '').toString(),
        interval_unit: (req.body.interval_unit || '').toString(),
        interval_count: (req.body.interval_count || '').toString()
    };

    try {
        let productId = (form.product_id || '').trim();
        if (!productId) {
            const createdProduct = await createVipProductRemote(config, {
                name: form.product_name,
                description: form.product_description
            });
            productId = createdProduct.productId;
        }

        const createdPlan = await createVipPlanRemote(config, {
            productId,
            name: form.plan_name,
            description: form.plan_description,
            currency: form.currency,
            price: form.price,
            intervalUnit: form.interval_unit,
            intervalCount: form.interval_count
        });

        return renderVipPlanTestPageInternal(req, res, {
            form,
            result: {
                apiBase: config.apiBase,
                product_id: productId,
                plan_id: createdPlan.planId,
                raw: createdPlan.raw
            }
        });
    } catch (e) {
        return renderVipPlanTestPageInternal(req, res, { form, error: e && e.message ? e.message : 'Failed to create PayPal plan' });
    }
}

async function createOrder(config, outTradeNo, amount) {
    const token = await getAccessToken(config);
    const returnUrl = `${config.appBaseUrl}/paypal/return`;
    const cancelUrl = `${config.appBaseUrl}/paypal/cancel`;

    const bodyObj = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                reference_id: outTradeNo,
                custom_id: outTradeNo,
                description: 'Wallet recharge',
                amount: {
                    currency_code: 'USD',
                    value: formatMoney(amount)
                }
            }
        ],
        application_context: {
            brand_name: config.brandName,
            return_url: returnUrl,
            cancel_url: cancelUrl,
            user_action: 'PAY_NOW'
        }
    };

    const body = JSON.stringify(bodyObj);
    const data = await httpsRequestJson(
        'POST',
        `${config.apiBase}/v2/checkout/orders`,
        {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );

    const orderId = data && data.id ? String(data.id) : null;
    const links = data && Array.isArray(data.links) ? data.links : [];
    const approveLink = links.find((l) => l && l.rel === 'approve' && l.href);
    const approveUrl = approveLink ? String(approveLink.href) : null;

    if (!orderId || !approveUrl) {
        throw new Error('PayPal create order response missing approve link');
    }

    return { orderId, approveUrl };
}

function getTransactionById(transactionId, userId, callback) {
    const sql = `
        SELECT id, user_id, order_id, type, payment_method, amount, balance_before, balance_after, status, description, created_at
        FROM transactions
        WHERE id = ? AND user_id = ?
        LIMIT 1
    `;
    db.query(sql, [transactionId, userId], (err, rows) => {
        if (err) return callback(err);
        callback(null, rows && rows[0] ? rows[0] : null);
    });
}

function parsePayPalOrderId(description) {
    const s = (description || '').toString();
    const m = s.match(/paypal_order_id:([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

function updateTransactionPayPalOrderId(transactionId, orderId, callback) {
    const desc = `PayPal sandbox recharge (pending) paypal_order_id:${orderId}`;
    const sql = 'UPDATE transactions SET description = ? WHERE id = ?';
    db.query(sql, [desc, transactionId], callback);
}

function createPendingRechargeTransaction(userId, amount, callback) {
    db.getConnection((err, connection) => {
        if (err) return callback(err);

        const ensureWalletSql = `
            INSERT INTO user_wallets (user_id, balance)
            VALUES (?, 0)
            ON DUPLICATE KEY UPDATE user_id = user_id
        `;

        connection.query(ensureWalletSql, [userId], (err) => {
            if (err) {
                connection.release();
                return callback(err);
            }

            const getBalanceSql = 'SELECT balance FROM user_wallets WHERE user_id = ?';
            connection.query(getBalanceSql, [userId], (err, results) => {
                if (err || !results || results.length === 0) {
                    connection.release();
                    return callback(err || new Error('Wallet not found'));
                }

                const balance = parseFloat(results[0].balance) || 0;
                const insertSql = `
                    INSERT INTO transactions (
                        user_id, order_id, type, payment_method, amount,
                        balance_before, balance_after, status, description
                    ) VALUES (?, NULL, 'recharge', 'paypal', ?, ?, ?, 'pending', ?)
                `;
                const description = 'PayPal sandbox recharge (pending)';
                connection.query(insertSql, [userId, amount, balance, balance, description], (err, result) => {
                    connection.release();
                    if (err) return callback(err);
                    callback(null, { transactionId: result.insertId });
                });
            });
        });
    });
}

async function getOrder(config, orderId) {
    const token = await getAccessToken(config);
    return httpsRequestJson(
        'GET',
        `${config.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        { Authorization: `Bearer ${token}` },
        null
    );
}

async function captureOrder(config, orderId) {
    const token = await getAccessToken(config);
    const body = '{}';
    return httpsRequestJson(
        'POST',
        `${config.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );
}

function extractCaptureId(captureData) {
    try {
        const pu = captureData.purchase_units && captureData.purchase_units[0];
        const cap = pu && pu.payments && pu.payments.captures && pu.payments.captures[0];
        return cap && cap.id ? String(cap.id) : null;
    } catch (e) {
        return null;
    }
}

function finalizeRechargeTransaction(transactionId, userId, orderId, captureId, callback) {
    db.getConnection((err, connection) => {
        if (err) return callback(err);

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return callback(err);
            }

            const lockSql = `
                SELECT id, user_id, type, payment_method, amount, status
                FROM transactions
                WHERE id = ? AND user_id = ?
                FOR UPDATE
            `;

            connection.query(lockSql, [transactionId, userId], (err, rows) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(err);
                    });
                }

                const transaction = rows && rows[0] ? rows[0] : null;
                if (!transaction) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(new Error('Transaction not found'));
                    });
                }

                if (transaction.type !== 'recharge' || transaction.payment_method !== 'paypal') {
                    return connection.rollback(() => {
                        connection.release();
                        callback(new Error('Invalid transaction'));
                    });
                }

                if (transaction.status === 'completed') {
                    return connection.commit((err) => {
                        connection.release();
                        callback(err, { status: 'paid' });
                    });
                }

                const ensureWalletSql = `
                    INSERT INTO user_wallets (user_id, balance)
                    VALUES (?, 0)
                    ON DUPLICATE KEY UPDATE user_id = user_id
                `;

                connection.query(ensureWalletSql, [transaction.user_id], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(err);
                        });
                    }

                    const getBalanceSql = 'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE';
                    connection.query(getBalanceSql, [transaction.user_id], (err, results) => {
                        if (err || !results || results.length === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(err || new Error('Wallet not found'));
                            });
                        }

                        const amountNum = parseFloat(transaction.amount);
                        const balanceBefore = parseFloat(results[0].balance) || 0;
                        const balanceAfter = balanceBefore + amountNum;

                        const updateWalletSql = 'UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?';
                        connection.query(updateWalletSql, [amountNum, transaction.user_id], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(err);
                                });
                            }

                            const desc = `PayPal sandbox recharge (order_id: ${orderId}, capture_id: ${captureId || 'N/A'})`;
                            const updateTxnSql = `
                                UPDATE transactions
                                SET balance_before = ?, balance_after = ?, status = 'completed', description = ?
                                WHERE id = ?
                            `;
                            connection.query(updateTxnSql, [balanceBefore, balanceAfter, desc, transaction.id], (err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(err);
                                    });
                                }

                                connection.commit((err) => {
                                    connection.release();
                                    callback(err, { status: 'paid' });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

// Create VIP subscription and return subscription id + approve url
async function createVipSubscriptionRemote(config, userId) {
    const token = await getAccessToken(config);
    const planId = getVipPlanId();
    if (!planId) {
        throw new Error('Missing PAYPAL_VIP_PLAN_ID in .env');
    }
    const returnUrl = `${config.appBaseUrl}/paypal/vip/return`;
    const cancelUrl = `${config.appBaseUrl}/paypal/vip/cancel`;
    const bodyObj = {
        plan_id: planId,
        subscriber: {
            custom_id: `VIP_USER_${userId}`
        },
        application_context: {
            brand_name: config.brandName,
            return_url: returnUrl,
            cancel_url: cancelUrl,
            user_action: 'SUBSCRIBE_NOW'
        }
    };
    const body = JSON.stringify(bodyObj);
    const data = await httpsRequestJson(
        'POST',
        `${config.apiBase}/v1/billing/subscriptions`,
        {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );
    const subscriptionId = data && data.id ? String(data.id) : null;
    const links = data && Array.isArray(data.links) ? data.links : [];
    const approveLink = links.find((l) => l && l.rel === 'approve' && l.href);
    const approveUrl = approveLink ? String(approveLink.href) : null;
    if (!subscriptionId || !approveUrl) {
        throw new Error('PayPal VIP subscription response missing approve link');
    }
    return { subscriptionId, approveUrl };
}

// Fetch VIP subscription details from PayPal
async function getVipSubscription(config, subscriptionId) {
    const token = await getAccessToken(config);
    return httpsRequestJson(
        'GET',
        `${config.apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
        { Authorization: `Bearer ${token}` },
        null
    );
}

// Start VIP subscription flow and redirect user to PayPal
function startVipSubscription(req, res, userId) {
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        req.flash('error', e && e.message ? e.message : 'Invalid PayPal configuration');
        return res.redirect('/vip');
    }
    const configError = assertConfig(config);
    if (configError) {
        req.flash('error', configError);
        return res.redirect('/vip');
    }
    const planId = getVipPlanId();
    if (!planId) {
        req.flash('error', 'Missing PAYPAL_VIP_PLAN_ID in configuration');
        return res.redirect('/vip');
    }
    createVipSubscriptionRemote(config, userId)
        .then((result) => {
            res.redirect(result.approveUrl);
        })
        .catch((e) => {
            console.error('Error creating PayPal VIP subscription:', e);
            req.flash('error', e && e.message ? e.message : 'Failed to create PayPal VIP subscription');
            res.redirect('/vip');
        });
}

// Handle PayPal return and activate VIP for current user
async function handleVipReturnPage(req, res) {
    const user = req.session.user;
    if (!user || !user.id) {
        req.flash('error', 'Please log in to view this page');
        return res.redirect('/login');
    }
    const subscriptionId = (req.query.subscription_id || req.query.token || '').toString().trim();
    if (!subscriptionId) {
        req.flash('error', 'Missing PayPal subscription id');
        return res.redirect('/vip');
    }
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        req.flash('error', e && e.message ? e.message : 'Invalid PayPal configuration');
        return res.redirect('/vip');
    }
    const configError = assertConfig(config);
    if (configError) {
        req.flash('error', configError);
        return res.redirect('/vip');
    }
    const planId = getVipPlanId();
    if (!planId) {
        req.flash('error', 'Missing PAYPAL_VIP_PLAN_ID in configuration');
        return res.redirect('/vip');
    }
    try {
        const sub = await getVipSubscription(config, subscriptionId);
        const status = sub && sub.status ? String(sub.status).toUpperCase() : null;
        if (status !== 'ACTIVE' && status !== 'APPROVAL_PENDING') {
            req.flash('error', `Subscription is not active (status: ${status || 'unknown'})`);
            return res.redirect('/vip');
        }
        let expiresAt = null;
        const billingInfo = sub && sub.billing_info ? sub.billing_info : null;
        const nextBillingTime = billingInfo && billingInfo.next_billing_time ? billingInfo.next_billing_time : null;
        if (nextBillingTime) {
            const d = new Date(nextBillingTime);
            if (!Number.isNaN(d.getTime())) {
                expiresAt = d;
            }
        }
        if (!expiresAt) {
            const d = new Date();
            d.setMonth(d.getMonth() + 1);
            expiresAt = d;
        }
        const sql = `
            UPDATE users
            SET vip_level = 'vip',
                vip_expires_at = ?,
                vip_paypal_subscription_id = ?
            WHERE id = ?
        `;
        db.query(sql, [expiresAt, subscriptionId, user.id], (err) => {
            if (err) {
                console.error('Error updating user VIP status:', err);
                req.flash('error', 'Subscription succeeded but failed to update VIP status');
                return res.redirect('/vip');
            }
            if (req.session.user) {
                req.session.user.vip_level = 'vip';
                req.session.user.vip_expires_at = expiresAt;
                req.session.user.vip_paypal_subscription_id = subscriptionId;
            }
            req.flash('success', 'VIP subscription activated successfully');
            res.redirect('/vip');
        });
    } catch (e) {
        console.error('Error verifying PayPal VIP subscription:', e);
        req.flash('error', e && e.message ? e.message : 'Failed to verify PayPal subscription');
        res.redirect('/vip');
    }
}

// Handle user canceling VIP subscription on PayPal
function handleVipCancelPage(req, res) {
    req.flash('error', 'PayPal VIP subscription was cancelled');
    res.redirect('/vip');
}

function buildWalletRechargePayUrl(req, userId, amount, callback) {
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return callback(e);
    }

    const configError = assertConfig(config);
    if (configError) return callback(new Error(configError));

    createPendingRechargeTransaction(userId, amount, async (err, created) => {
        if (err) return callback(err);

        const outTradeNo = `TXN_${created.transactionId}`;
        try {
            const order = await createOrder(config, outTradeNo, amount);
            updateTransactionPayPalOrderId(created.transactionId, order.orderId, (err) => {
                if (err) return callback(err);
                callback(null, { outTradeNo, url: order.approveUrl });
            });
        } catch (e) {
            callback(e);
        }
    });
}

function startWalletRecharge(req, res, userId, amount) {
    buildWalletRechargePayUrl(req, userId, amount, (err, result) => {
        if (err) {
            console.error('Error creating PayPal payment:', err);
            req.flash('error', err.message || 'Failed to create PayPal payment');
            return res.redirect('/wallet');
        }
        res.redirect(result.url);
    });
}

function handleStart(req, res) {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return safeJson(res, 400, { ok: false, error: 'Invalid amount' });
    if (amount > 10000) return safeJson(res, 400, { ok: false, error: 'Maximum recharge amount is $10,000' });

    buildWalletRechargePayUrl(req, req.session.user.id, amount, (err, result) => {
        if (err) {
            return safeJson(res, 500, { ok: false, error: err.message || 'Failed to create PayPal payment' });
        }
        return safeJson(res, 200, { ok: true, outTradeNo: result.outTradeNo, url: result.url });
    });
}

function handleReturnPage(req, res) {
    const token = (req.query.token || '').toString().trim();
    res.render('paypalReturn', {
        user: req.session.user,
        orderId: token || null
    });
}

function handleCancel(req, res) {
    req.flash('error', 'PayPal payment was cancelled');
    res.redirect('/wallet');
}

function handleStatus(req, res) {
    const outTradeNo = (req.query.out_trade_no || '').toString().trim();
    if (!outTradeNo) return safeJson(res, 400, { ok: false, error: 'Missing out_trade_no' });

    const transactionId = parseTransactionId(outTradeNo);
    if (!transactionId) return safeJson(res, 400, { ok: false, error: 'Invalid out_trade_no' });

    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return safeJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Invalid PayPal configuration' });
    }

    const configError = assertConfig(config);
    if (configError) return safeJson(res, 500, { ok: false, error: configError });

    getTransactionById(transactionId, req.session.user.id, async (err, transaction) => {
        if (err) return safeJson(res, 500, { ok: false, error: 'Failed to load transaction' });
        if (!transaction) return safeJson(res, 404, { ok: false, error: 'Transaction not found' });

        if (transaction.status === 'completed') {
            return safeJson(res, 200, { ok: true, status: 'paid', paid: true });
        }

        const orderId = parsePayPalOrderId(transaction.description);
        if (!orderId) {
            return safeJson(res, 200, { ok: true, status: 'pending', paid: false, orderStatus: null });
        }

        try {
            const order = await getOrder(config, orderId);
            const orderStatus = order && order.status ? String(order.status) : null;

            if (orderStatus === 'APPROVED') {
                const captured = await captureOrder(config, orderId);
                const captureStatus = captured && captured.status ? String(captured.status) : null;
                if (captureStatus === 'COMPLETED') {
                    const captureId = extractCaptureId(captured);
                    finalizeRechargeTransaction(transactionId, req.session.user.id, orderId, captureId, (err) => {
                        if (err) return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: err.message });
                        return safeJson(res, 200, { ok: true, status: 'paid', paid: true, orderStatus: 'COMPLETED' });
                    });
                    return;
                }
            }

            if (orderStatus === 'COMPLETED') {
                const captureId = extractCaptureId(order);
                finalizeRechargeTransaction(transactionId, req.session.user.id, orderId, captureId, (err) => {
                    if (err) return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: err.message });
                    return safeJson(res, 200, { ok: true, status: 'paid', paid: true, orderStatus: 'COMPLETED' });
                });
                return;
            }

            return safeJson(res, 200, { ok: true, status: 'pending', paid: false, orderStatus });
        } catch (e) {
            return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: e && e.message ? e.message : 'Failed to query PayPal order' });
        }
    });
}

function handleFinish(req, res) {
    const outTradeNo = (req.query.out_trade_no || '').toString().trim();
    if (!outTradeNo) {
        req.flash('error', 'Missing out_trade_no');
        return res.redirect('/wallet');
    }

    const transactionId = parseTransactionId(outTradeNo);
    if (!transactionId) {
        req.flash('error', 'Invalid out_trade_no');
        return res.redirect('/wallet');
    }

    getTransactionById(transactionId, req.session.user.id, (err, transaction) => {
        if (err || !transaction) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/wallet');
        }

        if (transaction.status !== 'completed') {
            req.flash('error', 'Payment not completed');
            return res.redirect('/wallet');
        }

        req.flash('success', `Successfully recharged $${parseFloat(transaction.amount).toFixed(2)} via PayPal`);
        res.redirect('/wallet');
    });
}

module.exports = {
    startWalletRecharge,
    handleStart,
    handleReturnPage,
    handleCancel,
    handleStatus,
    handleFinish,
    handleCreateVipPlan,
    renderVipProductTestPage,
    handleVipProductTestCreate,
    renderVipPlanTestPage,
    handleVipPlanTestCreate,
    startVipSubscription,
    handleVipReturnPage,
    handleVipCancelPage
};

async function refundCaptureRequest(req, captureId, amount) {
    if (!captureId) throw new Error('Missing capture id');
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        throw e;
    }
    const configError = assertConfig(config);
    if (configError) throw new Error(configError);

    const token = await getAccessToken(config);
    const url = `${config.apiBase}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`;
    const bodyObj = {};
    if (amount && Number.isFinite(Number(amount))) {
        bodyObj.amount = { currency_code: 'USD', value: formatMoney(amount) };
    }
    const body = JSON.stringify(bodyObj);

    const resp = await httpsRequestJson('POST', url, {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    }, body);

    return resp;
}

module.exports.refundCapture = refundCaptureRequest;

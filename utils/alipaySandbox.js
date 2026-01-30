const crypto = require('crypto');
const https = require('https');
const db = require('../db');

function nowTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseKeyFromEnv(value) {
    if (!value) return null;
    return value.toString().replace(/\\n/g, '\n').trim();
}

function looksLikeBase64Der(value) {
    if (!value) return false;
    const s = value.toString().trim();
    if (s.includes('-----BEGIN')) return false;
    if (s.length < 100) return false;
    return /^[A-Za-z0-9+/=]+$/.test(s);
}

function loadPrivateKey(privateKeyValue) {
    const keyText = parseKeyFromEnv(privateKeyValue);
    if (!keyText) return null;

    if (keyText.includes('-----BEGIN')) {
        return keyText;
    }

    if (looksLikeBase64Der(keyText)) {
        const der = Buffer.from(keyText, 'base64');
        try {
            return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
        } catch (e1) {
            try {
                return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs1' });
            } catch (e2) {
                throw new Error('Invalid ALIPAY_PRIVATE_KEY (DER base64 is not a supported private key)');
            }
        }
    }

    throw new Error('Invalid ALIPAY_PRIVATE_KEY format');
}

function getConfig(req) {
    const gateway = (process.env.ALIPAY_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do').trim();
    const appId = (process.env.ALIPAY_APP_ID || '').trim();
    const privateKey = loadPrivateKey(process.env.ALIPAY_PRIVATE_KEY);
    const subject = (process.env.ALIPAY_SUBJECT || 'Wallet Recharge').trim();

    const appBaseUrl = `${req.protocol}://${req.get('host')}`;

    return {
        gateway,
        appId,
        privateKey,
        subject,
        appBaseUrl
    };
}

function assertConfig(config) {
    if (!config.appId) return 'Missing ALIPAY_APP_ID in .env';
    if (!config.privateKey) return 'Missing ALIPAY_PRIVATE_KEY in .env';
    if (!config.gateway) return 'Missing ALIPAY_GATEWAY in .env';
    return null;
}

function formatMoney(amount) {
    const num = Number(amount);
    if (!Number.isFinite(num)) return null;
    return num.toFixed(2);
}

function signParams(params, privateKey) {
    const keys = Object.keys(params)
        .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
        .sort();

    const signContent = keys.map((k) => `${k}=${params[k]}`).join('&');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signContent, 'utf8');
    return signer.sign(privateKey, 'base64');
}

function buildGatewayUrl(gateway, params, privateKey) {
    const sign = signParams(params, privateKey);
    const fullParams = { ...params, sign };
    const sp = new URLSearchParams();
    Object.keys(fullParams)
        .filter((k) => fullParams[k] !== undefined && fullParams[k] !== null && fullParams[k] !== '')
        .forEach((k) => sp.append(k, String(fullParams[k])));
    return `${gateway}?${sp.toString()}`;
}

function postGateway(gateway, params, privateKey) {
    const sign = signParams(params, privateKey);
    const body = new URLSearchParams({ ...params, sign }).toString();
    const url = new URL(gateway);

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (raw += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(raw));
                    } catch (e) {
                        reject(new Error(`Invalid Alipay response: ${raw.slice(0, 200)}`));
                    }
                });
            }
        );

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function queryTrade(config, outTradeNo) {
    const params = {
        app_id: config.appId,
        method: 'alipay.trade.query',
        format: 'JSON',
        charset: 'utf-8',
        sign_type: 'RSA2',
        timestamp: nowTimestamp(),
        version: '1.0',
        biz_content: JSON.stringify({ out_trade_no: outTradeNo })
    };
    return postGateway(config.gateway, params, config.privateKey);
}

/**
 * Query a trade by `trade_no` or `out_trade_no`.
 * options: { trade_no, out_trade_no }
 */
function queryTradeRequest(req, options) {
    return new Promise((resolve, reject) => {
        let config;
        try {
            config = getConfig(req);
        } catch (e) {
            return reject(e);
        }

        const configError = assertConfig(config);
        if (configError) return reject(new Error(configError));

        if (!options || (!options.trade_no && !options.out_trade_no)) {
            return reject(new Error('Missing trade identifier for query'));
        }

        const biz = {};
        if (options.trade_no) biz.trade_no = options.trade_no;
        else biz.out_trade_no = options.out_trade_no;

        const params = {
            app_id: config.appId,
            method: 'alipay.trade.query',
            format: 'JSON',
            charset: 'utf-8',
            sign_type: 'RSA2',
            timestamp: nowTimestamp(),
            version: '1.0',
            biz_content: JSON.stringify(biz)
        };

        postGateway(config.gateway, params, config.privateKey)
            .then((data) => {
                const resp = data && data.alipay_trade_query_response ? data.alipay_trade_query_response : null;
                // Alipay trade query response received (debug logs removed)
                if (!resp) return reject(new Error('Invalid Alipay query response'));
                if (resp.code !== '10000') {
                    const msg = `${resp.code || ''} ${resp.msg || ''}`.trim();
                    return reject(new Error(`Alipay query failed: ${msg} | resp: ${JSON.stringify(resp)}`));
                }
                resolve(resp);
            })
            .catch((e) => reject(new Error(`Alipay query error: ${e && e.message ? e.message : e}`)));
    });
}

/**
 * Refund a trade by trade_no or out_trade_no
 * options: { trade_no, out_trade_no, refund_amount, refund_reason, out_request_no }
 */
function refundTrade(req, options) {
    return new Promise((resolve, reject) => {
        let config;
        try {
            config = getConfig(req);
        } catch (e) {
            return reject(e);
        }

        const configError = assertConfig(config);
        if (configError) return reject(new Error(configError));

        if (!options || (!options.trade_no && !options.out_trade_no)) {
            return reject(new Error('Missing trade identifier'));
        }

        const biz = { refund_amount: formatMoney(options.refund_amount || 0) };
        if (options.trade_no) biz.trade_no = options.trade_no;
        if (options.out_trade_no) biz.out_trade_no = options.out_trade_no;
        if (options.out_request_no) biz.out_request_no = options.out_request_no;
        if (options.refund_reason) biz.refund_reason = options.refund_reason;

        const params = {
            app_id: config.appId,
            method: 'alipay.trade.refund',
            format: 'JSON',
            charset: 'utf-8',
            sign_type: 'RSA2',
            timestamp: nowTimestamp(),
            version: '1.0',
            biz_content: JSON.stringify(biz)
        };

        postGateway(config.gateway, params, config.privateKey)
            .then((data) => {
                const resp = data && data.alipay_trade_refund_response ? data.alipay_trade_refund_response : null;
                if (!resp) return reject(new Error('Invalid Alipay refund response'));
                if (resp.code !== '10000') {
                    const msg = `${resp.code || ''} ${resp.msg || ''}`.trim();
                    // include full response for easier debugging
                    return reject(new Error(`Alipay refund failed: ${msg} | resp: ${JSON.stringify(resp)}`));
                }
                resolve(resp);
            })
            .catch((e) => {
                // include any network/parse error
                reject(new Error(`Alipay refund error: ${e && e.message ? e.message : e}`));
            });
    });
}

function parseTransactionId(outTradeNo) {
    const m = (outTradeNo || '').toString().trim().match(/^TXN_(\d+)$/);
    if (!m) return null;
    return Number(m[1]);
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
                    ) VALUES (?, NULL, 'recharge', 'alipay', ?, ?, ?, 'pending', ?)
                `;

                const description = 'Alipay sandbox recharge (pending)';
                connection.query(insertSql, [userId, amount, balance, balance, description], (err, result) => {
                    connection.release();
                    if (err) return callback(err);
                    callback(null, { transactionId: result.insertId });
                });
            });
        });
    });
}

function tryFinalizeTransaction(config, transactionId, outTradeNo, userId, callback) {
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

                if (transaction.type !== 'recharge' || transaction.payment_method !== 'alipay') {
                    return connection.rollback(() => {
                        connection.release();
                        callback(new Error('Invalid transaction'));
                    });
                }

                if (transaction.status === 'completed') {
                    return connection.commit((err) => {
                        connection.release();
                        callback(err, { status: 'paid', transaction });
                    });
                }

                queryTrade(config, outTradeNo)
                    .then((data) => {
                        const resp = data && data.alipay_trade_query_response ? data.alipay_trade_query_response : null;
                        const tradeStatus = resp ? resp.trade_status : null;
                        const tradeNo = resp ? resp.trade_no : null;

                        if (!resp || resp.code !== '10000') {
                            const msg = resp ? `${resp.code || ''} ${resp.msg || ''}`.trim() : 'No response';
                            throw new Error(`Alipay query failed: ${msg}`);
                        }

                        if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
                            return connection.commit((err) => {
                                connection.release();
                                callback(err, { status: 'pending', tradeStatus, transaction });
                            });
                        }

                        const amountNum = parseFloat(transaction.amount);

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

                                    const desc = `Alipay sandbox recharge (out_trade_no: ${outTradeNo}, trade_no: ${tradeNo || 'N/A'})`;
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
                                            callback(err, { status: 'paid', tradeStatus, tradeNo, transaction: { ...transaction, status: 'completed' } });
                                        });
                                    });
                                });
                            });
                        });
                    })
                    .catch((e) => {
                        connection.rollback(() => {
                            connection.release();
                            callback(e);
                        });
                    });
            });
        });
    });
}

function buildWalletRechargePayUrl(req, userId, amount, callback) {
    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return callback(e);
    }

    const configError = assertConfig(config);
    if (configError) {
        return callback(new Error(configError));
    }

    // Use the actual payment amount (converted/scaled) when creating the transaction
    const payAmount = Number((Number(amount) * 1).toFixed(2));

    createPendingRechargeTransaction(userId, payAmount, (err, created) => {
        if (err) return callback(err);

        const outTradeNo = `TXN_${created.transactionId}`;
        const returnUrl = `${config.appBaseUrl}/alipay/return`;
        const payParams = {
            app_id: config.appId,
            method: 'alipay.trade.page.pay',
            format: 'JSON',
            charset: 'utf-8',
            sign_type: 'RSA2',
            timestamp: nowTimestamp(),
            version: '1.0',
            return_url: returnUrl,
                    biz_content: JSON.stringify({
                out_trade_no: outTradeNo,
                product_code: 'FAST_INSTANT_TRADE_PAY',
                total_amount: formatMoney(payAmount),
                subject: config.subject
            })
        };

        try {
            const url = buildGatewayUrl(config.gateway, payParams, config.privateKey);
            callback(null, { outTradeNo, url });
        } catch (e) {
            callback(e);
        }
    });
}

function startWalletRecharge(req, res, userId, amount) {
    buildWalletRechargePayUrl(req, userId, amount, (err, result) => {
        if (err) {
            console.error('Error creating Alipay payment:', err);
            req.flash('error', err.message || 'Failed to create Alipay payment');
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
            return safeJson(res, 500, { ok: false, error: err.message || 'Failed to create Alipay payment' });
        }
        return safeJson(res, 200, { ok: true, outTradeNo: result.outTradeNo, url: result.url });
    });
}

function handleReturnPage(req, res) {
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
        if (err) {
            console.error('Error loading transaction:', err);
            req.flash('error', 'Failed to load transaction');
            return res.redirect('/wallet');
        }
        if (!transaction) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/wallet');
        }

        res.render('alipayReturn', {
            user: req.session.user,
            outTradeNo,
            amount: parseFloat(transaction.amount).toFixed(2)
        });
    });
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
        return safeJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Invalid Alipay configuration' });
    }
    const configError = assertConfig(config);
    if (configError) return safeJson(res, 500, { ok: false, error: configError });

    getTransactionById(transactionId, req.session.user.id, (err, transaction) => {
        if (err) return safeJson(res, 500, { ok: false, error: 'Failed to load transaction' });
        if (!transaction) return safeJson(res, 404, { ok: false, error: 'Transaction not found' });

        if (transaction.status === 'completed') {
            return safeJson(res, 200, { ok: true, status: 'paid', paid: true });
        }

        tryFinalizeTransaction(config, transactionId, outTradeNo, req.session.user.id, (err, result) => {
            if (err) {
                return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: err.message });
            }
            return safeJson(res, 200, { ok: true, status: result.status, paid: result.status === 'paid', tradeStatus: result.tradeStatus || null });
        });
    });
}

function safeJson(res, statusCode, payload) {
    if (!res || res.headersSent || res.writableEnded) return;
    res.status(statusCode).json(payload);
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

        req.flash('success', `Successfully recharged $${parseFloat(transaction.amount).toFixed(2)} via Alipay`);
        res.redirect('/wallet');
    });
}

module.exports = {
    startWalletRecharge,
    handleStart,
    handleReturnPage,
    handleStatus,
    handleFinish,
    refundTrade,
    queryTrade: queryTradeRequest,
    // Face pay helpers
    handleFaceStart,
    handleFacePayPage,
    handleFaceComplete
};

/**
 * Start a simple simulated Alipay FacePay flow for testing/local sandbox.
 * Creates a pending transaction and returns a URL where the user can "perform" face auth.
 */
function handleFaceStart(req, res) {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return safeJson(res, 400, { ok: false, error: 'Invalid amount' });
    if (amount > 10000) return safeJson(res, 400, { ok: false, error: 'Maximum recharge amount is $10,000' });

    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        return safeJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Invalid Alipay configuration' });
    }

    const configError = assertConfig(config);
    if (configError) return safeJson(res, 500, { ok: false, error: configError });

    // Use the actual payment amount when creating the transaction to keep consistency
    const payAmount = Number((Number(amount) * 1).toFixed(2));
    createPendingRechargeTransaction(req.session.user.id, payAmount, (err, created) => {
        if (err) return safeJson(res, 500, { ok: false, error: err.message || 'Failed to create transaction' });
        const outTradeNo = `TXN_${created.transactionId}`;
        // If configured for real Alipay integration, build a real page.pay URL (requires proper env keys)
        if (process.env.ALIPAY_REAL === '1') {
            try {
                const returnUrl = `${config.appBaseUrl}/alipay/return`;
                const payParams = {
                    app_id: config.appId,
                    method: 'alipay.trade.page.pay',
                    format: 'JSON',
                    charset: 'utf-8',
                    sign_type: 'RSA2',
                    timestamp: nowTimestamp(),
                    version: '1.0',
                    return_url: returnUrl,
                    biz_content: JSON.stringify({
                        out_trade_no: outTradeNo,
                        product_code: 'FAST_INSTANT_TRADE_PAY',
                        total_amount: formatMoney(payAmount),
                        subject: config.subject
                    })
                };

                const url = buildGatewayUrl(config.gateway, payParams, config.privateKey);
                return safeJson(res, 200, { ok: true, outTradeNo, url });
            } catch (e) {
                return safeJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Failed to build Alipay URL' });
            }
        }

        // Fallback to local simulated face-pay page
        const url = `${config.appBaseUrl}/alipay/face/pay?out_trade_no=${encodeURIComponent(outTradeNo)}`;
        return safeJson(res, 200, { ok: true, outTradeNo, url });
    });
}

/** Render a simple page to simulate face payment (for sandbox/testing) */
function handleFacePayPage(req, res) {
    const outTradeNo = (req.query.out_trade_no || '').toString().trim();
    if (!outTradeNo) return res.status(400).send('Missing out_trade_no');
    const transactionId = parseTransactionId(outTradeNo);
    if (!transactionId) return res.status(400).send('Invalid out_trade_no');

    getTransactionById(transactionId, req.session.user.id, (err, transaction) => {
        if (err || !transaction) return res.status(404).send('Transaction not found');

        // Render a minimal page with a simulate button
        return res.render('alipayFacePay', {
            user: req.session.user,
            outTradeNo,
            amount: parseFloat(transaction.amount).toFixed(2)
        });
    });
}

/** Complete the face payment (simulation): mark the pending transaction as completed and update wallet. */
function handleFaceComplete(req, res) {
    const outTradeNo = (req.body.out_trade_no || '').toString().trim();
    if (!outTradeNo) return safeJson(res, 400, { ok: false, error: 'Missing out_trade_no' });
    const transactionId = parseTransactionId(outTradeNo);
    if (!transactionId) return safeJson(res, 400, { ok: false, error: 'Invalid out_trade_no' });

    // perform DB transaction to finalize
    db.getConnection((err, connection) => {
        if (err) return safeJson(res, 500, { ok: false, error: 'DB connection error' });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return safeJson(res, 500, { ok: false, error: 'Failed to begin DB transaction' });
            }

            const lockSql = `
                SELECT id, user_id, type, payment_method, amount, status
                FROM transactions
                WHERE id = ? AND user_id = ?
                FOR UPDATE
            `;

            connection.query(lockSql, [transactionId, req.session.user.id], (err, rows) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        return safeJson(res, 500, { ok: false, error: 'Failed to lock transaction' });
                    });
                }

                const transaction = rows && rows[0] ? rows[0] : null;
                if (!transaction) {
                    return connection.rollback(() => {
                        connection.release();
                        return safeJson(res, 404, { ok: false, error: 'Transaction not found' });
                    });
                }

                if (transaction.status === 'completed') {
                    return connection.commit((err) => {
                        connection.release();
                        return safeJson(res, 200, { ok: true, status: 'paid' });
                    });
                }

                const amountNum = parseFloat(transaction.amount);

                const ensureWalletSql = `
                    INSERT INTO user_wallets (user_id, balance)
                    VALUES (?, 0)
                    ON DUPLICATE KEY UPDATE user_id = user_id
                `;

                connection.query(ensureWalletSql, [transaction.user_id], (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            return safeJson(res, 500, { ok: false, error: 'Failed to ensure wallet row' });
                        });
                    }

                    const getBalanceSql = 'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE';
                    connection.query(getBalanceSql, [transaction.user_id], (err, results) => {
                        if (err || !results || results.length === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                return safeJson(res, 500, { ok: false, error: 'Wallet not found' });
                            });
                        }

                        const balanceBefore = parseFloat(results[0].balance) || 0;
                        const balanceAfter = balanceBefore + amountNum;

                        const updateWalletSql = 'UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?';
                        connection.query(updateWalletSql, [amountNum, transaction.user_id], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    return safeJson(res, 500, { ok: false, error: 'Failed to update wallet balance' });
                                });
                            }

                            const desc = `Alipay facepay sandbox recharge (out_trade_no: ${outTradeNo})`;
                            const updateTxnSql = `
                                UPDATE transactions
                                SET balance_before = ?, balance_after = ?, status = 'completed', description = ?
                                WHERE id = ?
                            `;
                            connection.query(updateTxnSql, [balanceBefore, balanceAfter, desc, transaction.id], (err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        return safeJson(res, 500, { ok: false, error: 'Failed to update transaction' });
                                    });
                                }

                                connection.commit((err) => {
                                    connection.release();
                                    if (err) return safeJson(res, 500, { ok: false, error: 'Failed to commit DB transaction' });
                                    return safeJson(res, 200, { ok: true, status: 'paid' });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

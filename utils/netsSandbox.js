const https = require('https');
const crypto = require('crypto');
const db = require('../db');

const qrSessionStore = new Map();

function parseTransactionId(outTradeNo) {
    const m = (outTradeNo || '').toString().trim().match(/^TXN_(\d+)$/);
    if (!m) return null;
    return Number(m[1]);
}

function safeJson(res, statusCode, payload) {
    if (!res || res.headersSent || res.writableEnded) return;
    res.status(statusCode).json(payload);
}

function getConfig(req) {
    const apiBase = (process.env.NETS_API_BASE || 'https://sandbox.nets.openapipaas.com').trim();
    const apiKey = (process.env.NETS_API_KEY || process.env.API_KEY || '').trim();
    const projectId = (process.env.NETS_PROJECT_ID || process.env.PROJECT_ID || '').trim();
    const txnId = (process.env.NETS_TXN_ID || 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b').trim();
    const subject = (process.env.NETS_SUBJECT || 'Wallet Recharge').trim();
    const appBaseUrl = `${req.protocol}://${req.get('host')}`;
    return { apiBase, apiKey, projectId, txnId, subject, appBaseUrl };
}

function assertConfig(config) {
    if (!config.appBaseUrl) return 'Invalid app base url';
    if (!config.apiBase) return 'Missing NETS_API_BASE in .env';
    if (!config.apiKey) return 'Missing NETS_API_KEY (or API_KEY) in .env';
    if (!config.projectId) return 'Missing NETS_PROJECT_ID (or PROJECT_ID) in .env';
    if (!config.txnId) return 'Missing NETS_TXN_ID in .env';
    return null;
}

function httpsRequestRaw(method, urlStr, headers, body) {
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
                res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: raw }));
            }
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function httpsRequestJson(method, urlStr, headers, payloadObj) {
    const body = payloadObj ? JSON.stringify(payloadObj) : '';
    const resp = await httpsRequestRaw(
        method,
        urlStr,
        {
            ...headers,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );

    const ok = resp && resp.statusCode >= 200 && resp.statusCode < 300;
    if (!ok) {
        throw new Error(`NETS API HTTP ${resp ? resp.statusCode : 'N/A'}: ${(resp && resp.body ? resp.body : '').slice(0, 300)}`);
    }

    try {
        return resp.body ? JSON.parse(resp.body) : {};
    } catch (e) {
        throw new Error(`Invalid NETS API response: ${(resp && resp.body ? resp.body : '').slice(0, 300)}`);
    }
}

function newTxnId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex');
}

function getSession(outTradeNo) {
    const s = qrSessionStore.get(outTradeNo);
    if (!s) return null;
    if (Date.now() - s.createdAt > 30 * 60 * 1000) {
        qrSessionStore.delete(outTradeNo);
        return null;
    }
    return s;
}

async function requestQrCode(config, outTradeNo, amountDollars) {
    const reqBody = {
        txn_id: config.txnId,
        amt_in_dollars: Number(amountDollars).toFixed(2),
        notify_mobile: 0
    };

    const response = await httpsRequestJson(
        'POST',
        `${config.apiBase}/api/v1/common/payments/nets-qr/request`,
        {
            'api-key': config.apiKey,
            'project-id': config.projectId
        },
        reqBody
    );

    const data = response && response.result && response.result.data ? response.result.data : null;
    if (!data) throw new Error('Invalid NETS QR response');

    if (String(data.response_code) !== '00' || Number(data.txn_status) !== 1 || !data.qr_code || !data.txn_retrieval_ref) {
        const msg = data.error_message || 'Failed to generate NETS QR code';
        throw new Error(msg);
    }

    const session = {
        outTradeNo,
        txnRetrievalRef: String(data.txn_retrieval_ref),
        qrCodeBase64: String(data.qr_code),
        createdAt: Date.now()
    };
    qrSessionStore.set(outTradeNo, session);
    return session;
}

async function queryQrTransaction(config, txnRetrievalRef, frontendTimeoutStatus) {
    return httpsRequestJson(
        'POST',
        `${config.apiBase}/api/v1/common/payments/nets-qr/query`,
        {
            'api-key': config.apiKey,
            'project-id': config.projectId
        },
        { txn_retrieval_ref: txnRetrievalRef, frontend_timeout_status: frontendTimeoutStatus }
    );
}

async function refundQrTransaction(config, txnRetrievalRef, amountDollars, refundRef) {
    const refundPath = (process.env.NETS_REFUND_PATH || '/api/v1/common/payments/nets-qr/refund').trim();
    const payload = {
        txn_id: config.txnId,
        txn_retrieval_ref: String(txnRetrievalRef),
        amt_in_dollars: Number(amountDollars).toFixed(2)
    };
    if (refundRef) payload.refund_ref = String(refundRef);

    return httpsRequestJson(
        'POST',
        `${config.apiBase}${refundPath.startsWith('/') ? '' : '/'}${refundPath}`,
        {
            'api-key': config.apiKey,
            'project-id': config.projectId
        },
        payload
    );
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
                    ) VALUES (?, NULL, 'recharge', 'nets', ?, ?, ?, 'pending', ?)
                `;
                const description = 'NETS recharge (pending)';
                connection.query(insertSql, [userId, amount, balance, balance, description], (err, result) => {
                    connection.release();
                    if (err) return callback(err);
                    callback(null, { transactionId: result.insertId });
                });
            });
        });
    });
}

function markAuthorizedFromGateway(transactionId, userId, gatewayInfo, callback) {
    const responseCode = gatewayInfo && gatewayInfo.responseCode ? String(gatewayInfo.responseCode) : '';
    const txnStatus = gatewayInfo && gatewayInfo.txnStatus !== undefined ? String(gatewayInfo.txnStatus) : '';
    const txnRetrievalRef = gatewayInfo && gatewayInfo.txnRetrievalRef ? String(gatewayInfo.txnRetrievalRef) : '';
    const desc = `NETS recharge (authorized)${responseCode ? ` response_code:${responseCode}` : ''}${txnStatus ? ` txn_status:${txnStatus}` : ''}${txnRetrievalRef ? ` txn_retrieval_ref:${txnRetrievalRef}` : ''}`;

    const sql = `
        UPDATE transactions
        SET status = 'authorized', description = ?
        WHERE id = ? AND user_id = ? AND type = 'recharge' AND payment_method = 'nets' AND status = 'pending'
    `;
    db.query(sql, [desc, transactionId, userId], (err, result) => {
        if (err) return callback(err);
        callback(null, { changed: result && result.affectedRows > 0 });
    });
}

function tryFinalizeTransaction(transactionId, userId, callback) {
    db.getConnection((err, connection) => {
        if (err) return callback(err);

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return callback(err);
            }

            const lockSql = `
                SELECT id, user_id, type, payment_method, amount, status, description
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

                if (transaction.type !== 'recharge' || transaction.payment_method !== 'nets') {
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

                if (transaction.status !== 'authorized') {
                    return connection.commit((err) => {
                        connection.release();
                        callback(err, { status: 'pending' });
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

                            const updateTxnSql = `
                                UPDATE transactions
                                SET balance_before = ?, balance_after = ?, status = 'completed', description = ?
                                WHERE id = ?
                            `;
                            const finalDesc = `${(transaction.description || 'NETS recharge').toString()} (completed)`;
                            connection.query(updateTxnSql, [balanceBefore, balanceAfter, finalDesc, transaction.id], (err) => {
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

function refundWalletRecharge(req, txnRetrievalRef, amount, refundRef) {
    return new Promise((resolve, reject) => {
        let config;
        try {
            config = getConfig(req);
        } catch (e) {
            return reject(e);
        }

        const configError = assertConfig(config);
        if (configError) return reject(new Error(configError));
        if (!txnRetrievalRef) return reject(new Error('Missing NETS txn_retrieval_ref'));

        refundQrTransaction(config, txnRetrievalRef, amount, refundRef)
            .then(resolve)
            .catch(reject);
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
    if (configError) return callback(new Error(configError));

    createPendingRechargeTransaction(userId, amount, (err, created) => {
        if (err) return callback(err);
        const outTradeNo = `TXN_${created.transactionId}`;
        (async () => {
            try {
                const session = await requestQrCode(config, outTradeNo, amount);
                const url = `${config.appBaseUrl}/nets/pay?out_trade_no=${encodeURIComponent(outTradeNo)}`;
                const sseUrl = `${config.appBaseUrl}/nets/sse/payment-status/${encodeURIComponent(session.txnRetrievalRef)}?out_trade_no=${encodeURIComponent(outTradeNo)}`;
                callback(null, { outTradeNo, url, txnRetrievalRef: session.txnRetrievalRef, sseUrl });
            } catch (e) {
                callback(e);
            }
        })();
    });
}

function startWalletRecharge(req, res, userId, amount) {
    buildWalletRechargePayUrl(req, userId, amount, (err, result) => {
        if (err) {
            console.error('Error creating NETS payment:', err);
            req.flash('error', err.message || 'Failed to create NETS payment');
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
        if (err) return safeJson(res, 500, { ok: false, error: err.message || 'Failed to create NETS payment' });
        return safeJson(res, 200, { ok: true, outTradeNo: result.outTradeNo, url: result.url, txnRetrievalRef: result.txnRetrievalRef, sseUrl: result.sseUrl });
    });
}

function handlePayPage(req, res) {
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

    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        req.flash('error', e.message || 'Failed to load NETS config');
        return res.redirect('/wallet');
    }
    const configError = assertConfig(config);
    if (configError) {
        req.flash('error', configError);
        return res.redirect('/wallet');
    }

    getTransactionById(transactionId, req.session.user.id, (err, transaction) => {
        if (err || !transaction) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/wallet');
        }

        const amountDollars = parseFloat(transaction.amount);
        if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
            req.flash('error', 'Invalid transaction amount');
            return res.redirect('/wallet');
        }

        (async () => {
            try {
                let session = getSession(outTradeNo);
                if (!session) {
                    session = await requestQrCode(config, outTradeNo, amountDollars);
                }

                res.render('netsPay', {
                    user: req.session.user,
                    outTradeNo,
                    amount: amountDollars.toFixed(2),
                    qrCodeUrl: `data:image/png;base64,${session.qrCodeBase64}`,
                    txnRetrievalRef: session.txnRetrievalRef
                });
            } catch (e) {
                req.flash('error', e.message || 'Failed to generate NETS QR');
                return res.redirect('/wallet');
            }
        })();
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
        return safeJson(res, 500, { ok: false, error: e.message || 'Failed to load NETS config' });
    }
    const configError = assertConfig(config);
    if (configError) return safeJson(res, 500, { ok: false, error: configError });

    getTransactionById(transactionId, req.session.user.id, (err, transaction) => {
        if (err) return safeJson(res, 500, { ok: false, error: 'Failed to load transaction' });
        if (!transaction) return safeJson(res, 404, { ok: false, error: 'Transaction not found' });

        if (transaction.status === 'completed') {
            return safeJson(res, 200, { ok: true, status: 'paid', paid: true });
        }

        if (transaction.status === 'authorized') {
            return tryFinalizeTransaction(transactionId, req.session.user.id, (err, result) => {
                if (err) return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: err.message });
                return safeJson(res, 200, { ok: true, status: result.status, paid: result.status === 'paid' });
            });
        }

        (async () => {
            try {
                const session = getSession(outTradeNo);
                if (!session) {
                    return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: 'NETS session expired. Please open payment tab again.' });
                }

                const queryResp = await queryQrTransaction(config, session.txnRetrievalRef, 0);
                const data = queryResp && queryResp.result && queryResp.result.data ? queryResp.result.data : null;
                if (!data) return safeJson(res, 200, { ok: true, status: 'pending', paid: false });

                const responseCode = String(data.response_code || '');
                const txnStatus = Number(data.txn_status);
                const isPaid = responseCode === '00' && txnStatus === 1;

                if (!isPaid) {
                    return safeJson(res, 200, { ok: true, status: 'pending', paid: false, responseCode, txnStatus });
                }

                markAuthorizedFromGateway(transactionId, req.session.user.id, { responseCode, txnStatus, txnRetrievalRef: session.txnRetrievalRef }, (err) => {
                    if (err) {
                        return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: err.message, responseCode, txnStatus });
                    }
                    tryFinalizeTransaction(transactionId, req.session.user.id, (err, result) => {
                        if (err) return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: err.message, responseCode, txnStatus });
                        return safeJson(res, 200, { ok: true, status: result.status, paid: result.status === 'paid', responseCode, txnStatus });
                    });
                });
            } catch (e) {
                return safeJson(res, 200, { ok: true, status: 'pending', paid: false, error: e.message });
            }
        })();
    });
}

function handleSsePaymentStatus(req, res) {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });

    const txnRetrievalRef = (req.params.txnRetrievalRef || '').toString().trim();
    const outTradeNo = (req.query.out_trade_no || '').toString().trim();
    const transactionId = parseTransactionId(outTradeNo);

    if (!txnRetrievalRef || !outTradeNo || !transactionId) {
        res.write(`data: ${JSON.stringify({ error: 'Missing txnRetrievalRef or out_trade_no' })}\n\n`);
        return res.end();
    }

    let config;
    try {
        config = getConfig(req);
    } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e.message || 'Failed to load NETS config' })}\n\n`);
        return res.end();
    }
    const configError = assertConfig(config);
    if (configError) {
        res.write(`data: ${JSON.stringify({ error: configError })}\n\n`);
        return res.end();
    }

    getTransactionById(transactionId, req.session.user.id, (err, transaction) => {
        if (err || !transaction) {
            res.write(`data: ${JSON.stringify({ error: 'Transaction not found' })}\n\n`);
            return res.end();
        }

        let pollCount = 0;
        const maxPolls = 60;
        let frontendTimeoutStatus = 0;

        const interval = setInterval(async () => {
            pollCount += 1;
            try {
                const resp = await queryQrTransaction(config, txnRetrievalRef, frontendTimeoutStatus);
                res.write(`data: ${JSON.stringify(resp)}\n\n`);

                const data = resp && resp.result && resp.result.data ? resp.result.data : null;
                const responseCode = data ? String(data.response_code || '') : '';
                const txnStatus = data ? Number(data.txn_status) : NaN;

                if (responseCode === '00' && txnStatus === 1) {
                    markAuthorizedFromGateway(transactionId, req.session.user.id, { responseCode, txnStatus, txnRetrievalRef }, () => {
                        tryFinalizeTransaction(transactionId, req.session.user.id, () => {
                            res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
                            clearInterval(interval);
                            res.end();
                        });
                    });
                    return;
                }

                if (frontendTimeoutStatus === 1 && data && (responseCode !== '00' || txnStatus === 2)) {
                    res.write(`data: ${JSON.stringify({ fail: true, ...data })}\n\n`);
                    clearInterval(interval);
                    res.end();
                    return;
                }
            } catch (e) {
                clearInterval(interval);
                res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
                res.end();
                return;
            }

            if (pollCount >= maxPolls) {
                clearInterval(interval);
                frontendTimeoutStatus = 1;
                res.write(`data: ${JSON.stringify({ fail: true, error: 'Timeout' })}\n\n`);
                res.end();
            }
        }, 5000);

        req.on('close', () => clearInterval(interval));
    });
}

function handleReturnPage(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NETS Return</title>
  <link rel="stylesheet" href="/css/style.css" />
</head>
<body>
  <div style="max-width:720px;margin:60px auto;padding:0 20px;">
    <div style="background:white;border-radius:14px;box-shadow:0 4px 12px rgba(0,0,0,0.08);padding:28px;">
      <div style="font-size:22px;font-weight:800;margin:0 0 10px 0;">NETS payment submitted</div>
      <p style="color:#6c757d;margin:0 0 16px 0;">You can close this tab. The Wallet page will keep checking the payment status.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="/wallet" style="padding:12px 16px;border-radius:10px;border:2px solid #e0e0e0;background:white;cursor:pointer;font-weight:700;text-decoration:none;color:#333;">Back to Wallet</a>
        <button onclick="window.close()" style="padding:12px 16px;border-radius:10px;border:2px solid #e0e0e0;background:white;cursor:pointer;font-weight:700;">Close Tab</button>
      </div>
    </div>
  </div>
</body>
</html>`);
}

function handleS2SEnd(req, res) {
    safeJson(res, 200, { ok: true });
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

        req.flash('success', `Successfully recharged $${parseFloat(transaction.amount).toFixed(2)} via NETS`);
        res.redirect('/wallet');
    });
}

module.exports = {
    startWalletRecharge,
    handleStart,
    handlePayPage,
    handleStatus,
    handleSsePaymentStatus,
    handleReturnPage,
    handleS2SEnd,
    handleFinish,
    refundWalletRecharge
};

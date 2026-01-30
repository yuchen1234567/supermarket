// ========================================
// Refund Controllers
// Handles refund_requests table operations
// ========================================
const Refund = require('../models/refund');
const Order = require('../models/order');
const Wallet = require('../models/wallet');
const shippingModel = require('../models/shipping');
const Transaction = require('../models/transaction');
const alipaySandbox = require('../utils/alipaySandbox');
const paypalSandbox = require('../utils/paypalSandbox');
const netsSandbox = require('../utils/netsSandbox');
const db = require('../db');
function parsePayPalIdsFromTxn(txn) {
    if (!txn) return { order_id: null, capture_id: null };
    const desc = (txn.description || '').toString();
    const m1 = desc.match(/order_id\s*[:=]?\s*([A-Za-z0-9_\-]+)/i);
    const m2 = desc.match(/capture_id\s*[:=]?\s*([A-Za-z0-9_\-]+)/i);
    return { order_id: m1 ? m1[1] : null, capture_id: m2 ? m2[1] : null };
}

function parseNetsTxnRetrievalRefFromTxn(txn) {
    if (!txn) return { txn_retrieval_ref: null };
    const desc = (txn.description || '').toString();
    const m = desc.match(/txn_retrieval_ref\s*[:=]\s*([A-Za-z0-9_\-]+)/i);
    return { txn_retrieval_ref: m ? m[1] : null };
}

/**
 * Parse alipay identifiers from a transaction object.
 * Prefer explicit fields `trade_no` / `out_trade_no` if present,
 * otherwise fall back to searching in `description`.
 */
function parseAlipayIdsFromTxn(txn) {
    if (!txn) return { trade_no: null, out_trade_no: null };

    let trade_no = txn.trade_no || txn.tradeNo || null;
    let out_trade_no = txn.out_trade_no || txn.outTradeNo || null;
    const desc = (txn.description || '').toString();

    if (!trade_no) {
        const m = desc.match(/trade_no\s*[:=]?\s*([A-Za-z0-9_\-]+)/i);
        if (m) trade_no = m[1];
    }

    if (!out_trade_no) {
        const m = desc.match(/out_trade_no\s*[:=]?\s*([A-Za-z0-9_\-]+)/i);
        if (m) out_trade_no = m[1];
        else {
            // also accept bare TXN_123 style
            const m2 = desc.match(/\b(TXN_\d+)\b/i);
            if (m2) out_trade_no = m2[1];
        }
    }

    return { trade_no, out_trade_no };
}


/**
 * User: Request refund for an order
 */
function requestRefund(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.orderId, 10);
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
        req.flash('error', 'Please provide a detailed reason (at least 10 characters)');
        return res.redirect(`/order/${orderId}`);
    }

    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        if (order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }

        if (order.is_confirmed) {
            req.flash('error', 'Cannot request refund after confirming delivery');
            return res.redirect(`/order/${orderId}`);
        }

        Refund.getByOrderId(orderId, (refErr, existingRefund) => {
            if (refErr) {
                console.error('Error checking refund:', refErr);
                req.flash('error', 'Failed to process refund request');
                return res.redirect(`/order/${orderId}`);
            }

            if (existingRefund) {
                req.flash('error', 'Refund request already exists for this order');
                return res.redirect(`/order/${orderId}`);
            }

            shippingModel.getByOrderId(orderId, (shipErr, shipment) => {
                const shipmentId = shipment ? shipment.id : null;

                Refund.create(orderId, user.id, shipmentId, order.total, reason, (createErr) => {
                    if (createErr) {
                        console.error('Error creating refund:', createErr);
                        req.flash('error', 'Failed to submit refund request');
                    } else {
                        req.flash('success', 'Refund request submitted successfully. Please wait for admin approval.');
                    }
                    res.redirect(`/order/${orderId}`);
                });
            });
        });
    });
}

/**
 * User: Immediately refund via Alipay (if original payment used Alipay)
 */
function refundNow(req, res) {
    const user = req.session.user;
    const orderId = parseInt(req.params.orderId, 10);
    if (Number.isNaN(orderId) || orderId <= 0) {
        req.flash('error', 'Invalid order ID');
        return res.redirect('/orders');
    }

    Order.getById(orderId, (err, order) => {
        if (err || !order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        if (order.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/orders');
        }

        if (order.is_confirmed) {
            req.flash('error', 'Cannot refund after confirming delivery');
            return res.redirect(`/order/${orderId}`);
        }

        // Find related transactions for this order
        Transaction.listByOrder(orderId, (txErr, transactions) => {
            if (txErr) {
                console.error('Error fetching transactions for refund:', txErr);
                req.flash('error', 'Failed to initiate refund');
                return res.redirect(`/order/${orderId}`);
            }

            const alipayTxn = (transactions || []).find(t => t.payment_method === 'alipay');
            const paypalTxn = (transactions || []).find(t => t.payment_method === 'paypal');

            const alreadyRefundedAlipay = (transactions || []).some(t => t.type === 'refund' && t.payment_method === 'alipay');
            const alreadyRefundedPayPal = (transactions || []).some(t => t.type === 'refund' && t.payment_method === 'paypal');

            if (alreadyRefundedAlipay || alreadyRefundedPayPal) {
                req.flash('error', 'This order has already been refunded');
                return res.redirect(`/order/${orderId}`);
            }

            // Try PayPal refund if PayPal txn exists
            if (paypalTxn) {
                const pids = parsePayPalIdsFromTxn(paypalTxn);
                const order_id = pids.order_id;
                const capture_id = pids.capture_id;

                if (!capture_id) {
                    req.flash('error', 'Cannot determine PayPal capture id for refund');
                    return res.redirect(`/order/${orderId}`);
                }
                paypalSandbox.refundCapture(req, capture_id, order.total)
                .then((resp) => {
                    const paypalRefundId = resp && resp.id ? resp.id : null;
                    const description = `Refunded via PayPal (refund_id: ${paypalRefundId || 'N/A'}, capture_id: ${capture_id}, order_id: ${order_id || 'N/A'})`;
                    Transaction.create({
                        user_id: user.id,
                        order_id: orderId,
                        type: 'refund',
                        payment_method: 'paypal',
                        amount: order.total,
                        balance_before: 0,
                        balance_after: 0,
                        description
                    }, (createErr) => {
                        if (createErr) console.error('Error recording refund transaction:', createErr);
                        req.flash('success', `Successfully refunded $${parseFloat(order.total).toFixed(2)} via PayPal`);
                        return res.redirect(`/order/${orderId}`);
                    });
                })
                .catch((e) => {
                    console.error('PayPal refund failed:', e && e.message ? e.message : e);
                    req.flash('error', `PayPal refund failed: ${e && e.message ? e.message : 'unknown error'}`);
                    return res.redirect(`/order/${orderId}`);
                });
                return;
            }

            // Fallback to Alipay if present
            if (!alipayTxn) {
                req.flash('error', 'No supported payment method found for this order');
                return res.redirect(`/order/${orderId}`);
            }

            const ids = parseAlipayIdsFromTxn(alipayTxn);
            const trade_no = ids.trade_no;
            const out_trade_no = ids.out_trade_no;

            if (!trade_no && !out_trade_no) {
                req.flash('error', 'Cannot determine Alipay trade identifier for refund');
                return res.redirect(`/order/${orderId}`);
            }

            const out_request_no = `USERREF_${user.id}_${Date.now()}`;

            // Prefer using out_trade_no when available; otherwise use trade_no
            const refundOptions = {
                refund_amount: order.total,
                refund_reason: 'User requested refund',
                out_request_no
            };
            if (out_trade_no) refundOptions.out_trade_no = out_trade_no;
            else if (trade_no) refundOptions.trade_no = trade_no;

            alipaySandbox.refundTrade(req, refundOptions)
            .then((resp) => {
                // Record refund transaction (Alipay external)
                const description = `Refunded via Alipay (refund_fee: ${resp.refund_fee || order.total}, trade_no: ${trade_no || 'N/A'}, out_request_no: ${out_request_no})`;
                Transaction.create({
                    user_id: user.id,
                    order_id: orderId,
                    type: 'refund',
                    payment_method: 'alipay',
                    amount: order.total,
                    balance_before: 0,
                    balance_after: 0,
                    description
                }, (createErr) => {
                    if (createErr) console.error('Error recording refund transaction:', createErr);
                    req.flash('success', `Successfully refunded $${parseFloat(order.total).toFixed(2)} via Alipay`);
                    return res.redirect(`/order/${orderId}`);
                });
            })
            .catch((e) => {
                console.error('Alipay refund failed:', e && e.message ? e.message : e);
                req.flash('error', `Alipay refund failed: ${e && e.message ? e.message : 'unknown error'}`);
                return res.redirect(`/order/${orderId}`);
            });
        });
    });
}

/**
 * User: Refund by transaction id (supports recharge transactions)
 */
function refundTransaction(req, res) {
    const user = req.session.user;
    const txnId = parseInt(req.params.transactionId, 10);
    if (Number.isNaN(txnId) || txnId <= 0) {
        req.flash('error', 'Invalid transaction id');
        return res.redirect('/wallet');
    }

    Transaction.getById(txnId, (err, txn) => {
        if (err || !txn) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/wallet');
        }

        if (txn.user_id !== user.id) {
            req.flash('error', 'Access denied');
            return res.redirect('/wallet');
        }

        if (txn.status !== 'completed' || txn.type !== 'recharge') {
            req.flash('error', 'Only completed recharge transactions can be refunded here');
            return res.redirect('/wallet');
        }

        const pm = (txn.payment_method || '').toString().trim().toLowerCase();
        const refundAmount = parseFloat(txn.amount);
        if (Number.isNaN(refundAmount) || refundAmount <= 0) {
            req.flash('error', 'Invalid transaction amount for refund');
            return res.redirect('/wallet');
        }

        const refundMarker = `refund_of_txn_id:${txnId}`;
        const out_request_no = `USER_TXN_REF_${txnId}_${Date.now()}`;

        let paypalOrderId = null;
        let paypalCaptureId = null;
        let alipayTradeNo = null;
        let alipayOutTradeNo = null;
        let netsTxnRetrievalRef = null;

        if (pm === 'alipay') {
            const ids = parseAlipayIdsFromTxn(txn);
            alipayTradeNo = ids.trade_no;
            alipayOutTradeNo = ids.out_trade_no;
            if (!alipayTradeNo && !alipayOutTradeNo) {
                req.flash('error', 'Cannot determine Alipay trade identifier for refund');
                return res.redirect('/wallet');
            }
        } else if (pm === 'paypal') {
            const pids = parsePayPalIdsFromTxn(txn);
            paypalOrderId = pids.order_id;
            paypalCaptureId = pids.capture_id;
            if (!paypalCaptureId) {
                req.flash('error', 'Missing PayPal capture id for refund');
                return res.redirect('/wallet');
            }
        } else if (pm === 'nets') {
            const ids = parseNetsTxnRetrievalRefFromTxn(txn);
            netsTxnRetrievalRef = ids.txn_retrieval_ref;
            if (!netsTxnRetrievalRef) {
                req.flash('error', 'Cannot determine NETS txn reference for refund');
                return res.redirect('/wallet');
            }
        } else {
            req.flash('error', 'Only Alipay, PayPal or NETS recharge transactions can be refunded here');
            return res.redirect('/wallet');
        }

        db.getConnection((connErr, connection) => {
            if (connErr) {
                req.flash('error', 'System error: cannot start refund');
                return res.redirect('/wallet');
            }

            connection.beginTransaction((txErr) => {
                if (txErr) {
                    connection.release();
                    req.flash('error', 'System error: cannot start refund');
                    return res.redirect('/wallet');
                }

                const checkSql = `
                    SELECT id, status
                    FROM transactions
                    WHERE user_id = ?
                      AND type = 'refund'
                      AND INSTR(description, ?) > 0
                    ORDER BY created_at DESC
                    LIMIT 1
                `;
                connection.query(checkSql, [user.id, refundMarker], (checkErr, rows) => {
                    if (checkErr) {
                        return connection.rollback(() => {
                            connection.release();
                            req.flash('error', 'Failed to check existing refunds');
                            return res.redirect('/wallet');
                        });
                    }

                    const existing = rows && rows[0] ? rows[0] : null;
                    if (existing && String(existing.status || '').toLowerCase() !== 'failed') {
                        return connection.rollback(() => {
                            connection.release();
                            req.flash('error', 'A refund has already been issued (or is processing) for this recharge');
                            return res.redirect('/wallet');
                        });
                    }

                    Wallet.debitBalanceInTx(connection, user.id, refundAmount, (debitErr, debitResult) => {
                        if (debitErr) {
                            return connection.rollback(() => {
                                connection.release();
                                req.flash('error', debitErr.message || 'Insufficient balance to refund');
                                return res.redirect('/wallet');
                            });
                        }

                        // Step 1: debit wallet and create a "processing" refund transaction (atomic)
                        const processingDescParts = [refundMarker];
                        if (pm === 'paypal') processingDescParts.push(`capture_id:${paypalCaptureId}`, `order_id:${paypalOrderId || 'N/A'}`);
                        if (pm === 'alipay') processingDescParts.push(`trade_no:${alipayTradeNo || 'N/A'}`, `out_trade_no:${alipayOutTradeNo || 'N/A'}`, `out_request_no:${out_request_no}`);
                        if (pm === 'nets') processingDescParts.push(`txn_retrieval_ref:${netsTxnRetrievalRef}`, `refund_ref:${out_request_no}`);

                        const processingDesc = `Refund processing (${processingDescParts.join(', ')})`;

                        Transaction.create(
                            {
                                user_id: user.id,
                                order_id: null,
                                type: 'refund',
                                payment_method: pm,
                                amount: -refundAmount,
                                balance_before: debitResult.balanceBefore,
                                balance_after: debitResult.balanceAfter,
                                status: 'processing',
                                description: processingDesc
                            },
                            (createErr, createRes) => {
                                if (createErr) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        req.flash('error', 'Failed to create refund record');
                                        return res.redirect('/wallet');
                                    });
                                }

                                const refundTxnId = createRes && createRes.insertId ? createRes.insertId : null;
                                connection.commit((commitErr) => {
                                    connection.release();
                                    if (commitErr) {
                                        req.flash('error', 'Failed to start refund');
                                        return res.redirect('/wallet');
                                    }
                                    if (!refundTxnId) {
                                        req.flash('error', 'Failed to start refund');
                                        return res.redirect('/wallet');
                                    }

                                    function finalizeSuccess(finalDesc, successMsg) {
                                        Transaction.updateStatusAndDescription(refundTxnId, 'completed', finalDesc, () => {
                                            req.flash('success', successMsg);
                                            return res.redirect('/wallet');
                                        });
                                    }

                                    function finalizeFail(errObj) {
                                        // Step 2 (fail): credit wallet back and mark refund as failed
                                        const reason = errObj && errObj.message ? String(errObj.message) : 'unknown error';
                                        const failDesc = `Refund failed (${refundMarker}, reason:${reason.slice(0, 180)})`;

                                        db.getConnection((e2, conn2) => {
                                            if (e2) {
                                                Transaction.updateStatusAndDescription(refundTxnId, 'failed', failDesc, () => {
                                                    req.flash('error', `Refund failed: ${reason}`);
                                                    return res.redirect('/wallet');
                                                });
                                                return;
                                            }

                                            conn2.beginTransaction((e3) => {
                                                if (e3) {
                                                    conn2.release();
                                                    Transaction.updateStatusAndDescription(refundTxnId, 'failed', failDesc, () => {
                                                        req.flash('error', `Refund failed: ${reason}`);
                                                        return res.redirect('/wallet');
                                                    });
                                                    return;
                                                }

                                                Wallet.creditBalanceInTx(conn2, user.id, refundAmount, (creditErr) => {
                                                    if (creditErr) {
                                                        return conn2.rollback(() => {
                                                            conn2.release();
                                                            Transaction.updateStatusAndDescription(refundTxnId, 'failed', failDesc, () => {
                                                                req.flash('error', `Refund failed: ${reason}`);
                                                                return res.redirect('/wallet');
                                                            });
                                                        });
                                                    }

                                                conn2.commit(() => {
                                                    conn2.release();
                                                    Transaction.updateStatusAndDescription(refundTxnId, 'failed', failDesc, () => {
                                                        req.flash('error', `Refund failed: ${reason}`);
                                                        return res.redirect('/wallet');
                                                    });
                                                });
                                                });
                                            });
                                        });
                                    }

                                    if (pm === 'alipay') {
                                        // Step 2 (provider): request refund from Alipay
                                        const refundOptions = {
                                            refund_amount: refundAmount,
                                            refund_reason: 'User requested refund',
                                            out_request_no
                                        };
                                        if (alipayOutTradeNo) refundOptions.out_trade_no = alipayOutTradeNo;
                                        else if (alipayTradeNo) refundOptions.trade_no = alipayTradeNo;

                                        alipaySandbox
                                            .refundTrade(req, refundOptions)
                                            .then((resp) => {
                                                const refundedFee = resp && resp.refund_fee ? resp.refund_fee : refundAmount;
                                                const finalDesc = `Refunded via Alipay (${refundMarker}, refund_fee:${refundedFee}, trade_no:${alipayTradeNo || 'N/A'}, out_request_no:${out_request_no})`;
                                                finalizeSuccess(finalDesc, `Successfully refunded $${refundAmount.toFixed(2)} via Alipay`);
                                            })
                                            .catch(finalizeFail);
                                        return;
                                    }

                                    if (pm === 'paypal') {
                                        // Step 2 (provider): request refund from PayPal
                                        paypalSandbox
                                            .refundCapture(req, paypalCaptureId, refundAmount)
                                            .then((resp) => {
                                                const paypalRefundId = resp && resp.id ? resp.id : null;
                                                const finalDesc = `Refunded via PayPal (${refundMarker}, refund_id:${paypalRefundId || 'N/A'}, capture_id:${paypalCaptureId}, order_id:${paypalOrderId || 'N/A'})`;
                                                finalizeSuccess(finalDesc, `Successfully refunded $${refundAmount.toFixed(2)} via PayPal`);
                                            })
                                            .catch(finalizeFail);
                                        return;
                                    }

                                    if (pm === 'nets') {
                                        // Step 2 (provider): request refund from NETS (endpoint can be overridden by NETS_REFUND_PATH)
                                        netsSandbox
                                            .refundWalletRecharge(req, netsTxnRetrievalRef, refundAmount, out_request_no)
                                            .then((resp) => {
                                                const data = resp && resp.result && resp.result.data ? resp.result.data : null;
                                                const responseCode = data && data.response_code !== undefined ? String(data.response_code) : 'N/A';
                                                const txnStatus = data && data.txn_status !== undefined ? String(data.txn_status) : 'N/A';
                                                const finalDesc = `Refunded via NETS (${refundMarker}, txn_retrieval_ref:${netsTxnRetrievalRef}, refund_ref:${out_request_no}, response_code:${responseCode}, txn_status:${txnStatus})`;
                                                finalizeSuccess(finalDesc, `Successfully refunded $${refundAmount.toFixed(2)} via NETS`);
                                            })
                                            .catch(finalizeFail);
                                        return;
                                    }
                                });
                            },
                            connection
                        );
                    });
                });
            });
        });
    });
}

/**
 * User: View own refund requests
 */
function viewMyRefunds(req, res) {
    const user = req.session.user;

    Refund.getByUserId(user.id, (err, refunds) => {
        if (err) {
            console.error('Error fetching refunds:', err);
            req.flash('error', 'Failed to load refund requests');
            return res.redirect('/wallet');
        }

        res.render('myRefunds', {
            user,
            refunds: refunds || [],
            messages: req.flash()
        });
    });
}

/**
 * Admin: List all refund requests
 */
function viewAllRefunds(req, res) {
    const user = req.session.user;
    const status = req.query.status || null;

    Refund.getAll(status, (err, refunds) => {
        if (err) {
            console.error('Error fetching refunds:', err);
            req.flash('error', 'Failed to load refund requests');
            return res.redirect('/admin/dashboard');
        }

        res.render('adminRefunds', {
            user,
            refunds: refunds || [],
            currentStatus: status,
            messages: req.flash()
        });
    });
}

/**
 * Admin: View refund details
 */
function viewRefundDetails(req, res) {
    const user = req.session.user;
    const refundId = parseInt(req.params.id, 10);

    Refund.getById(refundId, (err, refund) => {
        if (err || !refund) {
            req.flash('error', 'Refund request not found');
            return res.redirect('/admin/refunds');
        }

        res.render('adminRefundDetails', {
            user,
            refund,
            messages: req.flash()
        });
    });
}

/**
 * Admin: Process refund (approve/reject)
 */
function processRefund(req, res) {
    const user = req.session.user;
    const refundId = parseInt(req.params.id, 10);
    const { action, admin_response } = req.body;

    if (!action || (action !== 'approve' && action !== 'reject')) {
        req.flash('error', 'Invalid action');
        return res.redirect(`/admin/refund/${refundId}`);
    }

    Refund.getById(refundId, (err, refund) => {
        if (err || !refund) {
            req.flash('error', 'Refund request not found');
            return res.redirect('/admin/refunds');
        }

        if (refund.status !== 'pending') {
            req.flash('error', 'This refund request has already been processed');
            return res.redirect(`/admin/refund/${refundId}`);
        }

        // Ensure refund amount is a number (DB may return it as string)
        let refundAmount = parseFloat(refund.amount);
        if (Number.isNaN(refundAmount)) refundAmount = 0;

        if (action === 'approve') {
                // Try to refund via Alipay if the original order payment used Alipay
                Transaction.listByOrder(refund.order_id, (txErr, transactions) => {
                    if (txErr) transactions = [];

                    const alipayTxn = (transactions || []).find(t => t.payment_method === 'alipay');
                    const paypalTxn = (transactions || []).find(t => t.payment_method === 'paypal');

                    // Helper to finalize approval and fallback to wallet refund
                    function finalizeWithWallet() {
                        Refund.approve(refundId, user.id, admin_response || 'Refund approved', (approveErr) => {
                            if (approveErr) {
                                console.error('Error approving refund:', approveErr);
                                req.flash('error', 'Failed to approve refund');
                                return res.redirect(`/admin/refund/${refundId}`);
                            }

                            Wallet.refund(refund.order_id, refund.user_id, refundAmount, (walletErr) => {
                                if (walletErr) {
                                    console.error('Error processing wallet refund:', walletErr);
                                    req.flash('error', 'Failed to process refund payment to wallet');
                                } else {
                                    req.flash('success', `Refund approved and $${refundAmount.toFixed(2)} refunded to user's wallet`);
                                }
                                return res.redirect('/admin/refunds');
                            });
                        });
                    }

                    // Prefer PayPal refund if PayPal transaction exists
                    if (paypalTxn) {
                        const pids = parsePayPalIdsFromTxn(paypalTxn);
                        const order_id = pids.order_id;
                        const capture_id = pids.capture_id;
                        if (capture_id) {
                            paypalSandbox.refundCapture(req, capture_id, refundAmount)
                            .then((resp) => {
                                const paypalRefundId = resp && resp.id ? resp.id : null;
                                Refund.approve(refundId, user.id, admin_response || 'Refund approved', (approveErr) => {
                                    if (approveErr) {
                                        console.error('Error approving refund after PayPal refund:', approveErr);
                                        req.flash('error', 'Failed to approve refund');
                                        return res.redirect(`/admin/refund/${refundId}`);
                                    }

                                    const description = `Refunded via PayPal (refund_id: ${paypalRefundId || 'N/A'}, capture_id: ${capture_id}, order_id: ${order_id || 'N/A'})`;
                                    Transaction.create({
                                        user_id: refund.user_id,
                                        order_id: refund.order_id,
                                        type: 'refund',
                                        payment_method: 'paypal',
                                        amount: refundAmount,
                                        balance_before: 0,
                                        balance_after: 0,
                                        description
                                    }, (createErr) => {
                                        if (createErr) console.error('Error recording refund transaction:', createErr);
                                        req.flash('success', `Refund approved and $${refundAmount.toFixed(2)} refunded via PayPal`);
                                        return res.redirect('/admin/refunds');
                                    });
                                });
                            })
                            .catch((e) => {
                                console.error('PayPal refund failed:', e && e.message ? e.message : e);
                                // fallback to try Alipay or wallet
                                // fallthrough to Alipay handling below
                                // continue
                            });
                            // if paypalTxn exists we attempted refund; return here to avoid double-processing by alipay branch
                            return;
                        }
                        // if no capture_id, fall back to alipay handling or wallet
                    }

                    if (!alipayTxn) {
                        // No Alipay transaction associated with this order -> fallback to wallet refund
                        return finalizeWithWallet();
                    }

                    // Try parse trade identifiers from transaction description
                    const ids = parseAlipayIdsFromTxn(alipayTxn);
                    const trade_no = ids.trade_no;
                    const out_trade_no = ids.out_trade_no;

                    if (!trade_no && !out_trade_no) {
                        // Cannot determine Alipay trade identifier - fallback
                        return finalizeWithWallet();
                    }

                    const out_request_no = `REFUND_${refundId}_${Date.now()}`;

                    const refundOptions = {
                        refund_amount: refundAmount,
                        refund_reason: admin_response || 'Refund processed by admin',
                        out_request_no
                    };
                    if (out_trade_no) refundOptions.out_trade_no = out_trade_no;
                    else if (trade_no) refundOptions.trade_no = trade_no;

                    alipaySandbox.refundTrade(req, refundOptions)
                    .then((resp) => {
                        // Alipay refund succeeded
                        Refund.approve(refundId, user.id, admin_response || 'Refund approved', (approveErr) => {
                            if (approveErr) {
                                console.error('Error approving refund after Alipay refund:', approveErr);
                                req.flash('error', 'Failed to approve refund');
                                return res.redirect(`/admin/refund/${refundId}`);
                            }

                            // Record a refund transaction (external refund via Alipay)
                            const description = `Refunded via Alipay (refund_fee: ${resp.refund_fee || refundAmount}, trade_no: ${trade_no || 'N/A'}, out_request_no: ${out_request_no})`;
                            Transaction.create({
                                user_id: refund.user_id,
                                order_id: refund.order_id,
                                type: 'refund',
                                payment_method: 'alipay',
                                amount: refundAmount,
                                balance_before: 0,
                                balance_after: 0,
                                description
                            }, (createErr) => {
                                if (createErr) console.error('Error recording refund transaction:', createErr);
                                req.flash('success', `Refund approved and $${refundAmount.toFixed(2)} refunded via Alipay`);
                                return res.redirect('/admin/refunds');
                            });
                        });
                    })
                    .catch((e) => {
                        console.error('Alipay refund failed:', e && e.message ? e.message : e);
                        // On failure fallback to wallet refund
                        finalizeWithWallet();
                    });
                });
        } else {
            Refund.reject(refundId, user.id, admin_response || 'Refund rejected', (rejectErr) => {
                if (rejectErr) {
                    console.error('Error rejecting refund:', rejectErr);
                    req.flash('error', 'Failed to reject refund');
                } else {
                    req.flash('success', 'Refund request rejected');
                }
                res.redirect('/admin/refunds');
            });
        }
    });
}

module.exports = {
    requestRefund,
    viewMyRefunds,
    viewAllRefunds,
    viewRefundDetails,
    processRefund
    , refundNow
    , refundTransaction
};

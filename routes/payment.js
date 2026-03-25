const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ===== 토스페이먼츠 결제 승인 =====
router.post('/confirm', async (req, res) => {
  try {
    const { paymentKey, orderId, amount } = req.body;

    // 예약 정보 확인
    const [reservations] = await db.query(
      'SELECT * FROM reservations WHERE reservation_no = ? AND status = "pending"',
      [orderId]
    );

    if (reservations.length === 0) {
      return res.status(404).json({ error: '예약 정보를 찾을 수 없습니다.' });
    }

    const reservation = reservations[0];

    // 금액 검증
    if (reservation.total_price !== amount) {
      return res.status(400).json({ error: '결제 금액이 일치하지 않습니다.' });
    }

    // 토스페이먼츠 결제 승인 API 호출
    const secretKey = process.env.TOSS_SECRET_KEY;
    const encryptedSecretKey = Buffer.from(secretKey + ':').toString('base64');

    const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encryptedSecretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ paymentKey, orderId, amount })
    });

    const paymentResult = await response.json();

    if (!response.ok) {
      console.error('토스 결제 승인 실패:', paymentResult);
      return res.status(400).json({
        error: paymentResult.message || '결제 승인에 실패했습니다.'
      });
    }

    // 결제 성공 → DB 업데이트
    await db.query(`
      UPDATE reservations SET
        status = 'paid',
        payment_method = ?,
        payment_key = ?,
        paid_at = NOW()
      WHERE reservation_no = ?
    `, [paymentResult.method, paymentKey, orderId]);

    res.json({
      message: '결제가 완료되었습니다.',
      reservation_no: orderId,
      amount: paymentResult.totalAmount,
      method: paymentResult.method,
      approved_at: paymentResult.approvedAt
    });

  } catch (err) {
    console.error('결제 승인 에러:', err);
    res.status(500).json({ error: '결제 처리 중 오류가 발생했습니다.' });
  }
});

// ===== 결제 취소(환불) =====
router.post('/cancel', async (req, res) => {
  try {
    const { reservation_no, cancel_reason } = req.body;

    const [reservations] = await db.query(
      'SELECT * FROM reservations WHERE reservation_no = ? AND status = "paid"',
      [reservation_no]
    );

    if (reservations.length === 0) {
      return res.status(404).json({ error: '결제된 예약을 찾을 수 없습니다.' });
    }

    const reservation = reservations[0];

    // 토스페이먼츠 결제 취소 API
    const secretKey = process.env.TOSS_SECRET_KEY;
    const encryptedSecretKey = Buffer.from(secretKey + ':').toString('base64');

    const response = await fetch(`https://api.tosspayments.com/v1/payments/${reservation.payment_key}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encryptedSecretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cancelReason: cancel_reason || '고객 요청 취소' })
    });

    const cancelResult = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: cancelResult.message || '취소 처리에 실패했습니다.' });
    }

    // DB 업데이트
    await db.query(`
      UPDATE reservations SET
        status = 'refunded',
        cancelled_at = NOW(),
        cancel_reason = ?
      WHERE reservation_no = ?
    `, [cancel_reason, reservation_no]);

    res.json({ message: '환불이 완료되었습니다.' });

  } catch (err) {
    console.error('결제 취소 에러:', err);
    res.status(500).json({ error: '환불 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

// ===== 객실 API =====

// 전체 객실 목록
router.get('/rooms', async (req, res) => {
  try {
    const [rooms] = await db.query(
      'SELECT * FROM rooms WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    res.json(rooms);
  } catch (err) {
    console.error('객실 조회 에러:', err);
    res.status(500).json({ error: '객실 정보를 불러올 수 없습니다.' });
  }
});

// 개별 객실 상세
router.get('/rooms/:slug', async (req, res) => {
  try {
    const [rooms] = await db.query(
      'SELECT * FROM rooms WHERE slug = ? AND is_active = 1',
      [req.params.slug]
    );
    if (rooms.length === 0) return res.status(404).json({ error: '객실을 찾을 수 없습니다.' });
    res.json(rooms[0]);
  } catch (err) {
    res.status(500).json({ error: '객실 정보를 불러올 수 없습니다.' });
  }
});

// ===== 예약 가능일 확인 =====
router.get('/availability', async (req, res) => {
  try {
    const { room_id, year, month } = req.query;
    if (!room_id || !year || !month) {
      return res.status(400).json({ error: 'room_id, year, month가 필요합니다.' });
    }

    // 해당 월의 예약된 날짜 조회
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    const [reservations] = await db.query(`
      SELECT check_in, check_out
      FROM reservations
      WHERE room_id = ?
        AND status IN ('confirmed', 'paid', 'checked_in')
        AND check_in <= ? AND check_out >= ?
    `, [room_id, endDate, startDate]);

    // 예약 불가 날짜 계산
    const bookedDates = new Set();
    reservations.forEach(r => {
      let current = new Date(r.check_in);
      const end = new Date(r.check_out);
      while (current < end) {
        bookedDates.add(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
    });

    // 시즌 정보 조회
    const [seasons] = await db.query(`
      SELECT * FROM seasons WHERE year = ? AND (
        (start_date <= ? AND end_date >= ?) OR
        (start_date <= ? AND end_date >= ?)
      )
    `, [year, endDate, startDate, startDate, startDate]);

    res.json({
      booked_dates: Array.from(bookedDates),
      seasons
    });
  } catch (err) {
    console.error('예약 가능일 조회 에러:', err);
    res.status(500).json({ error: '예약 가능일을 확인할 수 없습니다.' });
  }
});

// ===== 가격 계산 =====
router.post('/calculate-price', async (req, res) => {
  try {
    const { room_id, check_in, check_out, num_adults, num_children } = req.body;

    // 객실 정보
    const [rooms] = await db.query('SELECT * FROM rooms WHERE id = ?', [room_id]);
    if (rooms.length === 0) return res.status(404).json({ error: '객실을 찾을 수 없습니다.' });
    const room = rooms[0];

    // 날짜별 가격 계산
    let totalPrice = 0;
    let current = new Date(check_in);
    const end = new Date(check_out);
    const priceBreakdown = [];

    while (current < end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // 금, 토

      // 시즌 확인
      const [seasons] = await db.query(`
        SELECT type FROM seasons WHERE ? BETWEEN start_date AND end_date LIMIT 1
      `, [dateStr]);
      const isPeak = seasons.length > 0 && seasons[0].type !== 'off_peak';

      let dayPrice;
      if (isPeak && isWeekend) dayPrice = room.price_peak_weekend;
      else if (isPeak) dayPrice = room.price_peak_weekday;
      else if (isWeekend) dayPrice = room.price_weekend;
      else dayPrice = room.price_weekday;

      priceBreakdown.push({ date: dateStr, price: dayPrice, isWeekend, isPeak });
      totalPrice += dayPrice;
      current.setDate(current.getDate() + 1);
    }

    // 추가 인원 요금
    const totalGuests = (num_adults || 2) + (num_children || 0);
    let extraPersonFee = 0;
    if (totalGuests > room.capacity_min) {
      const extraPersons = Math.min(totalGuests - room.capacity_min, room.capacity_max - room.capacity_min);
      const nights = priceBreakdown.length;
      extraPersonFee = extraPersons * room.extra_person_fee * nights;
    }

    res.json({
      room_price: totalPrice,
      extra_person_fee: extraPersonFee,
      total_price: totalPrice + extraPersonFee,
      nights: priceBreakdown.length,
      breakdown: priceBreakdown
    });
  } catch (err) {
    console.error('가격 계산 에러:', err);
    res.status(500).json({ error: '가격 계산 중 오류가 발생했습니다.' });
  }
});

// ===== 예약 생성 =====
router.post('/reservations', async (req, res) => {
  try {
    const {
      room_id, guest_name, guest_phone, guest_email,
      check_in, check_out, num_adults, num_children,
      total_price, special_requests
    } = req.body;

    // 유효성 검사
    if (!room_id || !guest_name || !guest_phone || !check_in || !check_out || !total_price) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    // 중복 예약 확인
    const [conflicts] = await db.query(`
      SELECT id FROM reservations
      WHERE room_id = ?
        AND status IN ('confirmed', 'paid', 'checked_in')
        AND check_in < ? AND check_out > ?
    `, [room_id, check_out, check_in]);

    if (conflicts.length > 0) {
      return res.status(409).json({ error: '해당 날짜에 이미 예약이 있습니다.' });
    }

    // 예약번호 생성 (JM + 날짜 + 4자리)
    const now = new Date();
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
    const randomSuffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const reservationNo = `JM${dateStr}${randomSuffix}`;

    const [result] = await db.query(`
      INSERT INTO reservations
        (reservation_no, room_id, guest_name, guest_phone, guest_email,
         check_in, check_out, num_adults, num_children, total_price, special_requests, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [reservationNo, room_id, guest_name, guest_phone, guest_email,
        check_in, check_out, num_adults || 2, num_children || 0,
        total_price, special_requests]);

    res.status(201).json({
      message: '예약이 접수되었습니다.',
      reservation_no: reservationNo,
      reservation_id: result.insertId
    });
  } catch (err) {
    console.error('예약 생성 에러:', err);
    res.status(500).json({ error: '예약 처리 중 오류가 발생했습니다.' });
  }
});

// ===== 예약 조회 (예약번호 + 전화번호) =====
router.get('/reservations/lookup', async (req, res) => {
  try {
    const { reservation_no, phone } = req.query;
    const [reservations] = await db.query(`
      SELECT r.*, rm.name as room_name
      FROM reservations r
      JOIN rooms rm ON r.room_id = rm.id
      WHERE r.reservation_no = ? AND r.guest_phone = ?
    `, [reservation_no, phone]);

    if (reservations.length === 0) {
      return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
    }
    res.json(reservations[0]);
  } catch (err) {
    res.status(500).json({ error: '예약 조회 중 오류가 발생했습니다.' });
  }
});

// ===== 문의 접수 =====
router.post('/inquiries', async (req, res) => {
  try {
    const { name, phone, email, check_in, check_out, num_guests, room_preference, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: '이름과 연락처는 필수입니다.' });
    }

    await db.query(`
      INSERT INTO inquiries (name, phone, email, check_in, check_out, num_guests, room_preference, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, phone, email, check_in, check_out, num_guests, room_preference, message]);

    res.status(201).json({ message: '문의가 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.' });
  } catch (err) {
    console.error('문의 접수 에러:', err);
    res.status(500).json({ error: '문의 접수 중 오류가 발생했습니다.' });
  }
});

// ===== 갤러리 =====
router.get('/gallery', async (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT * FROM gallery_images WHERE is_active = 1';
    const params = [];

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY sort_order ASC, created_at DESC';

    const [images] = await db.query(query, params);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: '갤러리를 불러올 수 없습니다.' });
  }
});

// ===== 사이트 설정 =====
router.get('/settings', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM site_settings');
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: '설정을 불러올 수 없습니다.' });
  }
});

module.exports = router;

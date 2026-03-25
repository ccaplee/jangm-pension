const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

// 이미지 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeValid = allowed.test(file.mimetype);
    cb(null, extValid && mimeValid);
  }
});

// ===== 로그인 =====
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);

    if (admins.length === 0) {
      return res.render('admin/login', { error: '아이디 또는 비밀번호가 틀렸습니다.' });
    }

    const admin = admins[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.render('admin/login', { error: '아이디 또는 비밀번호가 틀렸습니다.' });
    }

    // 로그인 성공
    req.session.admin = { id: admin.id, username: admin.username, name: admin.name, role: admin.role };
    await db.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);

    res.redirect('/admin');
  } catch (err) {
    console.error('로그인 에러:', err);
    res.render('admin/login', { error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ===== 대시보드 =====
router.get('/', requireAdmin, async (req, res) => {
  try {
    // 통계 조회
    const [todayReservations] = await db.query(`
      SELECT COUNT(*) as count FROM reservations WHERE DATE(created_at) = CURDATE()
    `);
    const [pendingReservations] = await db.query(`
      SELECT COUNT(*) as count FROM reservations WHERE status = 'pending'
    `);
    const [paidReservations] = await db.query(`
      SELECT COUNT(*) as count FROM reservations WHERE status = 'paid'
    `);
    const [unreadInquiries] = await db.query(`
      SELECT COUNT(*) as count FROM inquiries WHERE is_read = 0
    `);
    const [recentReservations] = await db.query(`
      SELECT r.*, rm.name as room_name
      FROM reservations r JOIN rooms rm ON r.room_id = rm.id
      ORDER BY r.created_at DESC LIMIT 10
    `);
    const [recentInquiries] = await db.query(`
      SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 5
    `);
    const [monthlyRevenue] = await db.query(`
      SELECT COALESCE(SUM(total_price), 0) as total
      FROM reservations
      WHERE status IN ('paid', 'checked_in', 'checked_out')
        AND MONTH(paid_at) = MONTH(CURDATE()) AND YEAR(paid_at) = YEAR(CURDATE())
    `);

    res.render('admin/dashboard', {
      admin: req.session.admin,
      stats: {
        todayReservations: todayReservations[0].count,
        pendingReservations: pendingReservations[0].count,
        paidReservations: paidReservations[0].count,
        unreadInquiries: unreadInquiries[0].count,
        monthlyRevenue: monthlyRevenue[0].total
      },
      recentReservations,
      recentInquiries
    });
  } catch (err) {
    console.error('대시보드 에러:', err);
    res.status(500).send('대시보드 로드 실패');
  }
});

// ===== 예약 관리 =====
router.get('/reservations', requireAdmin, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params = [];
    if (status) { whereClause += ' AND r.status = ?'; params.push(status); }

    const [reservations] = await db.query(`
      SELECT r.*, rm.name as room_name
      FROM reservations r JOIN rooms rm ON r.room_id = rm.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM reservations r WHERE ${whereClause}`, params
    );

    res.render('admin/reservations', {
      admin: req.session.admin,
      reservations,
      currentStatus: status || '',
      pagination: {
        page: parseInt(page),
        totalPages: Math.ceil(countResult[0].total / limit),
        total: countResult[0].total
      }
    });
  } catch (err) {
    console.error('예약 목록 에러:', err);
    res.status(500).send('예약 목록 로드 실패');
  }
});

// 예약 상태 변경
router.post('/reservations/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'paid', 'checked_in', 'checked_out', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    }

    await db.query('UPDATE reservations SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: '상태가 변경되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: '상태 변경 실패' });
  }
});

// ===== 객실 관리 =====
router.get('/rooms', requireAdmin, async (req, res) => {
  try {
    const [rooms] = await db.query('SELECT * FROM rooms ORDER BY sort_order ASC');
    res.render('admin/rooms', { admin: req.session.admin, rooms });
  } catch (err) {
    res.status(500).send('객실 목록 로드 실패');
  }
});

router.post('/rooms/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, short_desc, capacity_min, capacity_max, area_sqm,
            price_weekday, price_weekend, price_peak_weekday, price_peak_weekend,
            extra_person_fee, is_active } = req.body;

    await db.query(`
      UPDATE rooms SET name=?, description=?, short_desc=?, capacity_min=?, capacity_max=?,
        area_sqm=?, price_weekday=?, price_weekend=?, price_peak_weekday=?, price_peak_weekend=?,
        extra_person_fee=?, is_active=?
      WHERE id=?
    `, [name, description, short_desc, capacity_min, capacity_max, area_sqm,
        price_weekday, price_weekend, price_peak_weekday, price_peak_weekend,
        extra_person_fee, is_active ? 1 : 0, req.params.id]);

    res.redirect('/admin/rooms');
  } catch (err) {
    res.status(500).send('객실 수정 실패');
  }
});

// ===== 문의 관리 =====
router.get('/inquiries', requireAdmin, async (req, res) => {
  try {
    const [inquiries] = await db.query('SELECT * FROM inquiries ORDER BY created_at DESC');
    res.render('admin/inquiries', { admin: req.session.admin, inquiries });
  } catch (err) {
    res.status(500).send('문의 목록 로드 실패');
  }
});

router.post('/inquiries/:id/read', requireAdmin, async (req, res) => {
  try {
    await db.query('UPDATE inquiries SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: '읽음 처리 완료' });
  } catch (err) {
    res.status(500).json({ error: '처리 실패' });
  }
});

// ===== 갤러리 관리 =====
router.get('/gallery', requireAdmin, async (req, res) => {
  try {
    const [images] = await db.query('SELECT * FROM gallery_images ORDER BY sort_order ASC, created_at DESC');
    res.render('admin/gallery', { admin: req.session.admin, images });
  } catch (err) {
    res.status(500).send('갤러리 로드 실패');
  }
});

router.post('/gallery/upload', requireAdmin, upload.array('images', 10), async (req, res) => {
  try {
    const { category, title } = req.body;
    for (const file of req.files) {
      // 이미지 리사이즈 (최대 1920px)
      const resizedPath = file.path.replace(/(\.[^.]+)$/, '_resized$1');
      await sharp(file.path)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(resizedPath);

      // 썸네일 생성
      const thumbPath = file.path.replace(/(\.[^.]+)$/, '_thumb$1');
      await sharp(file.path)
        .resize(400, 300, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      await db.query(`
        INSERT INTO gallery_images (title, file_path, category)
        VALUES (?, ?, ?)
      `, [title || file.originalname, `/uploads/${path.basename(resizedPath)}`, category || 'etc']);
    }
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('갤러리 업로드 에러:', err);
    res.status(500).send('업로드 실패');
  }
});

router.post('/gallery/:id/delete', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM gallery_images WHERE id = ?', [req.params.id]);
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ error: '삭제 실패' });
  }
});

// ===== 비밀번호 변경 =====
router.post('/change-password', requireAdmin, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const [admins] = await db.query('SELECT * FROM admins WHERE id = ?', [req.session.admin.id]);
    const valid = await bcrypt.compare(current_password, admins[0].password_hash);
    if (!valid) return res.status(400).json({ error: '현재 비밀번호가 틀렸습니다.' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, req.session.admin.id]);
    res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: '비밀번호 변경 실패' });
  }
});

module.exports = router;

-- ============================================
-- 장령산계곡산장 데이터베이스 스키마
-- ============================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- 객실 테이블
CREATE TABLE IF NOT EXISTS rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '객실명',
    slug VARCHAR(100) NOT NULL UNIQUE COMMENT 'URL용 슬러그',
    description TEXT COMMENT '객실 설명',
    short_desc VARCHAR(255) COMMENT '짧은 설명',
    capacity_min INT DEFAULT 2 COMMENT '기준 인원',
    capacity_max INT DEFAULT 4 COMMENT '최대 인원',
    area_sqm DECIMAL(5,1) COMMENT '면적(㎡)',
    price_weekday INT NOT NULL COMMENT '비수기 주중 가격',
    price_weekend INT NOT NULL COMMENT '비수기 주말 가격',
    price_peak_weekday INT NOT NULL COMMENT '성수기 주중 가격',
    price_peak_weekend INT NOT NULL COMMENT '성수기 주말 가격',
    extra_person_fee INT DEFAULT 10000 COMMENT '추가 인원당 요금',
    amenities JSON COMMENT '편의시설 목록',
    thumbnail VARCHAR(500) COMMENT '대표 이미지 URL',
    images JSON COMMENT '갤러리 이미지 URL 목록',
    is_active TINYINT(1) DEFAULT 1 COMMENT '활성 여부',
    sort_order INT DEFAULT 0 COMMENT '정렬 순서',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 예약 테이블
CREATE TABLE IF NOT EXISTS reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_no VARCHAR(20) NOT NULL UNIQUE COMMENT '예약번호',
    room_id INT NOT NULL,
    guest_name VARCHAR(50) NOT NULL COMMENT '예약자 이름',
    guest_phone VARCHAR(20) NOT NULL COMMENT '연락처',
    guest_email VARCHAR(100) COMMENT '이메일',
    check_in DATE NOT NULL COMMENT '체크인 날짜',
    check_out DATE NOT NULL COMMENT '체크아웃 날짜',
    nights INT GENERATED ALWAYS AS (DATEDIFF(check_out, check_in)) STORED COMMENT '숙박일수',
    num_adults INT DEFAULT 2 COMMENT '성인 인원',
    num_children INT DEFAULT 0 COMMENT '어린이 인원',
    total_price INT NOT NULL COMMENT '총 결제 금액',
    special_requests TEXT COMMENT '특별 요청사항',
    status ENUM('pending', 'confirmed', 'paid', 'checked_in', 'checked_out', 'cancelled', 'refunded') DEFAULT 'pending' COMMENT '예약 상태',
    payment_method VARCHAR(50) COMMENT '결제 수단',
    payment_key VARCHAR(200) COMMENT '토스페이먼츠 결제키',
    paid_at TIMESTAMP NULL COMMENT '결제 일시',
    cancelled_at TIMESTAMP NULL COMMENT '취소 일시',
    cancel_reason TEXT COMMENT '취소 사유',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    INDEX idx_checkin (check_in),
    INDEX idx_checkout (check_out),
    INDEX idx_status (status),
    INDEX idx_reservation_no (reservation_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 문의 테이블
CREATE TABLE IF NOT EXISTS inquiries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    check_in DATE,
    check_out DATE,
    num_guests INT,
    room_preference VARCHAR(100),
    message TEXT,
    is_read TINYINT(1) DEFAULT 0 COMMENT '읽음 여부',
    admin_memo TEXT COMMENT '관리자 메모',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 갤러리 이미지 테이블
CREATE TABLE IF NOT EXISTS gallery_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200),
    description TEXT,
    file_path VARCHAR(500) NOT NULL,
    category ENUM('exterior', 'interior', 'valley', 'bbq', 'scenery', 'etc') DEFAULT 'etc',
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 시즌 설정 테이블
CREATE TABLE IF NOT EXISTS seasons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL COMMENT '시즌명',
    type ENUM('off_peak', 'peak', 'super_peak') NOT NULL COMMENT '시즌 유형',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    year INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 관리자 테이블
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL,
    role ENUM('super_admin', 'admin') DEFAULT 'admin',
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 사이트 설정 테이블
CREATE TABLE IF NOT EXISTS site_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 초기 데이터 삽입
-- ============================================

-- 기본 관리자 (비밀번호: admin1234 → bcrypt 해시)
INSERT INTO admins (username, password_hash, name, role) VALUES
('admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '관리자', 'super_admin')
ON DUPLICATE KEY UPDATE username=username;

-- 객실 초기 데이터
INSERT INTO rooms (name, slug, description, short_desc, capacity_min, capacity_max, area_sqm, price_weekday, price_weekend, price_peak_weekday, price_peak_weekend, amenities, sort_order) VALUES
(
    '계곡뷰 A동',
    'valley-view-a',
    '계곡이 바로 보이는 독채형 객실입니다. 탁 트인 계곡 전망과 함께 자연 속에서 편안한 휴식을 즐기실 수 있습니다. 주방, 화장실, 에어컨, TV 등 기본 시설이 완비되어 있습니다.',
    '계곡이 바로 보이는 독채형 객실로 자연과 하나가 되는 경험',
    2, 4, 33.0,
    120000, 150000, 180000, 220000,
    '["주방", "에어컨", "TV", "WiFi", "냉장고", "전자레인지", "취사도구", "침구류"]',
    1
),
(
    '숲속 B동',
    'forest-b',
    '울창한 숲에 둘러싸인 아늑한 공간입니다. 나무 향 가득한 테라스에서 바베큐를 즐기며 힐링하실 수 있습니다. 넓은 거실과 방 2개로 가족 단위에 적합합니다.',
    '울창한 숲에 둘러싸인 아늑한 공간에서의 힐링 스테이',
    4, 6, 49.0,
    170000, 200000, 250000, 300000,
    '["주방", "에어컨", "TV", "WiFi", "냉장고", "전자레인지", "취사도구", "침구류", "테라스"]',
    2
),
(
    '단체동 C',
    'group-c',
    '가족 모임, 동창회, 단체 행사에 적합한 넓은 공간입니다. 큰 거실과 방 3개, 넓은 주방을 갖추고 있어 여러 명이 함께 편하게 지내실 수 있습니다.',
    '가족 모임, 단체 행사에 적합한 넓은 공간과 시설',
    8, 20, 82.0,
    300000, 350000, 400000, 500000,
    '["주방", "에어컨", "TV", "WiFi", "냉장고", "전자레인지", "취사도구", "침구류", "테라스", "노래방기기"]',
    3
);

-- 시즌 설정 (2026년)
INSERT INTO seasons (name, type, start_date, end_date, year) VALUES
('봄 비수기', 'off_peak', '2026-03-01', '2026-06-30', 2026),
('여름 성수기', 'peak', '2026-07-01', '2026-08-31', 2026),
('가을 비수기', 'off_peak', '2026-09-01', '2026-11-30', 2026),
('겨울 비수기', 'off_peak', '2026-12-01', '2026-12-22', 2026),
('연말 성수기', 'super_peak', '2026-12-23', '2026-12-31', 2026);

-- 사이트 설정
INSERT INTO site_settings (setting_key, setting_value) VALUES
('site_name', '장령산계곡산장'),
('phone', '043-733-9615'),
('address', '충청북도 옥천군 군서면 장령산로 315-27'),
('check_in_time', '15:00'),
('check_out_time', '11:00'),
('bbq_price', '20000'),
('naver_cafe', 'https://cafe.naver.com/jrmountain'),
('bank_name', '농협'),
('bank_account', '000-0000-0000-00'),
('bank_holder', '장령산계곡산장'),
('toss_client_key', ''),
('toss_secret_key', '')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);

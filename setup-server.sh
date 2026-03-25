#!/bin/bash
# ============================================
# 장령산계곡산장 서버 초기 설정 스크립트
# Ubuntu 22.04 LTS 전용
# ============================================

set -e

echo "=========================================="
echo "  장령산계곡산장 서버 설정을 시작합니다"
echo "=========================================="

# 1. 시스템 업데이트
echo "[1/7] 시스템 업데이트 중..."
sudo apt update && sudo apt upgrade -y

# 2. Nginx 설치
echo "[2/7] Nginx 설치 중..."
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# 3. Node.js 20 LTS 설치
echo "[3/7] Node.js 20 LTS 설치 중..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
echo "Node.js 버전: $(node -v)"
echo "npm 버전: $(npm -v)"

# 4. MySQL 8 설치
echo "[4/7] MySQL 8 설치 중..."
sudo apt install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql

# MySQL 보안 설정
echo ""
echo "============================================"
echo "  MySQL root 비밀번호를 설정합니다"
echo "============================================"
read -sp "MySQL root 비밀번호 입력: " MYSQL_ROOT_PW
echo ""

sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PW}';"

# 애플리케이션용 DB와 유저 생성
DB_NAME="jangm_pension"
DB_USER="jangm_user"
read -sp "DB 유저(${DB_USER}) 비밀번호 입력: " DB_PW
echo ""

sudo mysql -u root -p"${MYSQL_ROOT_PW}" -e "
  CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PW}';
  GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
  FLUSH PRIVILEGES;
"
echo "데이터베이스 '${DB_NAME}' 생성 완료!"

# 5. PM2 설치 (Node.js 프로세스 매니저)
echo "[5/7] PM2 설치 중..."
sudo npm install -g pm2
pm2 startup systemd -u $USER --hp /home/$USER

# 6. Certbot (Let's Encrypt SSL) 설치
echo "[6/7] Certbot 설치 중..."
sudo apt install -y certbot python3-certbot-nginx

# 7. 방화벽 설정
echo "[7/7] 방화벽(UFW) 설정 중..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# 앱 디렉토리 생성
APP_DIR="/var/www/jangm-pension"
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR

echo ""
echo "=========================================="
echo "  서버 초기 설정 완료!"
echo "=========================================="
echo ""
echo "다음 정보를 .env 파일에 설정하세요:"
echo "  DB_HOST=localhost"
echo "  DB_USER=${DB_USER}"
echo "  DB_PASSWORD=(입력한 비밀번호)"
echo "  DB_NAME=${DB_NAME}"
echo ""
echo "다음 단계:"
echo "  1. 프로젝트 파일을 ${APP_DIR}에 복사"
echo "  2. cd ${APP_DIR} && npm install"
echo "  3. .env 파일 설정"
echo "  4. mysql -u ${DB_USER} -p ${DB_NAME} < sql/init.sql"
echo "  5. Nginx 설정: sudo cp nginx/jangm.conf /etc/nginx/sites-available/"
echo "  6. sudo ln -s /etc/nginx/sites-available/jangm.conf /etc/nginx/sites-enabled/"
echo "  7. sudo nginx -t && sudo systemctl reload nginx"
echo "  8. SSL 인증서: sudo certbot --nginx -d jangm.co.kr -d www.jangm.co.kr"
echo "  9. pm2 start server.js --name jangm-pension"
echo "=========================================="

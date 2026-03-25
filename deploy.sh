#!/bin/bash
# ============================================
# 장령산계곡산장 배포 스크립트
# 서버에서 실행: bash deploy.sh
# ============================================

set -e

APP_DIR="/var/www/jangm-pension"
DOMAIN="www.jangm.co.kr"

echo "=========================================="
echo "  장령산계곡산장 배포를 시작합니다"
echo "=========================================="

# 1. 프로젝트 파일 복사
echo "[1/6] 프로젝트 파일 배포 중..."
sudo mkdir -p $APP_DIR/uploads
sudo cp -r ./* $APP_DIR/
sudo chown -R $USER:$USER $APP_DIR

# 2. .env 파일 설정
if [ ! -f "$APP_DIR/.env" ]; then
  echo "[2/6] .env 파일 생성 중..."
  cp $APP_DIR/.env.example $APP_DIR/.env
  echo ""
  echo "⚠️  중요: $APP_DIR/.env 파일을 열어서 설정값을 입력해주세요!"
  echo "   nano $APP_DIR/.env"
  echo ""
  read -p "설정을 완료했으면 Enter를 누르세요..."
else
  echo "[2/6] .env 파일이 이미 존재합니다."
fi

# 3. npm 패키지 설치
echo "[3/6] npm 패키지 설치 중..."
cd $APP_DIR
npm install --production

# 4. DB 초기화
echo "[4/6] 데이터베이스 초기화..."
read -p "DB를 초기화하시겠습니까? (최초 배포 시만 y) [y/N]: " INIT_DB
if [ "$INIT_DB" = "y" ] || [ "$INIT_DB" = "Y" ]; then
  source $APP_DIR/.env
  mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < $APP_DIR/sql/init.sql
  echo "DB 초기화 완료!"

  # 관리자 비밀번호 설정
  echo ""
  echo "기본 관리자 계정: admin / admin1234"
  echo "⚠️  로그인 후 반드시 비밀번호를 변경하세요!"
fi

# 5. Nginx 설정
echo "[5/6] Nginx 설정 중..."
sudo cp $APP_DIR/nginx/jangm.conf /etc/nginx/sites-available/jangm.conf
sudo ln -sf /etc/nginx/sites-available/jangm.conf /etc/nginx/sites-enabled/jangm.conf
sudo rm -f /etc/nginx/sites-enabled/default

# SSL 인증서 (먼저 HTTP로 Nginx 시작 후)
echo ""
read -p "SSL 인증서를 발급하시겠습니까? (도메인 DNS 설정 완료 후 y) [y/N]: " SETUP_SSL
if [ "$SETUP_SSL" = "y" ] || [ "$SETUP_SSL" = "Y" ]; then
  # 임시로 HTTP만 설정
  sudo tee /etc/nginx/sites-available/jangm-temp.conf > /dev/null <<TMPEOF
server {
    listen 80;
    server_name jangm.co.kr www.jangm.co.kr;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
TMPEOF
  sudo ln -sf /etc/nginx/sites-available/jangm-temp.conf /etc/nginx/sites-enabled/jangm.conf
  sudo nginx -t && sudo systemctl reload nginx

  sudo certbot --nginx -d jangm.co.kr -d www.jangm.co.kr

  # SSL 발급 후 정식 설정 적용
  sudo cp $APP_DIR/nginx/jangm.conf /etc/nginx/sites-available/jangm.conf
  sudo ln -sf /etc/nginx/sites-available/jangm.conf /etc/nginx/sites-enabled/jangm.conf
  sudo rm -f /etc/nginx/sites-available/jangm-temp.conf
fi

sudo nginx -t && sudo systemctl reload nginx

# 6. PM2로 앱 시작
echo "[6/6] Node.js 앱 시작 중..."
cd $APP_DIR
pm2 delete jangm-pension 2>/dev/null || true
pm2 start server.js --name jangm-pension --env production
pm2 save

echo ""
echo "=========================================="
echo "  🎉 배포 완료!"
echo "=========================================="
echo ""
echo "  🌐 사이트: https://${DOMAIN}"
echo "  🔧 관리자: https://${DOMAIN}/admin"
echo "  📋 관리자 계정: admin / admin1234"
echo ""
echo "  유용한 명령어:"
echo "    pm2 logs jangm-pension    # 로그 확인"
echo "    pm2 restart jangm-pension # 앱 재시작"
echo "    pm2 monit                 # 모니터링"
echo "=========================================="

// 관리자 인증 미들웨어
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  res.redirect('/admin/login');
}

function requireSuperAdmin(req, res, next) {
  if (req.session?.admin?.role === 'super_admin') {
    return next();
  }
  res.status(403).json({ error: '권한이 없습니다.' });
}

module.exports = { requireAdmin, requireSuperAdmin };

'use strict';

const store = require('./store');

function auth(requiredRoles) {
  return function (req, res, next) {
    const username = req.headers['x-user'];
    if (!username) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: '未提供用户标识，请在 X-User 请求头中提供用户名' });
    }

    const user = store.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: `用户 ${username} 不存在` });
    }

    if (requiredRoles && !requiredRoles.includes(user.role)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '权限不足', requiredRoles });
    }

    req.user = user;
    next();
  };
}

module.exports = { auth };

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: '接口不存在'
  });
}

function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || '服务器内部错误';

  res.status(statusCode).json({
    success: false,
    error: errorMessage
  });
}

module.exports = { notFoundHandler, errorHandler };

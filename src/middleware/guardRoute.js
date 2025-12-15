module.exports = function guardRoute(guardFn) {
  return function (req, res, next) {
    try {
      guardFn(req.account);
      next();
    } catch (e) {
      res.status(e.status || 403).json({ message: e.message });
    }
  };
};

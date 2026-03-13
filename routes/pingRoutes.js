module.exports = (app) => {
  app.get('/api/ping', (req, res) => res.status(200).send('Tao còn sống!'));
};

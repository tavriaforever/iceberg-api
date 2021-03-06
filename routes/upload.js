const express = require('express');

const router = express.Router();
const passport = require('passport');
const status = require('../libs/auth/status');
const postProccess = require('../libs/imagePostProcces');
const gcs = require('../libs/gcUpload');
const Multer = require('multer');

const multer = new Multer({
  storage: Multer.MemoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.post('/', // passport.authenticate('bearer', { session: false }), status.accountTypeMiddleware,
  multer.single('photo'), (req, res, next) =>
    postProccess.resize(req.file, 100)
      .then(resizedImage100 => gcs.upload(resizedImage100, '_islands100')
        .then(link100 => gcs.upload(req.file)
          .then(link1000 => postProccess.average(req.file)
            .then(average => res.json({ fileName: link1000, fileNameIslands100: link100, mainColor: average })))))
      .catch(err => next(err)));

module.exports = router;

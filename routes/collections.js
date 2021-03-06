const express = require('express');

const router = express.Router();

const passport = require('passport');

const Collection = require('.././dataModels/collection').Collection;
const User = require('.././dataModels/user').User;
const Link = require('.././dataModels/link').Link;
const mongoose = require('mongoose');

const validation = require('./validation/validator');
const validationParams = require('./validation/params');
const error = require('rest-api-errors');
const status = require('../libs/auth/status');
const _ = require('lodash');

router.all('/*', passport.authenticate('bearer', { session: false }));

router.get('/:collectionId', (req, res, next) => {
  User.findOne({ userId: req.user.userId })
    .then(user => Collection.aggregate([
      {
        $match: { _id: mongoose.Types.ObjectId(req.params.collectionId) },
      },
      {
        $unwind: { path: '$links', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup:
        {
          from: 'links',
          localField: 'links',
          foreignField: '_id',
          as: 'link',
        },
      },
      {
        $unwind: { path: '$link', preserveNullAndEmptyArrays: true },
      },
      {
        $unwind: { path: '$tags', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup:
        {
          from: 'tags',
          localField: 'tags',
          foreignField: '_id',
          as: 'tag',
        },
      },
      {
        $unwind: { path: '$tag', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup:
        {
          from: 'users',
          localField: 'authorId',
          foreignField: 'userId',
          as: 'author',
        },
      },
      {
        $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
      },
      {
        $addFields: {
          'link.savedTimesCount': { $cond: { if: { $isArray: '$link.usersSaved' }, then: { $size: '$link.usersSaved' }, else: 0 } },
          'link.saved': { $cond: { if: { $and: [{ $isArray: '$link.usersSaved' }, { $in: [req.user.userId, '$link.usersSaved'] }] }, then: true, else: false } },
          'link.liked': { $cond: { if: { $and: [{ $isArray: '$link.usersLiked' }, { $in: [req.user.userId, '$link.usersLiked'] }] }, then: true, else: false } },
          'link.opened': { $cond: { if: { $in: ['$link._id',
            user.metrics.map(metricElem => (metricElem.opened ? metricElem.contentId : undefined)).filter(Boolean)] },
          then: true,
          else: false } },
        },
      },
      {
        $sort: { 'link.added': -1 },
      },
      {
        $group: {
          _id: '$_id',
          name: { $first: '$name' },
          author: { $first: '$author' },
          photo: { $first: '$photo' },
          color: { $first: '$color' },
          links: { $addToSet: '$link' },
          tags: { $addToSet: '$tag' },
          description: { $first: '$description' },
          usersSaved: { $first: '$usersSaved' },
          closed: { $first: '$closed' },
        },
      },
      {
        $unwind: { path: '$links', preserveNullAndEmptyArrays: true },
      },
      {
        $lookup:
        {
          from: 'users',
          localField: 'links.userAdded',
          foreignField: 'userId',
          as: 'links.userAdded',
        },
      },
      {
        $unwind: { path: '$links.userAdded', preserveNullAndEmptyArrays: true },
      },
      {
        $group: {
          _id: '$_id',
          name: { $first: '$name' },
          author: { $first: '$author' },
          photo: { $first: '$photo' },
          color: { $first: '$color' },
          links: { $addToSet: '$links' },
          tags: { $first: '$tags' },
          description: { $first: '$description' },
          usersSaved: { $first: '$usersSaved' },
          closed: { $first: '$closed' },
        },
      },
      { $addFields: { links: {
        $filter: {
          input: '$links',
          as: 'link',
          cond: { $ifNull: ['$$link._id', false] } },
      } },
      },
      {
        $addFields: {
          saved: { $cond: { if: { $and: [{ $isArray: '$usersSaved' }, { $in: [req.user.userId, '$usersSaved'] }] }, then: true, else: false } },
          savedTimesCount: { $size: '$usersSaved' },
        },
      },
      {
        $project: {
          usersSaved: 0,
          author: {
            salt: 0,
            _id: 0,
            hash: 0,
            banned: 0,
            created: 0,
            bookmarks: 0,
            metrics: 0,
            vkToken: 0,
            fbToken: 0,
            yaToken: 0,
            socialLink: 0,
            sex: 0,
            __v: 0,
          },
          metrics: {
            contentId: 0,
          },
          links: {
            usersSaved: 0,
            usersLiked: 0,
            userAdded: {
              _id: 0,
              hash: 0,
              salt: 0,
              vkToken: 0,
              fbToken: 0,
              yaToken: 0,
              socialLink: 0,
              sex: 0,
              banned: 0,
              created: 0,
              accType: 0,
              description: 0,
              bookmarks: 0,
              metrics: 0,
              __v: 0,
            },
            __v: 0,
          },
          tags: {
            textColor: 0,
            color: 0,
            __v: 0,
          },
        },
      },
    ])
      .then((returnedCollection) => {
        if (!returnedCollection || !returnedCollection.length ||
           (returnedCollection[0].author.userId !== req.user.userId && returnedCollection[0].closed)) {
          throw new error.NotFound('NO_COLLECTIONS_ERR', 'Collection not found, or maybe it is private');
        } else {
          const collection = returnedCollection[0];
          res.json({ collection });
        }
      })
      .catch(err => next(err)));
});

router.post('/', status.accountTypeMiddleware, validation(validationParams.collection), (req, res, next) => {
  req.body.authorId = req.user.userId;
  req.body.tags = req.body.tags.map(tag => mongoose.Types.ObjectId(tag));
  const newCollection = new Collection(req.body);
  newCollection.save()
    .then(collection => User.findOneAndUpdate({ userId: req.user.userId },
      { $push: { bookmarks: { bookmarkId: collection._id, type: 'createdCollections' } } })
      .then((user) => {
        if (!user) {
          throw new error.NotFound('NO_USER_ERR', 'User not found');
        }
        res.json({ collection });
      }))
    .catch(err => next(err));
});

router.post('/addLink/:collectionId/:linkId', validation(validationParams.description),
  status.accountTypeMiddleware, (req, res, next) => {
    Collection.findOneAndUpdate({ _id: mongoose.Types.ObjectId(req.params.collectionId), authorId: req.user.userId },
      { $addToSet: { links: mongoose.Types.ObjectId(req.params.linkId) } })
      .then((collection) => {
        if (!collection) {
          throw new error.NotFound('NO_COLLECTION_ERR', 'Collection not found, cannot update this collection');
        }
        if (req.body.description) {
          return Link.findOneAndUpdate({ _id: mongoose.Types.ObjectId(req.params.linkId) }, { description: req.body.description })
            .then((link) => {
              if (!link) {
                throw new error.NotFound('NO_LINK_ERR', 'Link not found, cannot update this link description');
              }
              res.end();
            });
        }
        return res.end();
      })
      .catch(err => next(err));
  });

router.put('/open/:collectionId', validation(validationParams.readCollection), (req, res, next) => {
  User.findOne({ userId: req.user.userId })
    .then((user) => {
      if (!user) {
        throw new error.NotFound('METRICS_OPEN_ERR', 'Cannot mark this collection as opened');
      }
      const contentId = mongoose.Types.ObjectId(req.params.collectionId);
      if (!_.find(user.metrics, ['contentId', contentId])) {
        user.metrics.push({ contentId, opened: true, type: 'collection' });
      }
      return user.save()
        .then(() => res.end());
    })
    .catch(err => next(err));
});


module.exports = router;

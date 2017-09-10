const express = require('express');

const router = express.Router();
const User = require('.././dataModels/user').User;
const Collection = require('.././dataModels/collection').Collection;
const Link = require('.././dataModels/link').Link;
const mongoose = require('mongoose');
const passport = require('passport');
const validation = require('./validation/validator');
const validationParams = require('./validation/params');
const error = require('rest-api-errors');
const status = require('../libs/auth/status');
const social = require('../libs/social');


router.all('/*', passport.authenticate('bearer', { session: false }));

router.get('/:userId?', (req, res, next) => {
  User.findOne({ userId: req.params.userId ? req.params.userId : req.user.userId },
    { hash: 0, salt: 0, id: 0, __v: 0, createdCollections: 0, personalTags: 0, savedCollections: 0, addedLinks: 0, savedLinks: 0 })
    .then(user => (!user ? new error.NotFound('NO_USER_ERR', 'User cannot be found') : user))
    .then(user => res.json(user))
    .catch(err => next(err));
});

router.put('/', validation(validationParams.editUser), (req, res, next) => {
  User.findOneAndUpdate({ userId: req.user.userId }, req.body)
    .then(user => (!user ? new error.NotFound('NO_USER_ERR', 'User cannot be found') : user))
    .then(() => res.end())
    .catch(err => next(err));
});

router.delete('/', (req, res, next) => {
  User.findOneAndRemove({ userId: req.user.userId })
    .then(user => (!user ? new error.NotFound('NO_USER_ERR', 'User cannot be found') : user))
    .then(() => res.end())
    .catch(err => next(err));
});

router.get('/social/friends', status.accountTypeMiddleware, (req, res, next) => {
  social.getFriends(req.user)
    .then(response => res.json(response))
    .catch(err => next(err));
});

// TODO: Рефакторинг на единую схему для сохранненых закладок и метрик
router.all('/bookmarks/:type/:id?', validation(validationParams.bookmarks), passport.authenticate('bearer', { session: false }), (req, res, next) => {
  const SAVED_COLLECTIONS = 'savedCollections';
  const MY_COLLECTIONS = 'createdCollections';
  const SAVED_LINKS = 'savedLinks';
  const MY_LINKS = 'addedLinks';

  const addingId = mongoose.Types.ObjectId(req.params.id);

  const types = [SAVED_COLLECTIONS, SAVED_LINKS];
  const myTypes = [MY_COLLECTIONS, MY_LINKS];

  if (['GET', 'PUT', 'DELETE'].indexOf(req.method) === -1 && types.indexOf(req.params.type) !== -1) {
    return next(new error.MethodNotAllowed('API_WARN', 'Method not allowed for saved content'));
  } else if (['GET', 'DELETE'].indexOf(req.method) === -1 && myTypes.indexOf(req.params.type) !== -1) {
    return next(new error.MethodNotAllowed('API_WARN', 'Method not allowed for user created content'));
  }

  let bookmarksAction = {};
  let userAction = {};
  let userDuplicateCheck = { userId: req.user.userId };

  const collectionsActionDestination = { bookmarks: { bookmarkId: addingId, type: SAVED_COLLECTIONS } };
  const collectionsCreatedActionDestination = { bookmarks: { bookmarkId: addingId, type: MY_COLLECTIONS } };
  const linksActionDestination = { bookmarks: { bookmarks: addingId, type: SAVED_LINKS } };
  const linksActionAddedDestination = { bookmarks: { bookmarkId: addingId, type: MY_LINKS } };

  const userActionDestination = { usersSaved: req.user.userId };

  const mongoCollection = (req.params.type === SAVED_COLLECTIONS || req.params.type === MY_COLLECTIONS) ? Collection : Link;

  if (req.method === 'PUT' && req.params.id && types.indexOf(req.params.type) !== -1) {
    bookmarksAction = { $addToSet: userActionDestination };
    userAction = { $addToSet: req.params.type === SAVED_COLLECTIONS ? collectionsActionDestination : linksActionDestination };
    userDuplicateCheck = { userId: req.user.userId, 'bookmarks.bookmarkId': { $ne: addingId } };
  } else if (req.method === 'DELETE' && req.params.id) {
    switch (req.params.type) {
    case (SAVED_COLLECTIONS): userAction = { $pull: collectionsActionDestination };
      bookmarksAction = { $pull: userActionDestination };
      break;
    case (MY_COLLECTIONS): userAction = { $pull: collectionsCreatedActionDestination };
      break;
    case (SAVED_LINKS): userAction = { $pull: linksActionDestination };
      bookmarksAction = { $pull: userActionDestination };
      break;
    case (MY_LINKS): userAction = { $pull: linksActionAddedDestination };
      break;
    default:
      return next(new error.BadRequest('BOOKMARKS_ERR', 'Bookmarks destination not found'));
    }
  }

  return mongoCollection.findOneAndUpdate({ _id: addingId },
    bookmarksAction)
    .then((bookmark) => {
      if (!bookmark && req.params.id) {
        throw new error.NotFound('NO_BOOKMARKS_ERR', 'Bookmarks not found');
      }
      return User.findOneAndUpdate(userDuplicateCheck,
        userAction)
        .then((user) => {
          if (!user) {
            throw new error.NotFound('BOOKMARK_ADD_ERR', 'User not found, cannot update this user, or this bookmark is already added');
          }
          if (req.method === 'GET') {
            if (req.params.type === SAVED_COLLECTIONS || req.params.type === MY_COLLECTIONS) {
              return Collection.aggregate([
                {
                  $match: { _id: { $in: user.bookmarks.map(bookmarkElem => (bookmarkElem.type === req.params.type ? bookmarkElem.bookmarkId : undefined)).filter(Boolean) } },
                },
                {
                  $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
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
                  $lookup:
                     {
                       from: 'users',
                       localField: '_id',
                       foreignField: 'metrics.contentId',
                       as: 'metrics',
                     },
                },
                {
                  $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
                },
                {
                  $addFields: {
                    metrics: {
                      $filter: {
                        input: '$metrics.metrics',
                        as: 'metric',
                        cond: { $and: [
                          { $eq: ['$$metric.contentId', '$_id'] },
                          { $eq: ['$metrics.userId', req.user.userId] }] },
                      },
                    },
                  },
                },
                {
                  $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
                },
                {
                  $group: {
                    _id: '$_id',
                    name: { $first: '$name' },
                    author: { $first: '$author' },
                    photo: { $first: '$photo' },
                    color: { $first: '$color' },
                    created: { $first: '$created' },
                    links: { $first: '$links' },
                    metrics: { $addToSet: '$metrics' },
                  },
                },
                {
                  $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
                },
                {
                  $addFields: {
                    linksCount: { $size: '$links' },
                  },
                },
                {
                  $project: { 'author.salt': 0,
                    usersSaved: 0,
                    'metrics._id': 0,
                    'metrics.type': 0,
                    'metrics.counter': 0,
                    'metrics.contentId': 0,
                    'author._id': 0,
                    'author.hash': 0,
                    'author.banned': 0,
                    'author.created': 0,
                    'author.accType': 0,
                    'author.bookmarks': 0,
                    'author.metrics': 0,
                    'author.__v': 0,
                    links: 0,
                    'tags.__v': 0,
                    'tags.textColor': 0,
                    'tags.color': 0,
                  },
                },
                {
                  $match: (req.query.filter === 'new') ? { $or: [{ 'metrics.opened': null }, { 'metrics.opened': false }] } :
                    (req.query.filter === 'opened') ? { 'metrics.opened': true } :
                      { _id: { $exists: true } },
                },
                {
                  $sort: { 'metrics.addTime': -1 },
                },
              ])
                .then(collections => res.json({ collections }));
            }
            return Link.aggregate([
              {
                $match: { _id: { $in: user.bookmarks.map(bookmarkElem => (bookmarkElem.type === req.params.type ? bookmarkElem.bookmarkId : undefined)).filter(Boolean) } },
              },
              {
                $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
              },
              {
                $lookup:
                   {
                     from: 'users',
                     localField: 'userAdded',
                     foreignField: 'userId',
                     as: 'userAdded',
                   },
              },
              {
                $unwind: { path: '$userAdded', preserveNullAndEmptyArrays: true },
              },
              {
                $lookup:
                   {
                     from: 'users',
                     localField: '_id',
                     foreignField: 'metrics.contentId',
                     as: 'metrics',
                   },
              },
              {
                $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
              },
              {
                $addFields: {
                  metrics: {
                    $filter: {
                      input: '$metrics.metrics',
                      as: 'metric',
                      cond: { $and: [
                        { $eq: ['$$metric.contentId', '$_id'] },
                        { $eq: ['$metrics.userId', req.user.userId] }] },
                    },
                  },
                },
              },
              {
                $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
              },
              {
                $group: {
                  _id: '$_id',
                  name: { $first: '$name' },
                  userAdded: { $first: '$userAdded' },
                  photo: { $first: '$photo' },
                  description: { $first: '$description' },
                  favicon: { $first: '$favicon' },
                  likes: { $first: '$likes' },
                  url: { $first: '$url' },
                  metrics: { $addToSet: '$metrics' },
                },
              },
              {
                $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
              },
              {
                $project: { __v: 0,
                  usersSaved: 0,
                  'userAdded.salt': 0,
                  'userAdded.bookmarks': 0,
                  'metrics._id': 0,
                  'metrics.bookmarkId': 0,
                  'metrics.counter': 0,
                  'userAdded._id': 0,
                  'userAdded.hash': 0,
                  'userAdded.banned': 0,
                  'userAdded.created': 0,
                  'userAdded.accType': 0,
                  'userAdded.createdCollections': 0,
                  'userAdded.savedCollections': 0,
                  'userAdded.savedLinks': 0,
                  'userAdded.addedLinks': 0,
                  'userAdded.__v': 0,
                },
              },
              {
                $match:
                (req.query.filter === 'new') ?
                  { $or: [{ 'metrics.opened': null }, { 'metrics.opened': false }] } :
                  (req.query.filter === 'opened') ?
                    { 'metrics.opened': true } :
                    { _id: { $exists: true } },
              },
              {
                $sort: { 'metrics.addTime': -1 },
              },
            ])
              .then(links => res.json({ links }));
          } else if (req.method === 'DELETE' && myTypes.indexOf(req.params.type) !== -1) {
            return mongoCollection.findOneAndRemove(req.params.type === MY_COLLECTIONS ?
              { _id: addingId, authorId: req.user.userId } :
              { _id: addingId, userAdded: req.user.userId })
              .then((deletedContent) => {
                if (!deletedContent) {
                  throw new error.NotFound('CONTENT_DELETE_ERR', 'Nothing to delete');
                }
                res.json({ result: 'successfully deleted' });
              });
          }
          return res.json({ result: 'success' });
        });
    })
    .catch(err => next(err));
});

module.exports = router;

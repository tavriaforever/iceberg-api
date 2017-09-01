const mongoose = require('../libs/db/mongoose');
const findOrCreate = require('findorcreate-promise');

const Schema = mongoose.Schema;

const Collection = new Schema({
  name: {
    type: String,
    required: true,
  },
  authorId: {
    type: String,
    required: true,
  },
  tags: {
    type: Array,
  },
  description: {
    type: String,
    default: '',
  },
  photo: {
    type: String,
  },
  links: {
    type: Array,
  },
  color: {
    type: String,
    required: false,
    default: '#0476fc',
  },
  savedTimesCount: {
    type: Number,
    default: 0,
  },
  textColor: {
    type: String,
    required: false,
  },
  created: {
    type: Date,
    default: Date.now,
  },
});

Collection.plugin(findOrCreate);

Collection.index({ name: 'text' });

module.exports.Collection = mongoose.model('Collection', Collection);

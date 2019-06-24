const Baker = require('./index');

const KEYS = {
  pkh: '',
  sk: '',
};

const baker = new Baker('http://127.0.0.1:8732', 'main', 'zero');
baker.start(KEYS);

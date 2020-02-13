const Baker = require('./index');

const SECRET_KEY = '';

const main = async () => {
  const baker = new Baker('http://127.0.0.1:8732', 'main', 'carthage');
  await baker.importKey(SECRET_KEY);
  baker.start();
};

main();

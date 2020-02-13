# Tez Baker JS - A JS Tezos Baker

Do not use on Mainnet. This project is meant as a learning tool for the Tezos baking process.

# Getting Started

Edit bake.js and add the necessary key and provider information:

```js
const Baker = require('./index');

const SECRET_KEY = 'edsk...';

const main = async () => {
  const baker = new Baker('http://127.0.0.1:8732', 'main', 'carthage');
  await baker.importKey(SECRET_KEY);
  baker.start();
};

main();
```

```js
npm install
node bake.js
```

# Development

```js
npm install
npm run build
```

## License

MIT

## Credits

Credits to Stephen Andrews

const path = require('node:path');

if (process.env.NODE_ENV === 'development') {
  require('tsx/cjs');
  require(path.join(__dirname, 'src', 'main', 'index.ts'));
} else {
  require(path.join(__dirname, 'dist', 'main', 'index.cjs'));
}
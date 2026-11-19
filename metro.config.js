const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native-svg': path.resolve(__dirname, 'src/mocks/react-native-svg.js'),
};

module.exports = config;

import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
const config = firebaseRulesPlugin.configs['flat/recommended'];
console.log('Files:', config.files);
console.log('Plugins:', Object.keys(config.plugins || {}));
console.log('Language Options:', !!config.languageOptions);
console.log('Keys:', Object.keys(config));

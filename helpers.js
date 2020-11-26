const VError = require('verror');

// 需要检查合法性的参数key
const ROLLBAR_REQ_FIELDS = [
  'app_key',
  'product_code',
  'app_code',
];

// Take a single Error or array of Errors and return an array of errors that
// have message prefixed.
exports.handleError = function (err, prefix = 'FastSourcemapUploadWebpackPlugin') {
  if (!err) {
    return [];
  }

  const errors = [].concat(err);
  return errors.map(function(e) {
    return new VError(e, prefix);
  });
}

// Validate required options and return an array of errors or null if there
// are no errors.
exports.validateOptions = function (ref) {
  const errors = ROLLBAR_REQ_FIELDS.reduce((result, field) => {
    if (ref && ref[field] && typeof ref[field] !== 'string') {
      return [
        ...result,
        new TypeError(`invalid type. '${field}' expected to be string.`)
      ];
    }

    if (ref && ref[field]) {
      return result;
    }

    return [
      ...result,
      new Error(`required field, '${field}', is missing.`)
    ];
  }, []);

  return errors.length ? errors : null;
}

// 是否需要上传（JS与JSMAP）
exports.needUpload = function(file) {
  return /\.js(\.map)?(\?.*)?$/.test(file)
}

// 是否为js或jsmap
exports.cutOutJsAndMap = function(file) {
  const index = file.indexOf('?')
  if (index !== -1) {
    return file.substring(0, index);
  }
  return file
}

// 是否需要保留（非jsmap、cssmap文件）
exports.needKeep = function(file) {
  return !/\.(js|css)\.map(\?.*)?$/.test(file);
}



// 判断是否为一个object
exports.isObject = function(obj) {
  return obj && Object.prototype.toString.call(obj) === '[object Object]';
}

// 提取属性
exports.safeGet = function(obj, keys, defaultValue) {
  let temp = obj;
  for (let i = 0; i < keys.length; i++) {
    temp = temp ? temp[keys[i]] : undefined;
    if (temp === undefined) {
      temp = defaultValue === undefined ? null : defaultValue;
      break;
    }
  }
  return temp;
}

// 告警console
exports.fwarn = (str) => {
  console.warn(`fast-tracker-integration-webpack-plugin warning: `, str);
}

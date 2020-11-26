const fs = require('fs');
const path = require('path');
// const HtmlWebpackPlugin = require('html-webpack-plugin');
const request = require('request-promise');
const { fwarn } = require('./utils');

class FastTrackerIntegrationWebpackPlugin {
  constructor(options = {}) {
    // 校验生成参数
    this.options = this.validateAndGenenateOption(options);
  }

  apply (compiler) {
    // 无法使用,直接跳过
    if (!this.options.available) {
      return 
    }

    // 标准探针勾子回调函数
    const mainFunc = this.mainFunc.bind(this)
    if (this.options.type === 'default') {
      // 兼容低版本webpack
      if (compiler.hooks && compiler.hooks.afterEmit) {
        compiler.hooks.emit.tapAsync('fast-tracker-integration-webpack-plugin', mainFunc);
      } else {
        compiler.plugin('emit', mainFunc);
      }
    } else if (this.options.type === 'wxmp') {
      // 兼容低版本webpack
      if (compiler.hooks && compiler.hooks.afterEmit) {
        compiler.hooks.afterEmit.tapAsync('fast-tracker-integration-webpack-plugin', mainFunc);
      } else {
        compiler.plugin('after-emit', mainFunc);
      }
    }
  }

  // 下载探针
  async getTrackerFile() {
    const {
      product_code,
      app_code,
      env_code,
      type,
    } = this.options
    let data = '';
    try {
      data = await request(`https://mic-open.mypaas.com.cn/web-log-tracker/${product_code}/${app_code}/myWebLogTracker.min.${env_code}${type === 'wxmp' ? '.wxmp': ''}.js`);
    } catch(e) {
      fwarn('探针加载失败')
    }
    return data
  }

  // 生成mpvue小程序探针文件/文件引入
  async setWXMPTracker(trackerData) {
    const {
      file_path_arr,
    } = this.options;
    const trackerScriptTag = `\r\nrequire('./myWebLogTracker.min')`
    // 对于
    file_path_arr.forEach(filePath => {
      let fileData = fs.readFileSync(filePath, 'utf8');
      let insertIndex;
      // 有带use strict (在use strict后)
      if (fileData.indexOf(`use strict`) > -1) {
        const matchReg = /\S*use strict\S*/;
        const matchData = fileData.match(matchReg);
        insertIndex = matchData.index + matchData[0].length;
      } else {
        insertIndex = 0;
      }
      
      // 拼接script标签(小程序require引入)
      fileData = fileData.slice(0, insertIndex) + trackerScriptTag + fileData.slice(insertIndex);
      // 探针文件写入
      fs.writeFileSync(path.resolve(filePath, '../myWebLogTracker.min.js'), trackerData);
      // 重写加入了探针script标签(小程序require引入)的文件
      fs.writeFileSync(filePath, fileData);
    })
  }

  // 生成标准探针文件/文件引入
  async setDefaultTracker(compilation, trackerData) {
    const {
      file_path_arr,
    } = this.options;
    const trackerScriptTag = '<script src="./myWebLogTracker.min.js"><script/>'

    // 对于
    file_path_arr.forEach(filePath => {

      // 当前html文件存在时
      const currentHtml = compilation.assets[filePath];
      if (currentHtml) {
        let fileData = compilation.assets[filePath].source();
        let insertIndex;
        // 标准探针
        insertIndex = fileData.indexOf('<script');
        // 查不到script标签时,直接在head中插入
        if (insertIndex === -1) {
          // 无script标签,则从head标签填充
          insertIndex = fileData.indexOf('</head>');
        }
        // 拼接script标签(小程序require引入)
        fileData = fileData.slice(0, insertIndex) + trackerScriptTag + fileData.slice(insertIndex);
        compilation.assets[filePath].source = function() {return fileData};
        compilation.assets[filePath].size = function() {fileData.length};
        const filePathArr = filePath.split('/');
        filePathArr.pop();
        filePathArr.push('myWebLogTracker.min.js');
        const trackerPath = filePathArr.join('/');
        compilation.assets[trackerPath] = {
          source() {return trackerData},
          size() {return trackerData.length}
        };
      }
      compilation.assets['myWebLogTracker.min.js'] = {
        source() {return trackerData},
        size() {return trackerData.length}
      };
    })
  }

  // html文件获取.探针获取、写入 主程序
  async mainFunc(compilation, cb) {
    // 获取探针文件
    const trackerData = await this.getTrackerFile();
    // 探针是否
    if (typeof trackerData === 'string' && trackerData.length) {
      if (this.options.type === 'wxmp') {
        // 微信小程序插件生成
        await this.setWXMPTracker(trackerData);
      } else if (this.options.type === 'default') {
        // 标准探针文件注入
        await this.setDefaultTracker(compilation, trackerData);
      }
    } else {
      fwarn('探针加载失败');
    }
    cb();
  }

  // 校验生成参数
  validateAndGenenateOption(options = {}) {
    const returnOpts = { available: true,  };
    // type
    if (options.type !== 'default' && options.type !== 'wxmp') {
      fwarn(`type 必须为 'default' 或者 'wxmp'`);
      returnOpts.available = false;
    } else {
      returnOpts.type = options.type;
    }
    // 必填字段
    const requiredFieldsArr = ['product_code', 'app_code', 'env_code'];
    requiredFieldsArr.forEach(v => {
      if (!options[v]) {
        fwarn(`${v} 必填`);
        returnOpts.available = false;
      } else {
        returnOpts[v] = options[v]
      }
    })
    // 需加载探针文件html
    if ((options.type === 'default' || options.type === 'wxmp') && Array.isArray(options.file_path_arr) && options.file_path_arr.length) {
      returnOpts.file_path_arr = options.file_path_arr;
    } else {
      fwarn(`file_path_arr 必填`);
      returnOpts.available = false;
    }

    return returnOpts;
  }
}

module.exports = FastTrackerIntegrationWebpackPlugin;
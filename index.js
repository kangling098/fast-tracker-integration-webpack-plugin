const fs = require('fs');
const path = require('path');
const promiseRequest = require('request-promise');
const request = require('request');
const crypto = require('crypto');
const OSS = require('ali-oss');
const archiver = require('archiver');
const chalk = require('chalk');
const { handleError, validateOptions, needUpload, needKeep, safeGet, isObject, cutOutJsAndMap, fwarn } = require('./helpers');

// 默认获取STS的地址
const DEFAULT_STS_URL = 'https://fast-tools.mypaas.com.cn/api/sts/sourcemap_upload';
// 默认超时
const DEFAULT_TIME_OUT = 300000;
// 放在oss对应项目根目录用来进行比对的list目录名称
const UPLOAD_FILE_LIST_NAME = '__fast_last_upload_list_cache__.txt';
// 待上传的zip文件名
const ZIIPED_FILE_NAME = 'fast_source_map.zip';

class FastTrackerIntegrationWebpackPlugin {
  constructor(options) {

    // 探针插入集成插件校验生成参数
    this.interOptions = this.validateAndGenenateOption(options);
    // 对于sourcmap上传插件,单独处理
    this.validateAndGenenateSourcemapOption(options);
  }

  apply (compiler) {
    // 插入探针相关逻辑
    if (this.interOptions.available) {
      // 标准探针(mpvue探针)勾子回调函数
      const mainFunc = this.mainFunc.bind(this);
      if (this.interOptions.integration_tracker === 'offline' || this.interOptions.integration_tracker === 'online') {
    console.log(21111)

        // 兼容低版本webpack
        if (compiler.hooks && compiler.hooks.emit) {
          compiler.hooks.emit.tapAsync('fast-tracker-integration-webpack-plugin', mainFunc);
    console.log(2222)

        } else {
          compiler.plugin('emit', mainFunc);
        }
      } else if (this.interOptions.integration_tracker === 'wxmp') {
        // 兼容低版本webpack
        if (compiler.hooks && compiler.hooks.afterEmit) {
          compiler.hooks.afterEmit.tapAsync('fast-tracker-integration-webpack-plugin', mainFunc);
        } else {
          compiler.plugin('after-emit', mainFunc);
        }
      } 
    }
    // sourcemap上传逻辑(开启了才跑)
    if (this.update_sourcemap) {
      // emit生命周期,上传emit阶段生成的文件
      try {
        // 需要执行的hook回调
        const hookFunc = this.uploadSourceMaps.bind(this);
        
        if (compiler.hooks && compiler.hooks.emit) {
          compiler.hooks.emit.tapAsync('fast-tracker-integration-webpack-plugin-upload-sourcemap', hookFunc);
        } else {
          compiler.plugin('emit', hookFunc);
        }
      } catch (e) {
        console.log(e)
      }
      // afterEmit生命周期,上传额外指定的文件夹
      if (this.extra_upload_dir && this.extra_upload_dir.length) {
        try {
          // 需要执行的hook回调
          const hookFunc = this.afterEmit.bind(this);
          
          if (compiler.hooks) {
            compiler.hooks.afterEmit.tapAsync('fast-tracker-integration-webpack-plugin-upload-sourcemap', hookFunc);
          } else {
            compiler.plugin('after-emit', hookFunc);
          }
        } catch (e) {
          console.log(e)
        }
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
      test_tracker_url,
    } = this.interOptions
    let data = '';
    const trackerUrl = !!test_tracker_url ? test_tracker_url : `https://mic-open.mypaas.com.cn/web-log-tracker/${product_code}/${app_code}/myWebLogTracker.min.${env_code}${type === 'wxmp' ? '.wxmp': ''}.js`;
    console.log(`探针文件加载中 ${trackerUrl}`)
    try {
      data = await promiseRequest(trackerUrl);
    } catch(e) {
      fwarn('探针加载失败')
    }
    return data
  }

  // 生成mpvue小程序探针文件/文件引入
  async setWXMPTracker(trackerData) {
    const {
      file_path_arr,
    } = this.interOptions;
    const trackerScriptTag = `\r\nrequire('./myWebLogTracker.min');\r\n`;
    // 对于
    file_path_arr.forEach(filePath => {
      try {
        let fileData = fs.readFileSync(filePath, 'utf8');
      
        // 拼接script标签(小程序require引入)
        fileData = trackerScriptTag + fileData;
        // 探针文件写入
        fs.writeFileSync(path.resolve(filePath, '../myWebLogTracker.min.js'), trackerData);
        // 重写加入了探针script标签(小程序require引入)的文件
        fs.writeFileSync(filePath, fileData);
      } catch(e) {
        fwarn(e)
      }
    })
  }

  // 生成标准探针文件/文件引入
  async setDefaultTracker(compilation, trackerData) {
    const {
      file_path_arr,
    } = this.interOptions;
    const trackerScriptTag = '<script src="./myWebLogTracker.min.js"></script>'

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
    })
  }

  // 插入在线探针script标签
  async setOnlineTracker(compilation) {
    try {
      const {
        file_path_arr,
        env_code,
        product_code,
        app_code,
      } = this.interOptions;
      const trackerScriptTag = `<script src="https://mic-open.mypaas.com.cn/web-log-tracker/${product_code}/${app_code}/myWebLogTracker.min${!!env_code ? `.${env_code}`: ''}.js"></script>`
  
      // 对于
      file_path_arr.forEach(filePath => {
        // 当前html文件存在时
        const currentHtml = compilation.assets[filePath];
        if (currentHtml) {
          let fileData = compilation.assets[filePath].source();
          let insertIndex;
          // 有带环境,那么根据scipt、head位置插入
          if (!!env_code) {
            // 标准探针
            insertIndex = fileData.indexOf('<script');
            // 查不到script标签时,直接在head中插入
            if (insertIndex === -1) {
              // 无script标签,则从head标签填充
              insertIndex = fileData.indexOf('</head>');
            }
          } else {
            insertIndex = fileData.indexOf('</body>');
          }
          
          // 拼接script标签
          fileData = fileData.slice(0, insertIndex) + trackerScriptTag + fileData.slice(insertIndex);
          compilation.assets[filePath].source = function() {return fileData};
          compilation.assets[filePath].size = function() {return fileData.length};
        }
      })
    } catch(e) {
      fwarn(e)
    }
  }

  // html文件获取.探针获取、写入 主程序
  async mainFunc(compilation, cb) {
    console.log(233333)
    // 如果是在线探针插入(不需要获取探针文件,直接生成探针链接就可以)
    if (this.interOptions.integration_tracker === 'online') {
      await this.setOnlineTracker(compilation);
    } else {
      // 获取探针文件
      const trackerData = await this.getTrackerFile();
      // 探针是否
      if (typeof trackerData === 'string' && trackerData.length) {
        if (this.interOptions.integration_tracker === 'wxmp') {
          // 微信小程序插件生成
          await this.setWXMPTracker(trackerData);
        } else if (this.interOptions.integration_tracker === 'offline') {
          // 标准探针文件注入
          await this.setDefaultTracker(compilation, trackerData);
        }
      } else {
        fwarn('探针加载失败');
      }
    }
    
    cb();
  }

  // 校验生成参数
  validateAndGenenateOption(options = {}) {
    const {
      integration_tracker = false,
      test_tracker_url,
      env_code,
      product_code,
      app_code,
    } = options
    const returnOpts = { available: true, test_tracker_url, product_code, app_code };
    if (!app_code) {
      fwarn(`app_code 必填`);
      returnOpts.available = false;
    }
    if (!product_code) {
      fwarn(`product_code 必填`);
      returnOpts.available = false;
    }
    // 如果integration_tracker为false,直接返回,不处理探针接入问题
    if (options.integration_tracker === false) return {available: false}
    // type
    const integrationTrackerType = ['offline', 'online', 'wxmp'];
    if (!integrationTrackerType.includes(integration_tracker)) {
      fwarn(`type 必须为 'offline'、'online'、'wxmp'、false`);
      returnOpts.available = false;
    } else {
      returnOpts.integration_tracker = integration_tracker;
    }
    // 必填字段
    const requiredFieldsArr = ['product_code', 'app_code'];
    requiredFieldsArr.forEach(v => {
      if (!options[v]) {
        fwarn(`${v} 必填`);
        returnOpts.available = false;
      } else {
        returnOpts[v] = options[v]
      }
    })

    // 环境code校验
    const envCodeList = {
      prod: true,
      beta: true,
      test: true,
      dev: true,
    };
    if (integration_tracker === 'online') {
      if (envCodeList[env_code] || !env_code) {
        returnOpts.env_code = env_code;
      } else {
        fwarn(`integration_tracker === 'online'时 env_code 必须为 'prod'、'beta'、'test'、'dev'、 undefined 中的一种`);
        returnOpts.available = false;
      }
    } else if (integration_tracker === 'offline' || integration_tracker === 'wxmp') {
      if (envCodeList[env_code]) {
        returnOpts.env_code = env_code;
      } else {
        fwarn(`integration_tracker === 'offline' 或 integration_tracker === 'wxmp' 时 env_code 必须为 'prod'、'beta'、'test'、'dev' 中的一种`);
        returnOpts.available = false;
      }
    } else {
      fwarn(`integration_tracker 必须为 'online'、'offline'、'wxmp'、false ` );

      returnOpts.available = false
    }

    // 需加载探针文件html
    if ((options.integration_tracker === 'offline' || options.integration_tracker === 'wxmp' || options.integration_tracker === 'online') && Array.isArray(options.file_path_arr) && options.file_path_arr.length) {
      returnOpts.file_path_arr = options.file_path_arr;
    } else {
      fwarn(`file_path_arr 必填`);
      returnOpts.available = false;
    }

    return returnOpts;
  }

  // sourcemap参数校验,赋值
  validateAndGenenateSourcemapOption({
    // 是否上传sourcemap文件
    update_sourcemap,
    // APP密钥（必填）
    app_key,
    // 产品编码（必填）
    product_code,
    // 应用编码（必填）
    app_code,
    // 文件上传超时时间
    timeout = DEFAULT_TIME_OUT,
    // 获取STS权限接口
    sts_url = DEFAULT_STS_URL,
    // 是否删除生成的sourceMap文件（默认删除）
    is_delete_source_map = true,
    // 额外需要上传的文件夹目录
    extra_upload_dir = [],
    // 是否需要强制上传所有文件
    force_update = false,
  }){
    this.update_sourcemap = update_sourcemap;
    this.app_key = app_key;
    this.product_code = product_code;
    this.app_code = app_code;
    this.timeout = timeout;
    this.sts_url = sts_url;
    this.is_delete_source_map = !!is_delete_source_map;
    this.extra_upload_dir = extra_upload_dir;
    this.force_update = !!force_update;
    if (this.update_sourcemap && !this.app_key) {
      fwarn('app_key必填')
      this.update_sourcemap = false;
    }
    // this.ziped = true;
    // 时间戳 用于签名
    this.timestamp = ~~(Date.now()/1000);
    // 是否需要更新控制台信息
    this.showUpdatingConsole = false;
    // oss实例
    this.ossClient = null;
    // OSS 存储路径
    this.oss_prefix_path = '';
    // oss远端文件列表
    this.historyCacheFileListObj = undefined;
    // 上传报告数据存储
    this.reportData = {
      failed: 0,
      ossHas: 0,
      success: 0,
    };
  }

  // 上传emit生命周期 asserts中的文件 开始上传文件过程
  uploadSourceMaps(compilation, cb) {
    const self = this;
  
    // 检查配置参数是否合法
    const errors = validateOptions(this);
  
    if (errors) {
      console.error(chalk.red(...handleError(errors)))
      cb();
    } else {
      this.showUpdatingConsole = false;
      // 准备进行数据签名
      const hmac = crypto.createHmac('sha1', this.app_key);
      // 准备参数字符串
      const paramStr = `app_code=${this.app_code}&product_code=${this.product_code}&timestamp=${this.timestamp}`;
      // 得到签名字符串
      hmac.update(paramStr);
      const signatureStr = hmac.digest('hex');
      // 获取sts完整url
      const final_sts_url = `${this.sts_url}?${paramStr}&signature=${signatureStr}`;
      // 新assets 用于删除map
      const _assets = {};
      // 待上传
      const _upload = {};
      // 遍历一次assets
      Object.keys(compilation.assets).forEach((name) => {
        // 需要保留的文件
        if (needKeep(name)) {
          _assets[name] = compilation.assets[name];
        }
        // 需要上传的文件
        if (needUpload(name)) {
          _upload[name] = compilation.assets[name];
        }
      });
      // 如果配置了需要删除sourcemap文件
      if (this.is_delete_source_map) {
        compilation.assets = _assets;
      }
      console.log(chalk.blue('fast-sourcemap-upload-webpack-plugin is getting auth to upload sourcemap files, do not stop your program\r\n'));
      // 请求sts
      request(final_sts_url, (error, response, body) => {
        if (error) {
          console.log(error);
  
          return cb();
        }
        let bodyData;
        try {
          bodyData = JSON.parse(body);
        } catch (e) {
          if (body.startsWith('Invalid Authentication')) {
            console.log(chalk.red('ERROR fast-sourcemap-upload-webpack-plugin: Invalid Authentication\r\nyour app_key、product_code、app_code maybe wrong'));
          } else {
            console.log(chalk.red(`ERROR fast-sourcemap-upload-webpack-plugin: ${body}`));
          }
          return cb();
        }
  
        bodyData = isObject(bodyData) ? bodyData : {};
        // 获取STS失败时展示原因
        if (!bodyData.result) {
          console.log(chalk.red(bodyData.msg || 'STS权限获取失败'));
          return cb();
        }
        // 取得授权
        const secureData = bodyData.data;
        const credentials = secureData.credentials;
  
        try {
          self.ossClient = new OSS({
            endpoint: secureData.endpoint,
            accessKeyId: credentials.AccessKeyId,
            accessKeySecret: credentials.AccessKeySecret,
            stsToken: credentials.SecurityToken,
            bucket: secureData.bucket,
          });
        } catch (e) {
          console.log(e);
          return cb();
        }
        // oss文件存储路径
        self.oss_prefix_path = secureData.sourcemap_path;
        // 开始上传文件
        self.uploadAll(_upload, cb);
      });
    }
  }

  // 串行上传文件
  async uploadAll(assets, cb) {
    // 当oss相关存在异常时 取消上传
    if (!this.oss_prefix_path || !this.ossClient) {
      cb();
    } else {
      const startTime = Date.now();
      let historyCacheFileListObj = {};
      try {
        // 获取仓库现有oss文件列表
        const nameList = await this.ossClient.get(path.join(this.oss_prefix_path, UPLOAD_FILE_LIST_NAME).replace(/\\/g, '/'));
        historyCacheFileListObj = JSON.parse(nameList.content.toString());
      } catch (e) {
        console.log(chalk.yellow(e || '获取、解析oss上次上传文件列表失败'));
        // 报错不做任何处理,默认oss仓库中无缓存oss文件列表
        // historyCacheFileListObj = {};
      }
      // oss文件已上传目录
      this.historyCacheFileListObj = this.historyCacheFileListObj || historyCacheFileListObj;
  
      // 待上传的文件队列
      const fileList = Object.keys(assets);
      // 存在文件时进行上传
      if (fileList.length > 0) {
        // 创建archiver实例 压缩等级9
        const archive = archiver('zip', {
          zlib: { level: 9 }
        });
        // 创建输出
        const output = fs.createWriteStream(path.resolve(__dirname, ZIIPED_FILE_NAME));
        // 监听输出目录的close事件
        output.on('close', () => {
          console.log(chalk.blue(`fast-sourcemap-upload-webpack-plugin 压缩耗时 ${Date.now() - startTime}ms`))
          // return cb();
          this.upload(ZIIPED_FILE_NAME, fs.createReadStream(path.resolve(__dirname, ZIIPED_FILE_NAME)), cb);
        });
        // 输出
        archive.pipe(output);
        while (fileList.length > 0) {
          const fileName = fileList.pop();
          const fileSource = assets[fileName].source();
          // 生成buffer
          const bufferSource = Buffer.isBuffer(fileSource) ? fileSource :  Buffer.from(fileSource);
          // 处理文件名称
          const cutOutName = cutOutJsAndMap(fileName);
          // 获取文件保存于oss的路径
          const currentPathMappingToOssPath = path.join(this.oss_prefix_path, cutOutName).replace(/\\/g, '/');
          // oss文件列表中已存在的文件
          // 比对历史上传列表中是否有上传过该文件,如果不存在(或者开启了强制上传功能),则加入zip压缩包
          if (!this.historyCacheFileListObj[currentPathMappingToOssPath] || this.force_update) {
            archive.append(bufferSource, { name: cutOutName });
            this.reportData.success ++;
            // 本次上传列表将当前文件加入列表
            this.historyCacheFileListObj[currentPathMappingToOssPath] = true;
            console.log(chalk.green(`${cutOutName} 已压缩等待上传`));
          } else {
            this.reportData.ossHas ++;
          }
        }
        // 生成本次上传文件列表
        const uoloadFileListObjBuffer = Buffer.from(JSON.stringify(this.historyCacheFileListObj), 'utf8');
  
        archive.append(uoloadFileListObjBuffer, { name: UPLOAD_FILE_LIST_NAME });
        // 开始压缩
        archive.finalize();
      } else {
        cb();
      }
    }
  }

  // 压缩文件上传
  async upload (fileName, fileSource, callback) {
    const self = this;
    
    // oss upload path
    const uploadPath = path.join(self.oss_prefix_path, fileName).replace(/\\/g, '/');
    if (!self.showUpdatingConsole) {
      self.showUpdatingConsole = true;
      console.log(chalk.blue('fast-sourcemap-upload-webpack-plugin is updating your map files, do not stop your program\r\n'));
    }
    return self.ossClient.put(uploadPath, fileSource, {
      timeout: self.timeout
    }).then((result) => {
      if (!self.showUpdatingConsole) {
        self.showUpdatingConsole = true;
        console.log(chalk.blue('fast-sourcemap-upload-webpack-plugin is updating your map files, do not stop your program'));
      }
      if (result && result.res && result.res.status === 200) {
        // this.reportData.success ++;
        console.log(chalk.green(`fast-sourcemap-upload-webpack-plugin: ${fileName} uploaded`));
        console.log(chalk.green(`Time consuming ${safeGet(result, ['res', 'rt'], 'unknow ')}ms`));
        console.log(chalk.green(`fast-sourcemap-upload-webpack-plugin: 本次检测文件总数为${this.reportData.success + this.reportData.ossHas + this.reportData.failed}个,其中${this.reportData.ossHas}个文件已存在oss仓库仓库中默认不进行上传处理,如果需要上传,请开启force_update配置,另外有${this.reportData.failed + this.reportData.success}个文件不存在oss仓库中需要上传,其中${this.reportData.success}个文件成功增量上传`))
        callback();
      } else {
        console.log(chalk.red(`Error fast-sourcemap-upload-webpack-plugin: ${fileName} uploaded failed`));
        callback();
      }
    }).catch( err => {
      console.log(chalk.red(`Error fast-sourcemap-upload-webpack-plugin: ${err}`));
      callback()
    });
  }

  // 如果存在需要额外上传的文件夹,需要在afterEmit生命周期时进行,即文件输出之后进行回调
  afterEmit(compilation, cb) {
    const errors = validateOptions(this);
  
    if (errors) {
      (compilation && compilation.errors && compilation.errors.push(...handleError(errors)) ||
      console.error(chalk.red(...handleError(errors))))
      return cb();
    }
    const hmac = crypto.createHmac('sha1',this.app_key);
    // const string = Object.keys(this.project_data).sort().map((val) => val + '=' + this.project_data[val]).join('&');
  
    // 准备参数字符串
    const string = `app_code=${this.app_code}&product_code=${this.product_code}&timestamp=${this.timestamp}`;
    hmac.update(string);
    this.signature = hmac.digest('hex');
    this.final_sts_url = this.sts_url + '?' + string + '&signature=' + this.signature;
    this.showUpdatingConsole = false;
  
    this.uploadExtraSourceMaps(compilation, (err) => {
      if (err && compilation && compilation.errors) {
        compilation.errors.push(...handleError(err));
      }
      cb();
    });
  }

  // 上传额外文件夹的sourcemap文件
  uploadExtraSourceMaps(compilation, cb) {
    const self = this;
    // 获取sts完整url
    const final_sts_url = this.final_sts_url;
    const extra_upload_dir = this.extra_upload_dir;
    request(final_sts_url, (error, response, body) => {
  
      if(error && compilation && compilation.errors) return compilation.errors.push(...handleError(error)) && cb();
  
      let bodyData;
  
      try {
        bodyData = JSON.parse(body);
      } catch (e) {
        if (body.startsWith('Invalid Authentication')) {
          return console.log(chalk.red('ERROR fast-sourcemap-upload-webpack-plugin: Invalid Authentication\r\nyour app_key、product_code、app_code maybe wrong')) && cb();
        } else {
          console.log(chalk.red('ERROR fast-sourcemap-upload-webpack-plugin: ' + body))
        }
      }
  
      bodyData = isObject(bodyData) ? bodyData : {};
  
      // 非result === true,展示原因
      if (!bodyData.result) return console.log(chalk.red(bodyData.msg || 'STS权限获取失败'))
  
      const secureData = bodyData.data;
      const credentials = secureData.credentials;
  
      try {
        self.ossClient = new OSS({
          endpoint: secureData.endpoint,
          accessKeyId: credentials.AccessKeyId,
          accessKeySecret: credentials.AccessKeySecret,
          stsToken: credentials.SecurityToken,
          bucket: secureData.bucket,
        });
      } catch (e) {
        return compilation && compilation.errors && compilation.errors.push(...handleError(e)) && cb() || console.log(e) && cb();
      }
  
      // oss文件存储路径
      self.oss_prefix_path = secureData.sourcemap_path; 
  
      // 获取压缩文件和sourceMap文件
      // const realExtraPathArr = extra_upload_dir.map(itemPath => {
      //   return path.resolve(__dirname, itemPath)
      // })
      extra_upload_dir.forEach((extraPath, key) => {
        const realExtraPath = path.resolve(__dirname, extraPath);
        fs.access(realExtraPath, fs.constants.R_OK | fs.constants.W_OK, (err) => {
          if (err) return compilation && compilation.errors && compilation.errors.push(...handleError(err)) && cb();
          console.log(chalk.blue('fast-sourcemap-upload-webpack-plugin is checking your map files, do not stop your program\r\n'))
          const fileList = self.getAsset(realExtraPath);
          self.uploadExtraAll(fileList, extraPath, key, cb);
          // self.deepUpload(outputPath, compilation, _ => {
          //   cb()
          // })
        });
      })
      
    });
  }

  // 同步串行上传额外文件夹
  async uploadExtraAll(fileList, extraPath, key, callback) {
    const self = this;
    const startTime = Date.now();
    // 创建archiver实例 压缩等级9
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });
    // 创建输出
    const output = fs.createWriteStream(path.resolve(__dirname, `extra_${key}_${ZIIPED_FILE_NAME}`));
    // 监听输出目录的close事件
    output.on('close', () => {
      console.log(chalk.blue(`fast-sourcemap-upload-webpack-plugin extraList压缩耗时 ${Date.now() - startTime}ms`))
      this.upload(`extra_${key}_${ZIIPED_FILE_NAME}`, fs.createReadStream(path.resolve(__dirname, `extra_${key}_${ZIIPED_FILE_NAME}`)), () => {
        if (key === 0) {
          callback()
        }
      });
    });
    // 输出
    archive.pipe(output);
    while (fileList.length) {
      // 获取文件路径
      const fileName = fileList.pop();
      // 获取相对路径
      let relativePath = fileName.replace(path.join(extraPath, '../'), '');
      // 路径修复
      if (relativePath.startsWith('\\')) {
        relativePath = relativePath.replace('\\', '');
      }
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.replace('/', '');
      }
      const newRelativePath = path.join(self.oss_prefix_path, relativePath).replace(/\\/g, '/');
      // 处理文件名称
      const cutOutName = cutOutJsAndMap(fileName);
      // 获取文件保存于oss的路径
      const currentPathMappingToOssPath = path.join(self.oss_prefix_path, cutOutName).replace(/\\/g, '/');
  
      // 对oss中是否存在文件进行判断 存在该文件时,判断是否为map文件,如果是map文件,再根据配置决定是否删除
      if(self.historyCacheFileListObj[newRelativePath] && !self.force_update)
      {
        self.dealFile(fileName)
        self.reportData.ossHas ++;
        console.log(chalk.blue('fast-sourcemap-upload-webpack-plugin oss has ' + newRelativePath + ', this file will not upload again'));
      } else {
        archive.append(fs.createReadStream(fileName), { name: relativePath });
        self.reportData.success ++;
        console.log(chalk.green(`${relativePath} 已压缩等待上传`));
        // 本次上传列表将当前文件加入列表
        self.historyCacheFileListObj[currentPathMappingToOssPath] = true;
        self.dealFile(fileName);
      }
    }
    // 生成本次上传文件列表
    const uoloadFileListObjBuffer = Buffer.from(JSON.stringify(self.historyCacheFileListObj), 'utf8');
  
    archive.append(uoloadFileListObjBuffer, { name: `${UPLOAD_FILE_LIST_NAME}` });
    // 开始压缩
    archive.finalize();
  }

  // 处理文件
  dealFile(file) {
    if (!needKeep(cutOutJsAndMap(file)) && this.is_delete_source_map) {
      try {
        fs.accessSync(file);
        fs.unlink(file, (err) => {
          if (err) console.log(err)
        })
      } catch (err) {
        console.error(`访问文件 ${file} 失败`);
      }
    }
  }

  // 获取资源
  getAsset(dir, arr = []) {
    let stat = fs.statSync(dir);
    if (stat.isFile()) {
      if(needUpload(cutOutJsAndMap(dir))){
        arr.push(dir);
      }
    } else {
      let files = fs.readdirSync(dir);
      files
        .map(file => path.join(dir,file))
        .forEach(item=>this.getAsset(item, arr));
    }
    return arr
  }
}

module.exports = FastTrackerIntegrationWebpackPlugin;
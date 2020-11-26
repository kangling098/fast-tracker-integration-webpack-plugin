# fast-tracker-integration-webpack-plugin

天眼探针集成插件

## 插件功能
fast-tracker-integration-webpack-plugin是基于webpack4开发的webpack插件，为天眼离线应用、mpvue小程序集成天眼探针使用

项目引入插件后,需要配置好 产品编码 product_code、应用编码 app_code、环境编码 env_code, file_path_arr 应用入口html相对于输出目录的位置 在天眼管理中心修改探针配置后,每次构建都将会从天眼拉取对应环境的探针代码,并将探针文件输出到项目中(offline与mpvue小程序),online应用为插入标签

开启update_sourcemap参数后

为天眼探针定位上报异常在源代码中的确切位置提供source文件和map文件

在webpack中作为插件使用,需要开启项目的sourceMap文件生成选项，插件会根据输出目录递归搜索 .js文件和.js.map文件 .css.map文件

其中，.js文件和.js.map文件会上传到天眼 .css.map文件不会上传，根据插件配置项 可以决定插件是否删除输出目录中的 .js.map文件和.css.map文件

提示：避免在开发环境开启update_sourcemap功能,否则由于上传文件可能导致热加载时间过长，在生产环境再启用该插件
## 配置项

<div style="width: 120px">配置</div> | <div style="width: 60px">字段类型</div> | 说明 | <div style="min-width: 60px">是否必填</div> | <div style="width: 60px">默认值</div>
---|---|---|---|---
app_code (通用配置参数) | string | 应用编码 | 是 | 无默认值
product_code (通用配置参数) | string | 产品编码 | 是 | 无默认值
integration_tracker (探针集成配置参数) | boolean/string  | 是否使用集成天眼探针功能 离线应用: 'offline',在线应用: 'online',mpvue小程序应用集成:'wxmp', 不使用该功能,填false | 是 | false
env_code (探针集成配置参数) | string | 环境编码(生产: prod、预发布: beta、测试: test、开发: dev) integration_tracker配置为 'offline'、'wxmp'时必填,探针将被打包到项目中, 如果integration_tracker配置为'online' env_code配置了环境时,将会在指定的html文件中插入引用特定环境的script标签,如果未配置环境,将会插入core-js,根据天眼后台配置的运行时环境判断进行区分,在运行时加载不同环境的探针 | 根据integration_tracker配置决定(详细参考说明) | 无默认值
file_path_arr (探针集成配置参数) | array | 应用入口html相对于输出目录的位置(mpvue小程序为输出目录app.js的绝对路径) | 开启integration_tracker参数时必填 | 无默认值
update_sourcemap (sourcemap上传配置参数) | boolean | 是否上传sourcemap文件 | 是 | false
app_key (sourcemap上传配置参数) | string | 应用唯一标识(天眼管理中心应用编辑弹窗中可查) | update_sourcemap配置为true时必填 | 无默认值
is_delete_source_map (sourcemap上传配置参数) | boolean | 是否在输出阶段删除.js.map和.css.map文件 | 否 |true
extra_upload_dir (sourcemap上传配置参数) | array | 需要额外上传的文件夹列表,例如,你的项目中,某个文件夹下的资源是单独引用,未在webpack生命周期中时,可以使用 配置好路径 /a/b/c, 上传时将会把/a/b/c下的js、js.map文件上传到天眼 | 否 |[]
timeout (sourcemap上传配置参数) | number | 单个文件上传超时时间，默认值300000，5分钟 | 300000  
sts_url (sourcemap上传配置参数) | string | STS上传权限获取接口 | 否  | 无默认值
force_update (sourcemap上传配置参数) | boolean | 是否强制上传 | 否  | false 
## 使用

```js
npm i fast-tracker-integration-webpack-plugin -D
```
在webpack中
```js
import fastTrackerIntegrationWebpackPlugin from 'fast-tracker-integration-webpack-plugin';
import path from 'path';
plugins: [
  new fastTrackerIntegrationWebpackPlugin({
    // 公共参数
    product_code: your product_code,
    app_code: your app_code,
    // 探针集成相关参数
    integration_tracker: 'offline',
    env_code: your env_code,
    file_path_arr: ['index.html', 'aaa/index.html'],  // 输出目录的入口html文件  例如 dist/index.html  直接填充index.html(当前如果是mpvue小程序时,需要填输出目录的绝对路径(path.join(__dirname, '../dist/app.js')))
    // sourcemap上传相关参数
    update_sourcemap: true,
    app_key: your app_key,
    is_delete_source_map: true,
  })
]
```
在umi中 config.js
```js
import fastTrackerIntegrationWebpackPlugin from 'fast-tracker-integration-webpack-plugin';
import path from 'path';
export default {
  chainWebpack: config => { // 使用fast-tracker-integration-webpack-plugin插件
    config
    .plugin('fast-tracker-integration-webpack-plugin') 
    .use(new fastTrackerIntegrationWebpackPlugin({
      // 公共参数
      product_code: your product_code,
      app_code: your app_code,
      // 探针集成相关参数
      integration_tracker: 'offline',
      env_code: your env_code,
      file_path_arr: ['index.html', 'aaa/index.html'],  // 输出目录的入口html文件  例如 dist/index.html  直接填充index.html(当前如果是mpvue小程序时,需要填输出目录的绝对路径(path.join(__dirname, '../dist/app.js')))
      // sourcemap上传相关参数
      update_sourcemap: true,
      app_key: your app_key,
      is_delete_source_map: true,
    }))
  },
  plugins: [
    // ref: https://umijs.org/plugin/umi-plugin-react.html
    ['umi-plugin-react', {
      ...
    }]
  ],
  hash: true,
  targets: {
    ie: 9
  },
  // 路由配置
  routes: pageRoutes,
  // ANTD主题配色
  theme: {
  },
  // Webpack Configuration
  proxy: {
  }
}
```

## 上传时间
上传时间不定，根据当前网络状况决定，oss仓库存在的文件不会上传(根据文件路径与名称区分,请开启文件名hash)。

## 注意事项
1. 配置devtool生成sourcemap文件时,如果您的项目需要保留sourcemap文件,那么推荐使用 'source-map' 模式,该模式为 bundle 添加了一个引用注释，以便开发工具知道在哪里可以找到它。 如果您的项目不需要保留生产的sourcemap文件,推荐使用 'hidden-source-map' 模式,与source-map 相同，但不会为 bundle 添加引用注释。

2. 如果您的项目将css、less、scss文件打包入您的js文件时，请在相关loader中关闭您css、less、scss相关文件的sourcemap生成配置。以防止生成的map文件一并打包入您的js文件中，导致js文件大小超过预期。

例：
```js
{
  loader: 'style-loader',
  options: {
    sourceMap: false
  }
}
```

3. 由于node对进程的内存分配有默认设置,32位系统 node默认分配内存 0.7g左右,64位系统默认分配内存1.4g左右, 如果项目复杂,在开启souremap生成选项时,打包的时候,可能出现内存不足导致打包失败的情况

例:
```js
<--- Last few GCs --->

[70041:0x103800000]   112100 ms: Mark-sweep 1049.8 (1273.7) -> 1049.7 (1214.2) MB, 427.1 / 0.0 ms  (average mu = 0.618, current mu = 0.000) last resort GC in old space requested
[70041:0x103800000]   112510 ms: Mark-sweep 1049.7 (1214.2) -> 1049.7 (1192.2) MB, 410.3 / 0.0 ms  (average mu = 0.447, current mu = 0.000) last resort GC in old space requested


<--- JS stacktrace --->

==== JS stack trace =========================================

    0: ExitFrame [pc: 0x36295d35be3d]
Security context: 0x0280a0d9e6e1 <JSObject>
    1: byteLength(aka byteLength) [0x280057866f1] [buffer.js:531] [bytecode=0x280f3e290c1 offset=204](this=0x0280cf7826f1 <undefined>,string=0x028037c8a291 <Very long string[190258200]>,encoding=0x0280a0dbd819 <String[4]: utf8>)
    2: arguments adaptor frame: 3->2
    3: fromString(aka fromString) [0x2800579d2d9] [buffer.js:342] [bytecode=0x280f3e278e1 offs...
```
解决方案:

配置打包命令时,修改node进程占用内存的大小 --max-old-space-size

例:
```js
package.json

"scripts": {
    "build": " node --max-old-space-size=4096 ./scripts/build.js",
  },
```
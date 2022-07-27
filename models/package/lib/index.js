'use strict';
const path = require('path');
const fse = require('fs-extra');
const pkgDir = require('pkg-dir').sync;
const npminstall = require('npminstall');
const pathExists = require('path-exists').sync;
const { isObject } = require('@jpon-cli/utils');
const formatPath = require('@jpon-cli/format-path');
const {
  getDefaultRegistry,
  getNpmLatestVersion,
} = require('@jpon-cli/get-npm-info');

class Package {
  constructor(options) {
    if (!options) {
      throw new Error('Package_Class的options參數不能為空！');
    }
    if (!isObject(options)) {
      throw new Error('Package_Class的options參數必須為物件Object！');
    }
    // package的目标路径
    this.targetPath = options.targetPath;
    // 缓存package的路径
    this.storeDir = options.storeDir;
    // package的name
    this.packageName = options.packageName;
    // package的version
    this.packageVersion = options.packageVersion;
    // package的緩存目錄前綴
    this.cacheFilePathPrefix = this.packageName.replace('/', '_');
  }

  async prepare() {
    if (this.storeDir && !pathExists(this.storeDir)) {
      fse.mkdirpSync(this.storeDir);
    }
    // _@jpon-cli_core@1.0.2@@jpon-cli (緩存路徑)
    // @jpon-cli/core 1.0.2
    if (this.packageVersion === 'latest') {
      this.packageVersion = await getNpmLatestVersion(this.packageName);
    }
  }

  get cacheFilePath() {
    return path.resolve(
      this.storeDir,
      `_${this.cacheFilePathPrefix}@${this.packageVersion}@${this.packageName}`
    );
  }

  getSpecificCacheFilePath(packageVersion) {
    return path.resolve(
      this.storeDir,
      `_${this.cacheFilePathPrefix}@${packageVersion}@${this.packageName}`
    );
  }

  // 判斷當前Package是否存在
  async exists() {
    if (this.storeDir) {
      await this.prepare();
      return pathExists(this.cacheFilePath);
    } else {
      return pathExists(this.targetPath);
    }
  }
  // 安装Package
  async install() {
    await this.prepare();
    return npminstall({
      root: this.targetPath,
      storeDir: this.storeDir,
      registry: getDefaultRegistry(),
      pkgs: [
        {
          name: this.packageName,
          version: this.packageVersion,
        },
      ],
    });
  }
  // 更新Package
  async update() {
    await this.prepare();
    // 1. 取得最新的npm模組版本
    const latestPackageVersion = await getNpmLatestVersion(this.packageName);
    // 2. 查詢最新版本的path是否存在
    const latestFilePath = this.getSpecificCacheFilePath(latestPackageVersion);
    // 3. 如果不存在, 就安裝最新版本
    if (!pathExists(latestFilePath)) {
      await npminstall({
        root: this.targetPath,
        storeDir: this.storeDir,
        registry: getDefaultRegistry(),
        pkgs: [
          {
            name: this.packageName,
            version: latestPackageVersion,
          },
        ],
      });
      this.packageVersion = latestPackageVersion;
    } else {
      this.packageVersion = latestPackageVersion;
    }
  }
  // 取得入口文件的路徑
  getRootFilePath() {
    function _getRootFile(targetPath) {
      // 1. 取得package.json所在資料夾
      const dir = pkgDir(targetPath);
      if (dir) {
        // 2. 讀取package.json => require(xxx.json)
        const pkgFile = require(path.resolve(dir, 'package.json'));
        // 3. 尋找main/lib
        if (pkgFile && pkgFile.main) {
          // 4. path的兼容處理(macOS/windows)
          return formatPath(path.resolve(dir, pkgFile.main));
        }
      }

      return null;
    }
    if (this.storeDir) {
      return _getRootFile(this.cacheFilePath);
    } else {
      return _getRootFile(this.targetPath);
    }
  }
}

module.exports = Package;

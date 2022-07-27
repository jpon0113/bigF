'use strict';
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const fse = require('fs-extra');
const glob = require('glob');
const ejs = require('ejs');
const semver = require('semver');
const userHome = require('user-home');
const log = require('@jpon-cli/log');
const Command = require('@jpon-cli/command');
const Package = require('@jpon-cli/package');
const { spinnerStart, sleep, execAsync } = require('@jpon-cli/utils');

const getProjectTemplate = require('./getProjectTemplate');

const TYPE_PROJECT = 'project';
const TYPE_COMPONENT = 'component';
const TEMPLATE_TYPE_NORMAL = 'normal';
const TEMPLATE_TYPE_CUSTOM = 'custom';
const WHITE_COMMAND = ['npm', 'cnpm'];
class InitCommand extends Command {
  init() {
    this.projectName = this._argv[0] || '';
    this.force = !!this._cmd.force;
    // log.verbose("projectName", this.projectName);
    log.verbose('force', this.force);
  }
  async exec() {
    try {
      const projectInfo = await this.prepare();
      if (projectInfo) {
        // 2. 下載版型
        // log.verbose('projectInfo', projectInfo);
        this.projectInfo = projectInfo;
        await this.downloadTemplate();
        // 3. 安裝版型
        await this.installTemplate();
      }
    } catch (e) {
      log.error(e.message);
    }
  }

  checkCommand(cmd) {
    if (WHITE_COMMAND.includes(cmd)) {
      return cmd;
    }
    return null;
  }

  async execCommand(command, errMsg) {
    let ret;
    if (command) {
      const cmdArray = command.split(' ');
      const cmd = this.checkCommand(cmdArray[0]);
      if (!cmd) {
        throw new Error('指令不存在！指令：' + command);
      }
      const args = cmdArray.slice(1);
      ret = await execAsync(cmd, args, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
    }
    if (ret !== 0) {
      throw new Error(errMsg);
    }
    return ret;
  }

  async installTemplate() {
    if (this.templateInfo) {
      if (!this.templateInfo.type) {
        this.templateInfo.type = TEMPLATE_TYPE_NORMAL;
      }
      if (this.templateInfo.type === TEMPLATE_TYPE_NORMAL) {
        // 標準安裝
        await this.installNormalTemplate();
      } else if (this.templateInfo.type === TEMPLATE_TYPE_CUSTOM) {
        // 自定義安裝
        await this.installCustomTemplate();
      } else {
        throw new Error('無法識別項目版型類型！');
      }
    } else {
      throw new Error('項目版型資訊不存在！');
    }
  }

  async installNormalTemplate() {
    log.verbose('installNormalTemplate', this.templateNpm);
    // 複製版型至當前目錄
    let spinner = spinnerStart('正在安裝版型...');
    await sleep();
    const targetPath = process.cwd();
    try {
      const templatePath = path.resolve(
        this.templateNpm.cacheFilePath,
        'template'
      );
      fse.ensureDirSync(templatePath);
      fse.ensureDirSync(targetPath);
      fse.copySync(templatePath, targetPath);
    } catch (e) {
      throw e;
    } finally {
      spinner.stop(true);
      log.success('版型安装成功');
    }
    const templateIgnore = this.templateInfo.ignore || [];
    const ignore = ['**/node_modules/**', ...templateIgnore];
    await this.ejsRender({ ignore });
    const { installCommand, startCommand } = this.templateInfo;
    // 依賴安裝
    await this.execCommand(installCommand, '依賴安裝失敗！');
    // 啟動指令執行
    await this.execCommand(startCommand, '啟動執行指令失敗！');
  }
  async ejsRender(options) {
    const dir = process.cwd();
    const projectInfo = this.projectInfo;
    return new Promise((resolve, reject) => {
      glob(
        '**',
        {
          cwd: dir,
          ignore: options.ignore || '',
          nodir: true,
        },
        function (err, files) {
          if (err) {
            reject(err);
          }
          Promise.all(
            files.map((file) => {
              const filePath = path.join(dir, file);
              return new Promise((resolve1, reject1) => {
                ejs.renderFile(filePath, projectInfo, {}, (err, result) => {
                  if (err) {
                    reject1(err);
                  } else {
                    fse.writeFileSync(filePath, result);
                    resolve1(result);
                  }
                });
              });
            })
          )
            .then(() => {
              resolve();
            })
            .catch((err) => {
              reject(err);
            });
        }
      );
    });
  }
  async installCustomTemplate() {
    // 查詢客製化版型的入口文件
    if (await this.templateNpm.exists()) {
      const rootFile = this.templateNpm.getRootFilePath();
      log.notice('rootFile', rootFile);
      if (fs.existsSync(rootFile)) {
        log.notice('開始執行客製化版型');
        const templatePath = path.resolve(
          this.templateNpm.cacheFilePath,
          'template'
        );
        const options = {
          templateInfo: this.templateInfo,
          projectInfo: this.projectInfo,
          sourcePath: templatePath,
          targetPath: process.cwd(),
        };
        const code = `require('${rootFile}')(${JSON.stringify(options)})`;
        await execAsync('node', ['-e', code], {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
        log.success('客製化版型安裝成功');
      } else {
        throw new Error('客製化模板入口檔案不存在！');
      }
    }
  }

  async downloadTemplate() {
    const { projectTemplate } = this.projectInfo;
    const templateInfo = this.template.find(
      (item) => item.npmName === projectTemplate
    );
    const targetPath = path.resolve(userHome, '.jpon-cli', 'template');
    const storeDir = path.resolve(
      userHome,
      '.jpon-cli',
      'template',
      'node_modules'
    );
    const { npmName, version } = templateInfo;
    this.templateInfo = templateInfo;
    const templateNpm = new Package({
      targetPath,
      storeDir,
      packageName: npmName,
      packageVersion: version,
    });
    if (!(await templateNpm.exists())) {
      let spinner = spinnerStart('正在安裝版型...');
      await sleep();
      try {
        await templateNpm.install();
      } catch (e) {
        throw e;
      } finally {
        spinner.stop(true);
        if (await templateNpm.exists()) {
          log.success('下載版型成功');
          this.templateNpm = templateNpm;
        }
      }
    } else {
      const spinner = spinnerStart('正在更新版型...');
      await sleep();
      try {
        await templateNpm.update();
      } catch (e) {
        throw e;
      } finally {
        spinner.stop(true);
        if (await templateNpm.exists()) {
          log.success('更新版型成功');
          this.templateNpm = templateNpm;
        }
      }
    }
  }

  async prepare() {
    // 0. 判斷項目版型是否存在
    const template = await getProjectTemplate();
    if (!template || template.length === 0) {
      throw new Error('項目版型不存在');
    }
    this.template = template;
    const localPath = process.cwd();
    // 1. 判斷當前目錄是否為空
    // __dirname 是執行程式的目錄
    // path.resolve(.) 取得當前目錄是下指令的那個目錄
    if (!this.isCwdEmpty(localPath)) {
      let ifContinue = false;
      if (!this.force) {
        // 詢問是否繼續建立
        ifContinue = (
          await inquirer.prompt({
            type: 'confirm',
            name: 'ifContinue',
            default: false,
            message: '當前資料夾不為空, 是否繼續建立項目？',
          })
        ).ifContinue;
        if (!ifContinue) return;
      }
      // 2. 是否啟動強制更新
      if (ifContinue || this.force) {
        // 讓使用者做二次確認, 是否清空當前目錄
        const { confirmDelete } = await inquirer.prompt({
          type: 'confirm',
          name: 'confirmDelete',
          default: false,
          message: '確認是否清空當前目錄下的檔案？',
        });
        if (confirmDelete) {
          // 清空當前目錄
          fse.emptyDirSync(localPath);
        }
      }
    }
    return this.getProjectInfo();
  }
  async getProjectInfo() {
    function isValidName(v) {
      return /^[a-zA-z]+([-][a-zA-Z][a-zA-Z0-9]*|[_][a-zA-Z][a-zA-Z0-9]*|[a-zA-Z0-9])*$/.test(
        v
      );
    }
    let projectInfo = {};
    let isProjectNameValid = false;
    if (isValidName(this.projectName)) {
      isProjectNameValid = true;
      projectInfo.projectName = this.projectName;
    }
    // 1. 選擇建立項目還是組件
    const { type } = await inquirer.prompt({
      type: 'list',
      name: 'type',
      message: '請選擇初始化類型',
      default: TYPE_PROJECT,
      choices: [
        {
          name: '項目',
          value: TYPE_PROJECT,
        },
        {
          name: '組件',
          value: TYPE_COMPONENT,
        },
      ],
    });
    log.verbose('type', type);
    this.template = this.template.filter((template) =>
      template.tag.includes(type)
    );
    const title = type === TYPE_PROJECT ? '項目' : '組件';
    const projectNamePrompt = {
      type: 'input',
      name: 'projectName',
      message: `請輸入${title}名稱`,
      default: '',
      validate: function (v) {
        const done = this.async();
        setTimeout(function () {
          // 1. 首字須為英文
          // 2. 末字須為英文或數字, 不能為其他字符
          // 3. 特殊字符僅允許"-_"
          // \w=a-zA-Z0-9
          if (!isValidName(v)) {
            done(`請輸入合法的${title}名稱`);
            return;
          }
          done(null, true);
        }, 0);
      },
      filter: function (v) {
        return v;
      },
    };
    const projectPrompt = [];
    if (!isProjectNameValid) {
      projectPrompt.push(projectNamePrompt);
    }
    projectPrompt.push(
      {
        type: 'input',
        name: 'projectVersion',
        message: `請輸入${title}版本`,
        default: '1.0.0',
        validate: function (v) {
          const done = this.async();
          setTimeout(function () {
            if (!!!semver.valid(v)) {
              done('請輸入合法的版本');
              return;
            }
            done(null, true);
          }, 0);
        },
        filter: function (v) {
          if (!!semver.valid(v)) {
            return semver.valid(v);
          } else {
            return v;
          }
        },
      },
      {
        type: 'list',
        name: 'projectTemplate',
        choices: this.createTemplateChoice(),
      }
    );
    if (type === TYPE_PROJECT) {
      // 2. 取得項目的基本資訊
      const project = await inquirer.prompt(projectPrompt);
      projectInfo = {
        ...projectInfo,
        type,
        ...project,
      };
    } else if (type === TYPE_COMPONENT) {
      const descriptionPrompt = {
        type: 'input',
        name: 'componentDescription',
        message: '請輸入組件描述資訊',
        default: '',
        validate: function (v) {
          const done = this.async();
          setTimeout(function () {
            if (!v) {
              done('請輸入組件描述資訊');
              return;
            }
            done(null, true);
          }, 0);
        },
      };
      projectPrompt.push(descriptionPrompt);
      // 2. 取得組件的基本資訊
      const component = await inquirer.prompt(projectPrompt);
      projectInfo = {
        ...projectInfo,
        type,
        ...component,
      };
    }
    // 產生classname
    if (projectInfo.projectName) {
      projectInfo.name = projectInfo.projectName;
      projectInfo.className = require('kebab-case')(
        projectInfo.projectName
      ).replace(/^-/, '');
    }
    if (projectInfo.projectVersion) {
      projectInfo.version = projectInfo.projectVersion;
    }
    if (projectInfo.componentDescription) {
      projectInfo.description = projectInfo.componentDescription;
    }

    return projectInfo;
  }
  // 當前目錄是否為空
  isCwdEmpty(localPath) {
    let fileList = fs.readdirSync(localPath);
    // 檔案過濾邏輯
    fileList = fileList.filter(
      (file) => !file.startsWith('.') && ['node_modules'].indexOf(file) < 0
    );
    return !fileList || fileList.length <= 0;
  }

  createTemplateChoice() {
    return this.template.map((item) => ({
      value: item.npmName,
      name: item.name,
    }));
  }
}

function init(argv) {
  return new InitCommand(argv);
}

module.exports = init;
module.exports.InitCommand = InitCommand;

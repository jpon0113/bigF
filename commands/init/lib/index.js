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
const { spinnerStart, sleep } = require('@jpon-cli/utils');

const getProjectTemplate = require('./getProjectTemplate');

const TYPE_PROJECT = 'project';
const TYPE_COMPONENT = 'component';

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
      }
    } catch (e) {
      log.error(e.message);
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
    let projectInfo = {};
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
    if (type === TYPE_PROJECT) {
      // 2. 取得項目的基本資訊
      // const project = await inquirer.prompt(projectPrompt);
      const project = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: '請輸入項目名稱',
          default: '',
          validate: function (v) {
            const done = this.async();
            setTimeout(function () {
              // 1. 首字須為英文
              // 2. 末字須為英文或數字, 不能為其他字符
              // 3. 特殊字符僅允許"-_"
              // \w=a-zA-Z0-9
              if (
                !/^[a-zA-z]+([-][a-zA-Z][a-zA-Z0-9]*|[_][a-zA-Z][a-zA-Z0-9]*|[a-zA-Z0-9])*$/.test(
                  v
                )
              ) {
                done(`請輸入合法的項目名稱`);
                return;
              }
              done(null, true);
            }, 0);
            // return /^[a-zA-z]+([-][a-zA-Z][a-zA-Z0-9]*|[_][a-zA-Z][a-zA-Z0-9]*|[a-zA-Z0-9])*$/.test(
            //   v
            // );
          },
          filter: function (v) {
            return v;
          },
        },
        {
          type: 'input',
          name: 'projectVersion',
          message: '請輸入項目版本',
          default: '1.0.0',
          validate: function (v) {
            return !!semver.valid(v);
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
          message: '請選擇項目版型',
          choices: this.createTemplateChoice(),
        },
      ]);
      projectInfo = {
        type,
        ...project,
      };
    } else if (type === TYPE_COMPONENT) {
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

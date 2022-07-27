"use strict";
const path = require("path");
const semver = require("semver");
const colors = require("colors/safe");
const userHome = require("user-home");
const pathExists = require("path-exists").sync;
const commander = require("commander");

const constant = require("./const");
// require: .js/.json/.node
// .js -> module.exports/exports
// .json -> JSON.parse
// .node -> C++ process.dlopen
// any -> .js
const pkg = require("../package.json");
const log = require("@jpon-cli/log");
const exec = require("@jpon-cli/exec");

const program = new commander.Command();

// 主要執行fn
async function core() {
  try {
    await prepare();
    registerCommand();
  } catch (e) {
    log.error(e.message);
    if (program.debug) {
      console.log(e);
    }
  }
}
// 註冊命令
function registerCommand() {
  program
    .name(Object.keys(pkg.bin)[0])
    .usage("<command> [options]")
    .version(pkg.version)
    .option("-d, --debug", "是否開啟debug模式", false)
    .option("-tp, --targetPath <targetPath>", "是否指定本地调试文件路径", "");

  // 初始化
  program
    .command("init [projectName]")
    .option("-f, --force", "是否强制初始化项目")
    .action(exec);

  // 監聽debug模式
  program.on("option:debug", function () {
    if (program.debug) {
      process.env.LOG_LEVEL = "verbose";
    } else {
      process.env.LOG_LEVEL = "info";
    }
    log.level = process.env.LOG_LEVEL;
  });
  // 指定targetPath
  program.on("option:targetPath", function () {
    process.env.CLI_TARGET_PATH = program.targetPath;
  });
  // 對沒有定義的命令監聽
  program.on("command:*", function (obj) {
    const availableCommands = program.commands.map((cmd) => cmd.name());
    console.log(colors.red("未定義的命令：" + obj[0]));
    if (availableCommands.length > 0) {
      console.log(colors.red("可使用命令：" + availableCommands.join(",")));
    }
  });

  program.parse(process.argv);

  if (program.args && program.args.length < 1) {
    program.outputHelp();
    console.log();
  }
}
//
async function prepare() {
  checkPkgVersion();
  checkRoot();
  checkUserHome();
  checkEnv();
  await checkGlobalUpdate();
}
async function checkGlobalUpdate() {
  // 獲取當前版本
  const currentVersion = pkg.version;
  const npmName = pkg.name;
  // 調用npm API, 獲取所有版本列表
  const { getNpmSemverVersion } = require("@jpon-cli/get-npm-info");
  // 比對版本大於當前版本
  // 獲取最新版本, 提示用戶更新到該版本
  const lastVersion = await getNpmSemverVersion(currentVersion, npmName);
  if (lastVersion && semver.gt(lastVersion, currentVersion)) {
    log.warn(
      colors.yellow(`請手動更新 ${npmName}，當前版本：${currentVersion}，最新版本：${lastVersion}
                更新命令： npm install -g ${npmName}`)
    );
  }
}
// 檢查環境變量
function checkEnv() {
  const dotenv = require("dotenv");
  const dotenvPath = path.resolve(userHome, ".env");
  if (pathExists(dotenvPath)) {
    // dotenv 讀取.env,並產生於process.env
    dotenv.config({
      path: dotenvPath,
    });
  }
  createDefaultConfig();
}
function createDefaultConfig() {
  const cliConfig = {
    home: userHome,
  };
  if (process.env.CLI_HOME) {
    cliConfig["cliHome"] = path.join(userHome, process.env.CLI_HOME);
  } else {
    cliConfig["cliHome"] = path.join(userHome, constant.DEFAULT_CLI_HOME);
  }
  process.env.CLI_HOME_PATH = cliConfig.cliHome;
}
//
// function checkInputArgs() {
//   const minimist = require("minimist");
//   args = minimist(process.argv.slice(2));
//   checkArgs();
// }
// 判斷是否有debug參數
// function checkArgs() {
//   if (args.debug) {
//     process.env.LOG_LEVEL = "verbose";
//   } else {
//     process.env.LOG_LEVEL = "info";
//   }
//   log.level = process.env.LOG_LEVEL;
// }
// user-home: 判斷userPath | pathExists: 判斷是否有該path
function checkUserHome() {
  if (!userHome || !pathExists(userHome)) {
    throw new Error(colors.red("當前登錄用戶主目錄不存在"));
  }
}
// 判斷為超級管理員
function checkRoot() {
  const rootCheck = require("root-check");
  rootCheck();
}
// 判斷package.json version
function checkPkgVersion() {
  log.info("cli", pkg.version);
}

module.exports = core;

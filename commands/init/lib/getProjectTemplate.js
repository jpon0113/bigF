const request = require('@jpon-cli/request');

module.exports = function () {
  return request({
    url: '/project/template',
  });
};

function checkDeploymentInfo() {
  console.log('部署網址：' + ScriptApp.getService().getUrl());
  console.log('目前版本：' + (typeof RECEIVER_VERSION === 'undefined' ? '未設定' : RECEIVER_VERSION));
  console.log('doGet存在：' + (typeof doGet === 'function'));
}

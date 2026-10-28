function checkDeploymentInfo() {
  const info = {
    projectId: ScriptApp.getScriptId(),
    webAppUrl: ScriptApp.getService().getUrl(),
    hasDoGet: typeof doGet === 'function',
    version: typeof RECEIVER_VERSION === 'undefined' ? null : RECEIVER_VERSION
  };
  console.log(JSON.stringify(info, null, 2));
}

/**
 * 毎時トリガーを設置する（13時〜22時）
 * 初回1回だけ実行する
 */
function setupKeepaHourlyTriggers() {
  // 既存のrunKeepaBatchトリガーを全削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runKeepaBatch')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 13時〜22時の10本を設置
  const hours = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  hours.forEach(hour => {
    ScriptApp.newTrigger('runKeepaBatch')
      .timeBased()
      .atHour(hour)
      .everyDays(1)
      .create();
  });

  Logger.log('トリガー設置完了: 13時〜22時の10本');
}

/**
 * 全トリガーを削除する（リセット用）
 */
function deleteKeepaHourlyTriggers() {
  const deleted = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runKeepaBatch');
  deleted.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('トリガー削除完了: ' + deleted.length + '本');
}
/**
 * gemini-3.5-flash-lite への切り替え前に、temperature(サンプリングパラメータ)の
 * カスタム値が実際に効いているかを確認するための使い捨てテスト関数。
 * Apps Scriptエディタの関数選択プルダウンから testGeminiModelTemperature_ を選んで実行し、
 * 実行ログ(表示 > ログ、または実行数の履歴)を確認してください。
 */
function testGeminiModelTemperature_() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY が未設定です。');

  const prompt = 'リンゴを一言で表現してください。20文字以内で、文だけを返してください。';
  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const summary = [];

  models.forEach(function(model) {
    Logger.log('=== ' + model + ' ===');
    const answers = [];
    for (let i = 0; i < 5; i++) {
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 40 }
      };
      const response = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY,
        { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) }
      );
      const code = response.getResponseCode();
      const rawText = response.getContentText();
      if (i === 0) {
        // 1回目だけ生レスポンス全体をログに残す(パラメータ非対応の警告等がないか目視確認するため)
        Logger.log('HTTP ' + code + ' / raw response(1回目): ' + rawText.slice(0, 1500));
      }
      let answer = '';
      try {
        const json = JSON.parse(rawText);
        answer = json.candidates && json.candidates[0] && json.candidates[0].content.parts[0].text
          ? json.candidates[0].content.parts[0].text.trim() : '(候補なし: ' + rawText.slice(0, 200) + ')';
      } catch (e) {
        answer = '(パース失敗: ' + rawText.slice(0, 200) + ')';
      }
      answers.push(answer);
      Logger.log((i + 1) + '回目: ' + answer);
      Utilities.sleep(600);
    }
    const uniqueCount = new Set(answers).size;
    const verdict = uniqueCount === 1
      ? '✅ 5回とも完全に同じ回答 → temperature:0がしっかり効いている可能性が高い'
      : '⚠️ 回答が' + uniqueCount + '種類に分かれた → temperature:0が効いていない(無視されている)可能性がある';
    Logger.log(model + ' の結果: ' + verdict);
    summary.push({ model: model, answers: answers, unique_count: uniqueCount, verdict: verdict });
  });

  Logger.log('=== まとめ ===');
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

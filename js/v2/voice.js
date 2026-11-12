/* ============================================================
   声の聞き取り

   ブラウザに入っている聞き取り（iPad の Safari なら Apple のもの）を使う。
   お名前の字はよく間違うが、そこは AI が名簿と照らして直すので、
   ここでは「言ったことを文字にする」ことだけを受けもつ。
   聞き取りが使えない端末では、キーボードのマイクで入力してもらう。
   ============================================================ */

export function voiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/*
  onText(確定した文, 途中の文) … 聞き取るたびに呼ばれる
  onState('listening' | 'idle', エラー文) … 状態が変わったとき
*/
export function createVoice({ onText, onState }) {
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, wanted = false, finalText = '';

  function begin() {
    rec = new Impl();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += text;
        else interim += text;
      }
      onText(finalText, interim);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wanted = false;
      const msg = e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'マイクが許可されていません。Safari の設定でマイクと音声入力を許可してください。'
        : '聞き取りが止まりました。キーボードのマイクでも入力できます。';
      onState('idle', msg);
    };
    /* しばらく黙ると勝手に止まるので、止めるまでは続けて聞く */
    rec.onend = () => {
      if (wanted) { try { rec.start(); return; } catch (e) { /* 下で止める */ } }
      wanted = false;
      onState('idle');
    };
    rec.start();
  }

  return {
    get listening() { return wanted; },
    start(startText = '') {
      if (wanted) return;
      finalText = startText;
      wanted = true;
      try { begin(); onState('listening'); } catch (e) { wanted = false; onState('idle', '聞き取りを始められませんでした。'); }
    },
    stop() {
      wanted = false;
      if (rec) { try { rec.stop(); } catch (e) { /* もう止まっている */ } }
      onState('idle');
    }
  };
}

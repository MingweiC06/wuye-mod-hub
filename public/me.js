/* "Who am I" card on 赞助 / 排行榜: pick a name (get a key once), or bring
   an existing name to this device with name + key, or stay anonymous. */
(function () {
  'use strict';
  const WY = window.WY;

  function render(card, me, keyJustMade) {
    if (me) {
      card.innerHTML = `
        <div class="me-row">
          <div><p class="eyebrow">当前身份</p><strong class="me-name" data-raw>${WY.esc(me.name)}</strong></div>
          <button class="btn btn-ghost btn-sm" type="button" data-me="forget">在这台设备退出</button>
        </div>
        ${keyJustMade ? `
        <div class="me-key" role="alert">
          <p><b>这是你的钥匙，只显示这一次，请保存好：</b></p>
          <div class="me-key-row"><code data-raw>${WY.esc(keyJustMade)}</code><button class="btn btn-primary btn-sm" type="button" data-me="copy">复制</button></div>
          <p class="cx-note">换手机或电脑时，用「名字 + 钥匙」就能找回这个名字。钥匙丢了可以私信乌叶重置。</p>
        </div>` : ''}`;
      card.querySelector('[data-me="copy"]')?.addEventListener('click', async () => {
        await WY.copy(keyJustMade);
        WY.toast('钥匙已复制', 'success');
      });
      card.querySelector('[data-me="forget"]').addEventListener('click', async () => {
        await WY.api('/api/me/forget', { method: 'POST' });
        WY.toast('已在这台设备退出', 'success');
        mount(card);
      });
      return;
    }
    card.innerHTML = `
      <div class="me-row"><div><p class="eyebrow">当前身份</p><strong class="me-name">匿名</strong></div></div>
      <div class="me-tabs">
        <button class="chip is-active" type="button" data-mode="claim">起个名字</button>
        <button class="chip" type="button" data-mode="restore">我有钥匙</button>
      </div>
      <label class="consent-check consent-check--compact" for="me-cross-border-consent">
        <input type="checkbox" id="me-cross-border-consent" name="crossBorderConsent" required>
        <span>同意<a href="/privacy#cross-border" target="_blank" rel="noopener">隐私政策</a>（昵称与钥匙档案存于美国服务器）</span>
      </label>
      <label class="consent-check consent-check--compact" for="me-age-consent">
        <input type="checkbox" id="me-age-consent" name="ageConfirm" required>
        <span>我确认已年满 14 周岁</span>
      </label>
      <form class="me-form" data-form="claim" novalidate>
        <input class="input" name="name" maxlength="16" placeholder="上榜用的名字（1–16 个字）" autocomplete="nickname" required>
        <button class="btn btn-primary btn-sm" type="submit">确定</button>
      </form>
      <form class="me-form" data-form="restore" novalidate hidden>
        <input class="input" name="name" maxlength="16" placeholder="你的名字" autocomplete="nickname" required>
        <input class="input" name="key" maxlength="40" placeholder="钥匙，例如 WY-ABCD-2345" autocomplete="off" spellcheck="false" required>
        <button class="btn btn-primary btn-sm" type="submit">找回</button>
      </form>
      <p class="cx-note">不想留名也没关系，匿名一样可以赞助和投票。</p>`;
    card.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        card.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('is-active', x === b));
        card.querySelectorAll('[data-form]').forEach((f) => (f.hidden = f.dataset.form !== b.dataset.mode));
      }),
    );
    card.querySelector('[data-form="claim"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      const consent = card.querySelector('#me-cross-border-consent');
      if (!consent || !consent.checked) {
        WY.toast('请先勾选同意隐私政策中的个人信息出境说明', 'error');
        return;
      }
      const age = card.querySelector('#me-age-consent');
      if (!age || !age.checked) {
        WY.toast('请先确认你已年满 14 周岁', 'error');
        return;
      }
      try {
        const r = await WY.api('/api/me/claim', { method: 'POST', body: { name, crossBorderConsent: true, ageConfirm: true } });
        render(card, r.me, r.key);
        document.dispatchEvent(new CustomEvent('wy:me', { detail: r.me }));
      } catch (err) {
        WY.toast(err.message, 'error');
      }
    });
    card.querySelector('[data-form="restore"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const consent = card.querySelector('#me-cross-border-consent');
      if (!consent || !consent.checked) {
        WY.toast('请先勾选同意隐私政策中的个人信息出境说明', 'error');
        return;
      }
      const age = card.querySelector('#me-age-consent');
      if (!age || !age.checked) {
        WY.toast('请先确认你已年满 14 周岁', 'error');
        return;
      }
      try {
        const r = await WY.api('/api/me/restore', {
          method: 'POST',
          body: { name: e.target.name.value.trim(), key: e.target.key.value.trim(), crossBorderConsent: true, ageConfirm: true },
        });
        WY.toast(`欢迎回来，${r.me.name}`, 'success');
        render(card, r.me);
        document.dispatchEvent(new CustomEvent('wy:me', { detail: r.me }));
      } catch (err) {
        WY.toast(err.message, 'error');
      }
    });
  }

  async function mount(card) {
    try {
      const { me } = await WY.api('/api/me');
      render(card, me);
      document.dispatchEvent(new CustomEvent('wy:me', { detail: me }));
    } catch {
      card.hidden = true;
    }
  }

  const card = document.getElementById('me-card');
  if (card) mount(card);
})();

import type { App, ScreenDef } from '../UIManager';
import type { MissionReward } from '../../data/missions';
import { h, btn, money, num, row, tt, bar, fmtRemaining } from '../dom';
import { DAILY_REWARDS, PREMIUM_DAILY_REWARD, AD_REWARDS } from '../../data/shop';

function rewardText(r: MissionReward): string {
  const p: string[] = [];
  if (r.cash) p.push(money(r.cash));
  if (r.gold) p.push(`◆ ${r.gold}`);
  if (r.xp) p.push(`${r.xp} XP`);
  return p.join(' · ');
}

export const missionsScreen: ScreenDef = {
  id: 'missions',
  titleKey: 'menu.missions',
  render(app, root) {
    const { ctx } = app;
    const list = ctx.missions.list();
    const section = (kind: 'main' | 'daily' | 'weekly') => {
      const items = list.filter((m) => m.def.kind === kind && (kind !== 'main' || !m.claimed || true));
      const shown = kind === 'main' ? items.filter((m) => !m.claimed).slice(0, 4).concat(items.filter((m) => m.claimed).slice(-1)) : items;
      return h('section', { class: 'panel' },
        h('h2', null, tt(`missions.${kind}`)),
        shown.length === 0 ? h('p', { class: 'muted' }, tt('missions.none')) : null,
        shown.map((m) =>
          h('div', { class: `mission${m.claimed ? ' done' : ''}${m.locked ? ' locked' : ''}`, 'data-mission': m.def.id },
            h('div', { class: 'mission-main' },
              h('b', null, tt(`mission.${m.def.id}`), m.def.premiumOnly ? h('span', { class: 'chip premium' }, '★') : null),
              h('small', null, tt(`mission.${m.def.id}.desc`, { n: num(m.def.goal), city: m.def.param ? tt('city.' + m.def.param) : '' })),
              bar(Math.min(1, m.progress / m.def.goal)),
              h('small', null, `${num(Math.min(m.progress, m.def.goal))} / ${num(m.def.goal)} · ${tt('missions.reward')}: ${rewardText(m.def.reward)}`)),
            m.claimed ? h('span', { class: 'chip ok' }, tt('missions.claimed'))
              : m.premiumLocked ? btn('★ ' + tt('missions.premiumOnly'), () => app.ui.show('premium'), 'btn-secondary')
              : m.locked ? h('span', { class: 'chip' }, '🔒 ' + tt('missions.locked'))
              : btn(tt('missions.claim'), () => {
                  const r = ctx.missions.claim(m.def.id);
                  if (r.ok) { app.ui.toast('success', tt('missions.rewardGot', { r: rewardText(r.reward) })); app.audio.ui('coin'); } else app.ui.toast('error', tt(`missions.err.${r.reason}`));
                }, 'btn-primary', !m.claimable))));
    };
    root.append(section('main'), section('daily'), section('weekly'));
  },
};

export const achievementsScreen: ScreenDef = {
  id: 'achievements',
  titleKey: 'menu.achievements',
  render(app, root) {
    const { ctx } = app;
    const list = ctx.missions.achievementList();
    root.append(
      h('section', { class: 'panel' },
        h('h2', null, `${tt('menu.achievements')} (${list.filter((a) => a.unlocked).length}/${list.length})`),
        h('div', { class: 'cards' },
          list.map((a) =>
            h('article', { class: `card ach${a.unlocked ? ' unlocked' : ''}`, 'data-ach': a.def.id },
              h('h3', null, a.unlocked ? '🏅 ' : '🔒 ', tt(`ach.${a.def.id}`)),
              h('small', null, tt(`ach.${a.def.id}.desc`, { n: num(a.def.goal) })),
              bar(Math.min(1, a.progress / a.def.goal)),
              h('small', null, `${num(Math.min(a.progress, a.def.goal))} / ${num(a.def.goal)}`),
              row(tt('missions.reward'), rewardText(a.def.reward)),
              a.claimed ? h('span', { class: 'chip ok' }, tt('missions.claimed'))
                : btn(tt('missions.claim'), () => { if (ctx.missions.claimAchievement(a.def.id)) { app.audio.ui('coin'); app.ui.toast('success', tt('missions.rewardGot', { r: rewardText(a.def.reward) })); } }, 'btn-primary', !a.unlocked))))),
    );
  },
};

export const dailyScreen: ScreenDef = {
  id: 'daily',
  titleKey: 'menu.daily',
  render(app, root) {
    const { ctx } = app;
    const st = ctx.daily.status();
    const days = DAILY_REWARDS.map((r, i) => {
      const claimed = st.claimedToday ? i <= st.nextIndex : i < st.nextIndex;
      const today = !st.claimedToday && i === st.nextIndex;
      return h('div', { class: `day${claimed ? ' claimed' : ''}${today ? ' today' : ''}${r.special ? ' special' : ''}` },
        h('b', null, tt('daily.day', { n: i + 1 })),
        h('span', null, money(r.cash)),
        r.gold ? h('span', { class: 'gold' }, `◆ ${r.gold}`) : null,
        claimed ? h('i', null, '✓') : null);
    });
    const fail = (reason: string) => app.ui.toast('error', tt(`daily.err.${reason}`));
    root.append(
      h('section', { class: 'panel' },
        h('h2', null, tt('menu.daily')),
        h('p', null, tt('daily.streak', { n: st.streak })),
        st.clockBehind ? h('p', { class: 'error' }, tt('daily.clockBehind')) : null,
        h('div', { class: 'days' }, days),
        h('div', { class: 'actions wrap' },
          btn(st.claimedToday ? tt('daily.claimedToday') : tt('daily.claim'), () => {
            const r = ctx.daily.claim();
            if (r.ok) { app.ui.toast('success', tt('daily.got', { r: `${money(r.reward.cash)}${r.reward.gold ? ' + ◆' + r.reward.gold : ''}` })); app.audio.ui('coin'); } else fail(r.reason);
          }, 'btn-primary btn-big', st.claimedToday || st.clockBehind),
          btn(`★ ${tt('daily.premiumBonus')} (${money(PREMIUM_DAILY_REWARD.cash)} + ◆${PREMIUM_DAILY_REWARD.gold})`, () => {
            const r = ctx.daily.claimPremium();
            if (r.ok) { app.audio.ui('coin'); app.ui.toast('success', tt('daily.premiumGot')); } else fail(r.reason);
          }, 'btn-secondary', !st.premiumAvailable),
          btn(`📺 ${tt('daily.double')}`, async () => {
            const r = await ctx.ads.claim('doubleDaily');
            reportAd(app, r);
          }, 'btn-secondary', !st.canDouble),
        ),
        !ctx.premium.isPremium() ? h('small', { class: 'muted' }, tt('daily.premiumHint')) : null,
      ),
    );
  },
};

export function reportAd(app: App, r: Awaited<ReturnType<App['ctx']['ads']['claim']>>): void {
  if (r.ok) {
    const s = r.summary ?? {};
    const parts: string[] = [];
    if (s.cash) parts.push(money(s.cash));
    if (s.gold) parts.push(`◆ ${s.gold}`);
    app.ui.toast('success', `${tt('ad.reward')}${parts.length ? ': ' + parts.join(' + ') : r.summary?.boost ? ': ' + tt('ad.boostOn') : ''}${r.mode === 'premiumFree' ? ' (★)' : ''}`);
    app.audio.ui('coin');
  } else if (r.reason !== 'dismissed') {
    app.ui.toast(r.reason === 'limit' || r.reason === 'cooldown' ? 'warn' : 'error', tt(`ad.err.${r.reason ?? 'failed'}`));
  } else app.ui.toast('warn', tt('ad.err.dismissed'));
}

export const rewardedScreen: ScreenDef = {
  id: 'rewarded',
  titleKey: 'menu.rewarded',
  render(app, root) {
    const { ctx } = app;
    const info = ctx.ads.adapterInfo;
    const cdEls: { el: HTMLElement; type: string }[] = [];
    const cards = AD_REWARDS.map((def) => {
      const s = ctx.ads.status(def.id);
      const cd = h('small', { class: 'muted' }, '');
      cdEls.push({ el: cd, type: def.id });
      return h('article', { class: 'card', 'data-ad': def.id },
        h('h3', null, '📺 ', tt(`ad.${def.id}.name`)),
        h('p', null, tt(`ad.${def.id}.desc`, { cash: money(ctx.ads.cashRewardAmount()), gold: ctx.ads.goldRewardAmount() })),
        row(tt('ad.today'), `${s.usedToday} / ${s.dailyLimit}`),
        cd,
        btn(s.premiumFree ? `★ ${tt('ad.claimFree')}` : tt('ad.watch'), async () => {
          const r = await ctx.ads.claim(def.id);
          reportAd(app, r);
        }, 'btn-primary', !s.eligible && s.reason !== 'cooldown'));
    });
    const tick = () => {
      for (const c of cdEls) {
        const s = ctx.ads.status(c.type);
        c.el.textContent = s.reason === 'cooldown' ? tt('ad.cooldown', { t: fmtRemaining(s.cooldownMs) }) : s.reason === 'alreadyActive' ? tt('ad.err.alreadyActive') : s.reason === 'limit' ? tt('ad.err.limit') : '';
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    root.append(
      h('section', { class: 'panel' },
        h('h2', null, tt('menu.rewarded')),
        info.isTest ? h('div', { class: 'banner test' }, '⚠ ' + tt('ad.testBanner')) : null,
        ctx.premium.isPremium() ? h('p', { class: 'good' }, '★ ' + tt('ad.premiumLeft', { n: ctx.ads.premiumFreeLeft() })) : h('p', { class: 'muted' }, tt('ad.noForcedAds')),
      ),
      h('div', { class: 'cards' }, cards),
    );
    return () => clearInterval(iv);
  },
};

// Magic University: the hero in town buys a magic school skill at Basic level.
import * as townEngine from '../../../engine/town.js';
import { getSkillLevel } from '../../../engine/bonuses.js';
import { getTownEffects } from '../../../engine/town.js';
import { SKILL_BY_ID } from '../../../data/skills.js';
import { liveDialog, act, serviceHero } from '../town/dialogUtil.js';
import { currentPlayer } from '../town/townModel.js';

/** Skills taught in this town: `[{skillId, cost}]` (pure). */
export function universityOffers(town) {
  const out = [];
  for (const { effect } of getTownEffects(town, 'teach_skill')) {
    for (const skillId of effect.skills) if (!out.some((o) => o.skillId === skillId)) out.push({ skillId, cost: effect.cost });
  }
  return out;
}

export function openUniversity(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const handle = liveDialog(ctx, {
    title: 'Magic University',
    cls: 'town-univ',
    width: 700,
    render: () => {
      const town = ctx.state.towns[townId];
      const hero = serviceHero(ctx.state, town);
      const player = currentPlayer(ctx.state);
      return h('div.town-univ-body', null,
        hero ? h('p', null, `${hero.name} may study here.`) : h('p', null, 'A hero must be in the town to study.'),
        h('div.town-univ-grid', null, universityOffers(town).map((o) => {
          const known = hero ? getSkillLevel(hero, o.skillId) > 0 : false;
          const full = hero ? hero.skills.length >= 8 : false;
          const skill = SKILL_BY_ID[o.skillId];
          return h('div.town-univ-card', { dataset: { skill: o.skillId } },
            ui.SkillIcon({ id: o.skillId, level: 1, size: 56, showLabel: true }),
            h('p', null, skill ? skill.levels[0].description : ''),
            ui.CostView({ gold: o.cost }, player?.resources),
            ui.Button(known ? 'Known' : full ? 'No free slot' : 'Learn', {
              kind: 'primary', size: 'sm', disabled: !hero || known || full,
              onClick: () => act(ctx, (s) => townEngine.learnUniversitySkill(s, townId, o.skillId, hero.id)),
            }));
        })));
    },
  });
  return handle.result;
}

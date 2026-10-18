// Quest guards and seer huts (docs/mechanics/adventure-objects.md §3.8).
import { RESOURCES } from '../../core/constants.js';
import { ownsArtifact, removeArtifact } from '../artifacts.js';
import { deps } from './deps.js';
import { EFFECTS } from './registry.js';
import { removeObject } from './map.js';
import { applyReward } from './rewards.js';
import { note, askConfirm } from './visit.js';
import { armyCount, armyTotalCount, armyRemoveCreature } from './util.js';

/** Is the quest fulfilled by this hero right now? (doc table in §3.8) */
export function questFulfilled(state, hero, quest) {
  const player = state.players.find((p) => p.id === hero.owner);
  switch (quest.type) {
    case 'reach_level': return hero.level >= quest.level;
    case 'reach_primary': return Object.entries(quest.stats || {}).every(([s, v]) => hero.primary[s] >= v);
    case 'kill_hero': return !!player?.visited?.[`killed_hero_${quest.heroId}`];
    case 'kill_monster': return !!player?.visited?.[`killed_${quest.objectId}`];
    case 'bring_artifacts': return (quest.artifactIds || []).every((a) => ownsArtifact(hero, a));
    case 'bring_creatures': {
      const need = quest.creatures || [];
      if (!need.every((c) => armyCount(hero.army, c.creatureId) >= c.count)) return false;
      return armyTotalCount(hero.army) - need.reduce((n, c) => n + c.count, 0) >= 1;
    }
    case 'bring_resources': return deps.canAfford(state, hero.owner, quest.resources);
    case 'be_hero': return hero.defId === quest.heroDefId;
    case 'be_player': return hero.owner === quest.playerId;
    default: throw new Error(`Unknown quest type: ${quest.type}`);
  }
}

/** Take what the quest asks for. */
export function consumeQuest(state, hero, quest, events) {
  if (quest.type === 'bring_artifacts') {
    for (const a of quest.artifactIds) removeArtifact(hero, a);
    events.push({ type: 'quest_paid', heroId: hero.id, artifacts: quest.artifactIds.slice() });
  } else if (quest.type === 'bring_creatures') {
    for (const c of quest.creatures) armyRemoveCreature(hero.army, c.creatureId, c.count);
    events.push({ type: 'quest_paid', heroId: hero.id, creatures: quest.creatures });
  } else if (quest.type === 'bring_resources') {
    const cost = {};
    for (const r of RESOURCES) if (quest.resources[r]) cost[r] = quest.resources[r];
    deps.pay(state, hero.owner, cost);
    events.push({ type: 'quest_paid', heroId: hero.id, resources: cost });
  }
}

EFFECTS.quest_guard = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    const quest = obj.data.quest;
    if (!quest) { removeObject(state, obj.id); return note(ctx, 'guard_removed'); }
    if (!questFulfilled(state, hero, quest)) return note(ctx, 'quest', { quest, text: obj.data.texts?.quest || null });
    note(ctx, 'confirm_quest', { quest });
    return void askConfirm(ctx, 'confirm_quest', { quest });
  },
  confirmed(ctx) {
    const { state, hero, obj, events } = ctx;
    if (!questFulfilled(state, hero, obj.data.quest)) return note(ctx, 'quest', { quest: obj.data.quest });
    consumeQuest(state, hero, obj.data.quest, events);
    removeObject(state, obj.id);
    return note(ctx, 'guard_removed');
  },
};

EFFECTS.seer_hut = {
  visit(ctx) {
    const { state, hero, player, obj } = ctx;
    const d = obj.data;
    if (d.completed) return note(ctx, 'inert', { reason: 'completed' });
    if (d.deadline != null && state.turn > d.deadline) return note(ctx, 'inert', { reason: 'deadline' });
    if (!d.quest) return note(ctx, 'inert', { reason: 'no_quest' });
    player.visited ??= {};
    const first = !player.visited[obj.id];
    player.visited[obj.id] = true;
    if (!questFulfilled(state, hero, d.quest)) return note(ctx, 'quest', { quest: d.quest, first, text: d.texts?.quest || null, deadline: d.deadline ?? null });
    note(ctx, 'confirm_quest', { quest: d.quest, reward: d.reward });
    return void askConfirm(ctx, 'confirm_quest', { quest: d.quest, reward: d.reward });
  },
  confirmed(ctx) {
    const { state, hero, obj, events } = ctx;
    const d = obj.data;
    if (d.completed || !questFulfilled(state, hero, d.quest)) return note(ctx, 'quest', { quest: d.quest });
    consumeQuest(state, hero, d.quest, events);
    d.completed = true;
    d.completedBy = hero.owner;
    note(ctx, 'quest_completed', { quest: d.quest, reward: d.reward, text: d.texts?.completed || null });
    return applyReward(state, hero, d.reward || {}, events, obj.defId);
  },
};

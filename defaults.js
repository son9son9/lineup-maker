// 기본 데이터 (쌔바 FC). 웹에서 수정하면 브라우저 localStorage에 저장됨.
export const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'CDM', 'CAM', 'LW', 'RW', 'ST'];

export const DEFAULT_FORMATION = [
  { pos: 'GK', count: 1 }, { pos: 'LB', count: 1 }, { pos: 'CB', count: 2 }, { pos: 'RB', count: 1 },
  { pos: 'CDM', count: 2 }, { pos: 'CAM', count: 1 }, { pos: 'LW', count: 1 }, { pos: 'RW', count: 1 },
  { pos: 'ST', count: 1 },
];

const P = (name, skills, merc = false) => ({ name, skills, merc, attending: true, avail: [true, true, true, true] });

export const DEFAULT_PLAYERS = [
  P('송용협', { LW: 3, RW: 2, CAM: 2, LB: 2, RB: 2 }),
  P('김정호', { LB: 3, RB: 3, CB: 2, CDM: 2, LW: 1, RW: 1 }),
  P('심용진', { CDM: 3, CAM: 3, RW: 2, LW: 1, ST: 1 }),
  P('김은엽', { ST: 3, RB: 2, LB: 2, CAM: 1, CDM: 1, LW: 1, RW: 1, CB: 1 }),
  P('임가람', { ST: 3, LW: 1, RW: 1, CAM: 1, RB: 1 }),
  P('박태호', { CAM: 3, CDM: 2, RB: 2, LB: 2, ST: 2, RW: 2, LW: 1, CB: 1 }),
  P('박준범', { CDM: 3, LB: 2, RB: 2, CAM: 1, CB: 1 }),
  P('김완수', { LB: 3, RB: 3 }),
  P('조경용', { GK: 3 }),
  P('박성환', { LW: 3, RW: 2, LB: 2 }, true),
  P('김효겸', { CDM: 3, CB: 3, CAM: 2, ST: 1 }, true),
  P('김준영', { LB: 3, RB: 1 }, true),
  P('김준혁', { CB: 3 }, true),
];

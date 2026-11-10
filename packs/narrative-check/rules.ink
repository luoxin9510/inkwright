// Narrative check rules, pack version 1.0 (Inkwright). A game INCLUDEs this through its generated _engine.ink.
// Checks are tags on choices (* [Force the door #check:strength:hard]) read back with check(skill, n): a band 0..4,
// 3 or more is a success. Inner voices are #voice:<skill> lines. The engine rolls 2d6 + skill against the difficulty;
// every 25 fear takes 1 off reason. This file only adds the helpers stories share.

// x kept within lo..hi.
=== function clamp(x, lo, hi) ===
{ x < lo:
    ~ return lo
}
{ x > hi:
    ~ return hi
}
~ return x

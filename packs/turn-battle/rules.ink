// Turn battle rules, pack version 1.0 (Inkwright, original rules).
// A game INCLUDEs this through its generated _engine.ink. The story spawns the foes ("foe" kind), calls -> battle ->
// and then reads battle_result: "won" (no foe left) or "lost" (nobody in the party standing).
// Each round everyone standing acts once, fastest first (spd; a hero goes before a foe as fast). A hero attacks a foe,
// uses an art (art 1 bash: hit + stun, 2 MP; art 2 fire: every foe 2d6-3, 3 MP; art 3 mend: an ally 2d6 and the
// poison gone, 2 MP), guards (+3 defence until the hero's next turn) or gives a potion (an ally +6). A foe strikes a
// random hero; a foe with venom 1 poisons a hero not yet poisoned instead. Damage = attack + 2d6 - 4 - defence, at
// least 1; 11 or 12 on the dice is a critical (+2). At the end of a round poison bites (-2) and statuses count down.
// Everything here works on the game's party (stats hp, mp, atk, def, spd, art, acted) and the "foe" kind (hp, atk,
// def, spd, venom, acted), so a game may change both in its own game.md. Who is a hero is told by art: every party
// member needs art 1, 2 or 3; one with art 0 (or none) would act and fall like a foe.

VAR battle_result = ""
VAR battle_round = 0
VAR actor = ""

// The whole battle, round after round until one side is down.
=== battle ===
~ battle_result = ""
~ battle_round = 0
- (round)
{ alive("foe") == 0:
    ~ battle_result = "won"
    {t("敌人全倒下了。", "Every foe is down.")}
    ->->
}
{ alive("party") == 0:
    ~ battle_result = "lost"
    ->->
}
~ battle_round += 1
{t("—— 第 {battle_round} 回合 ——", "— Round {battle_round} —")}
~ ready_all("party", 1)
~ ready_all("foe", 1)
- (turn)
{ alive("foe") == 0 || alive("party") == 0:
    -> round
}
~ actor = next_actor()
{ actor == "":
    ~ end_round()
    -> round
}
~ set_stat(actor, "acted", 1)
~ clear_status(actor, "guard")
{ has_status(actor, "stun"):
    ~ clear_status(actor, "stun")
    {t("{name_of(actor)}头晕眼花,这一回合动不了。", "{name_of(actor)} is stunned and loses the turn.")}
    -> turn
}
{ stat(actor, "art") == 0:
    ~ foe_turn(actor)
    -> turn
}
{t("轮到{name_of(actor)}了(生命 {stat(actor, "hp")},法力 {stat(actor, "mp")})。", "{name_of(actor)}'s turn (HP {stat(actor, "hp")}, MP {stat(actor, "mp")}).")}
<- attack_option(1)
<- attack_option(2)
<- attack_option(3)
<- attack_option(4)
<- bash_option(1)
<- bash_option(2)
<- bash_option(3)
<- bash_option(4)
<- mend_option(1)
<- mend_option(2)
<- mend_option(3)
+ {stat(actor, "art") == 2 && stat(actor, "mp") >= 3} [{t("{name_of(actor)}:火球(全体敌人,3 法力)", "{name_of(actor)}: fireball (every foe, 3 MP)")}]
    ~ add_stat(actor, "mp", -3)
    {t("{name_of(actor)}掷出一团火。", "{name_of(actor)} hurls a ball of fire.")}
    ~ burn_all(1)
    -> turn
+ [{t("{name_of(actor)}:防御", "{name_of(actor)}: guard")}]
    ~ add_status(actor, "guard", 0)
    {t("{name_of(actor)}举起盾牌,严阵以待。", "{name_of(actor)} stands on guard.")}
    -> turn
+ {potions > 0} [{t("{name_of(actor)}:给伤得最重的人喝药水(+6)", "{name_of(actor)}: a potion for the most wounded (+6)")}]
    ~ potions -= 1
    ~ temp worst = pick_one("party", "lowest:hp")
    {t("{name_of(worst)}喝下药水。", "{name_of(worst)} drinks a potion.")}
    ~ heal(worst, 6)
    -> turn

// The acting hero attacks the k-th standing foe (nothing when there are fewer).
=== attack_option(k) ===
~ temp target = nth_one("foe", k)
{ target == "":
    -> DONE
}
+ [{t("{name_of(actor)}:攻击{name_of(target)}", "{name_of(actor)}: attack {name_of(target)}")}]
    {t("{name_of(actor)}攻击{name_of(target)}。", "{name_of(actor)} attacks {name_of(target)}.")}
    ~ hit(actor, target, stat(actor, "atk"))
    -> battle.turn
- -> DONE

// Art 1, bash: a hit that stuns the k-th foe until its next turn.
=== bash_option(k) ===
~ temp target = nth_one("foe", k)
{ target == "" || stat(actor, "art") != 1 || stat(actor, "mp") < 2:
    -> DONE
}
+ [{t("{name_of(actor)}:盾击{name_of(target)}(眩晕,2 法力)", "{name_of(actor)}: shield bash {name_of(target)} (stun, 2 MP)")}]
    ~ add_stat(actor, "mp", -2)
    {t("{name_of(actor)}用盾猛撞{name_of(target)}。", "{name_of(actor)} slams {name_of(target)} with the shield.")}
    ~ temp foe_name = name_of(target)
    ~ hit(actor, target, stat(actor, "atk"))
    { alive_one(target):
        ~ add_status(target, "stun", 0)
        {t("{foe_name}被撞晕了。", "{foe_name} is stunned.")}
    }
    -> battle.turn
- -> DONE

// Art 3, mend: heals the k-th standing hero and takes the poison off.
=== mend_option(k) ===
~ temp ally = nth_one("party", k)
{ ally == "" || stat(actor, "art") != 3 || stat(actor, "mp") < 2:
    -> DONE
}
+ [{t("{name_of(actor)}:治疗{name_of(ally)}(2 法力)", "{name_of(actor)}: mend {name_of(ally)} (2 MP)")}]
    ~ add_stat(actor, "mp", -2)
    {t("{name_of(actor)}为{name_of(ally)}祈祷。", "{name_of(actor)} prays over {name_of(ally)}.")}
    ~ heal(ally, roll("2d6"))
    { has_status(ally, "poison"):
        ~ clear_status(ally, "poison")
        {t("毒解了。", "The poison is gone.")}
    }
    -> battle.turn
- -> DONE

// --- turns -------------------------------------------------------------------

// Who acts next: the fastest one standing who has not acted this round; a hero before a foe as fast. "" = round over.
=== function next_actor() ===
~ temp hero = fastest("party", 1, "")
~ temp enemy = fastest("foe", 1, "")
{ hero == "":
    ~ return enemy
}
{ enemy == "":
    ~ return hero
}
{ stat(enemy, "spd") > stat(hero, "spd"):
    ~ return enemy
}
~ return hero

// The fastest of the k-th standing one of a kind and those after it that has not acted, or best.
=== function fastest(kind, k, best) ===
~ temp who = nth_one(kind, k)
{ who == "":
    ~ return best
}
{ stat(who, "acted") == 0:
    { best == "":
        ~ return fastest(kind, k + 1, who)
    }
    { stat(who, "spd") > stat(best, "spd"):
        ~ return fastest(kind, k + 1, who)
    }
}
~ return fastest(kind, k + 1, best)

// A new round: the k-th standing one of a kind and those after it may act again.
=== function ready_all(kind, k) ===
~ temp who = nth_one(kind, k)
{ who != "":
    ~ set_stat(who, "acted", 0)
    ~ ready_all(kind, k + 1)
}

// The end of a round: poison bites, then statuses count down.
=== function end_round() ===
~ poison_bites("party", 1)
~ poison_bites("foe", 1)
~ tick_statuses()

=== function poison_bites(kind, k) ===
~ temp who = nth_one(kind, k)
{ who != "":
    { has_status(who, "poison"):
        {t("毒在{name_of(who)}身上发作。", "Poison burns in {name_of(who)}.")}
        { hurt(who, 2):
            // Down: the next one standing is now k-th.
            ~ poison_bites(kind, k)
            ~ return
        }
    }
    ~ poison_bites(kind, k + 1)
}

// A foe's turn: a venomous foe poisons a hero not yet poisoned; otherwise it strikes a random hero.
=== function foe_turn(who) ===
~ temp victim = pick_one("party", "random")
{ stat(who, "venom") > 0:
    { not has_status(victim, "poison"):
        {t("{name_of(who)}朝{name_of(victim)}吐出一团绿雾,{name_of(victim)}中毒了。", "{name_of(who)} breathes green smoke at {name_of(victim)}: poisoned.")}
        ~ add_status(victim, "poison", 3)
        ~ return
    }
}
{t("{name_of(who)}扑向{name_of(victim)}。", "{name_of(who)} lunges at {name_of(victim)}.")}
~ hit(who, victim, stat(who, "atk"))

// --- damage ------------------------------------------------------------------

// power + 2d6 - 4 - the target's defence (+3 while guarding), at least 1; 11 or more on the dice is a critical, +2.
=== function hit(attacker, target, power) ===
~ temp dice = roll("2d6")
~ temp damage = power + dice - 4 - defence(target)
{ dice >= 11:
    ~ damage += 2
    {t("暴击!", "Critical!")}
}
{ damage < 1:
    ~ damage = 1
}
~ hurt(target, damage)

=== function defence(who) ===
{ has_status(who, "guard"):
    ~ return stat(who, "def") + 3
}
~ return stat(who, "def")

// Takes n HP off; true when that brought them down (a foe is gone, a hero lies at 0 with no statuses).
=== function hurt(who, n) ===
~ temp who_name = name_of(who)
~ temp hero = stat(who, "art") > 0
~ add_stat(who, "hp", 0 - n)
{t("{who_name} -{n}。", "{who_name} -{n}.")}
{ hero:
    { stat(who, "hp") <= 0:
        ~ set_stat(who, "hp", 0)
        ~ clear_status(who, "")
        {t("{who_name}倒下了。", "{who_name} goes down.")}
        ~ return true
    }
    ~ return false
}
{ not alive_one(who):
    {t("{who_name}被打倒了。", "{who_name} is defeated.")}
    ~ return true
}
~ return false

// Art 2: every foe from the k-th on takes 2d6-3 (at least 1), defence ignored.
=== function burn_all(k) ===
~ temp target = nth_one("foe", k)
{ target != "":
    { hurt(target, MAX(roll("2d6") - 3, 1)):
        ~ burn_all(k)
        ~ return
    }
    ~ burn_all(k + 1)
}

=== function heal(who, n) ===
~ temp had = stat(who, "hp")
~ set_stat(who, "hp", MIN(had + n, stat(who, "hp_max")))
{t("{name_of(who)} +{stat(who, "hp") - had}。", "{name_of(who)} +{stat(who, "hp") - had}.")}

// Still in the fight: a hero with HP left, a foe not yet removed.
=== function alive_one(who) ===
~ return stat(who, "hp") > 0
